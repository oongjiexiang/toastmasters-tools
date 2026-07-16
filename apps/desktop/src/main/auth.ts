/**
 * In-app Toastmasters login (Phase 12).
 *
 * Replaces manual cookie-pasting: the user authenticates on the *genuine*
 * Toastmasters pages inside an embedded Electron window, and we harvest the
 * resulting session cookies from our own persistent Electron session store. We
 * never see the password — it goes straight to TI over HTTPS; we only read the
 * cookies (including httpOnly auth cookies a renderer `document.cookie` read
 * would miss) from the main process.
 *
 * ⚠️ Like `credentials.ts`, this module must stay free of any static import of
 * `@toastmasters/core` (or anything that transitively evaluates `config.ts`),
 * so that importing it from `index.ts` never evaluates core before the bootstrap
 * has set `TOASTMASTERS_DATA_DIR` / the cookie env vars. It reaches env live via
 * the core accessors instead — but only ever from the running scrapers, not from
 * here. See `apps/desktop/tests/main-bundle.test.ts`.
 */

import { BrowserWindow, session, type Session } from "electron";
import { upsertCredential } from "./credentials";

/**
 * A persistent partition so a login survives app restarts: Chromium writes the
 * cookie jar for this partition to disk under userData. This is also the whole
 * "credential convenience" story for Phase 16 item 5: because the partition
 * (and its cookies) already survive an app restart, the user rarely needs to
 * re-enter credentials at all — no autofill/prefill is needed on top of it.
 */
export const LOGIN_PARTITION = "persist:toastmasters";

/** The genuine HTTPS login pages we send the user to. */
export const TI_LOGIN_URL = "https://www.toastmasters.org/login";
export const BASECAMP_LOGIN_URL = "https://app.basecamp.toastmasters.org/dashboard";

/** The origins we read cookies back from after the user has authenticated. */
const BASECAMP_COOKIE_URL = "https://basecamp.toastmasters.org/";
const TI_COOKIE_URL = "https://www.toastmasters.org/";

/** The subset of Electron's `Session["cookies"]` this module depends on. */
export interface CookieSource {
  get(filter: { url: string }): Promise<Array<{ name: string; value: string }>>;
}

/** The cookies harvested from the Electron session, ready to apply. */
export interface HarvestedCookies {
  /** The Basecamp `sessionid` cookie value, when present. */
  basecampSessionId?: string;
  /** Every www.toastmasters.org cookie joined as `name=value; …`, when present. */
  tiCookie?: string;
}

/** Which credentials were successfully applied by {@link applyCookies}. */
export interface AuthStatus {
  basecamp: boolean;
  ti: boolean;
}

/**
 * Reads the two cookie sets the scrapers need out of an Electron cookie store.
 *
 * A pure function of its `cookieSource` argument — no `BrowserWindow`, no
 * globals — so it is unit-testable with a mocked `session.cookies.get`.
 */
export async function harvestCookies(
  cookieSource: CookieSource,
): Promise<HarvestedCookies> {
  const harvested: HarvestedCookies = {};

  const basecampCookies = await cookieSource.get({ url: BASECAMP_COOKIE_URL });
  const sessionCookie = basecampCookies.find((c) => c.name === "sessionid");
  if (sessionCookie?.value) harvested.basecampSessionId = sessionCookie.value;

  const tiCookies = await cookieSource.get({ url: TI_COOKIE_URL });
  const tiCookie = tiCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  if (tiCookie) harvested.tiCookie = tiCookie;

  return harvested;
}

/**
 * Applies non-empty harvested cookies both live (`process.env`, so the very next
 * refresh uses them) and durably (into `config.env`, so they survive a restart).
 * Empty values are never written — an absent cookie must leave core free to raise
 * its "…is not set" guidance rather than overwriting a still-valid credential.
 */
export function applyCookies(
  credsFile: string,
  harvested: HarvestedCookies,
): AuthStatus {
  const applied: AuthStatus = { basecamp: false, ti: false };

  if (harvested.basecampSessionId) {
    process.env.BASECAMP_SESSIONID = harvested.basecampSessionId;
    upsertCredential(credsFile, "BASECAMP_SESSIONID", harvested.basecampSessionId);
    applied.basecamp = true;
  }

  if (harvested.tiCookie) {
    process.env.TI_COOKIE = harvested.tiCookie;
    upsertCredential(credsFile, "TI_COOKIE", harvested.tiCookie);
    applied.ti = true;
  }

  return applied;
}

/**
 * The subset of Electron's `Session["cookies"]` needed to watch for a captured
 * login live, on top of the point-in-time `get` harvestCookies already uses.
 * Electron's real `Cookies` object (an EventEmitter) satisfies this structurally
 * with no cast needed at the real call site in `runLoginFlow`.
 */
export interface CookieWatcher extends CookieSource {
  on(event: "changed", listener: () => void): void;
  off(event: "changed", listener: () => void): void;
}

/**
 * Resolves as soon as `isCaptured` is true for the live cookie state: checked
 * immediately (covers "already logged in from a prior session") and again on
 * every Chromium `"changed"` cookie event. `cancel()` stops listening — call it
 * once the caller no longer needs the watch (e.g. the window closed some other
 * way first), so no listener is ever leaked onto the long-lived partition
 * session across repeated login attempts.
 */
export function watchForCapture(
  cookieSource: CookieWatcher,
  isCaptured: (h: HarvestedCookies) => boolean,
): { promise: Promise<void>; cancel: () => void } {
  let settled = false;
  const check = () => {
    void harvestCookies(cookieSource).then((h) => {
      if (settled || !isCaptured(h)) return;
      settled = true;
      cookieSource.off("changed", check);
      resolveFn();
    });
  };
  let resolveFn!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
    cookieSource.on("changed", check);
    check();
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cookieSource.off("changed", check);
    },
  };
}

/**
 * Opens a login window bound to the persistent partition and resolves once the
 * user closes it — or, when `captureSignal` resolves first (the expected path:
 * `runLoginFlow` wires it to {@link watchForCapture}), once the window is closed
 * programmatically so the user isn't left staring at a login page after they've
 * already finished. Security: the window shows a third-party page, so it runs
 * with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` and NO
 * preload — it must never reach our IPC bridge. We inject no scripts into it.
 * Needs Electron; kept thin and not unit-tested.
 */
export function openLoginWindow(url: string, captureSignal?: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1024,
      height: 800,
      title: "Log in to Toastmasters",
      autoHideMenuBar: true,
      webPreferences: {
        session: session.fromPartition(LOGIN_PARTITION),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    win.once("closed", () => resolve());

    if (captureSignal) {
      void captureSignal.then(() => {
        if (!win.isDestroyed()) win.close();
      });
    }

    void win.loadURL(url);
  });
}

/**
 * Orchestrates the full login without prior knowledge of whether TI's login also
 * covers Basecamp via SSO: open the TI login window → harvest → if the Basecamp
 * `sessionid` was not captured, open the Basecamp login window and harvest again
 * → apply. Each window auto-closes as soon as {@link watchForCapture} sees the
 * relevant cookie land, so the user gets immediate feedback that the login
 * completed instead of having to close the window themselves. The per-step logs
 * are how the user's manual validation determines the SSO-vs-two-login question.
 */
export async function runLoginFlow(credsFile: string): Promise<AuthStatus> {
  const loginSession = session.fromPartition(LOGIN_PARTITION);
  const cookies = loginSession.cookies;

  const tiWatch = watchForCapture(
    cookies,
    (h) => Boolean(h.tiCookie) || Boolean(h.basecampSessionId),
  );
  await openLoginWindow(TI_LOGIN_URL, tiWatch.promise);
  tiWatch.cancel();
  let harvested = await harvestCookies(cookies);
  logHarvest("after TI login", harvested);

  if (!harvested.basecampSessionId) {
    const bcWatch = watchForCapture(cookies, (h) => Boolean(h.basecampSessionId));
    await openLoginWindow(BASECAMP_LOGIN_URL, bcWatch.promise);
    bcWatch.cancel();
    harvested = await harvestCookies(cookies);
    logHarvest("after Basecamp login", harvested);
  }

  const applied = applyCookies(credsFile, harvested);
  console.log(
    `[toastmasters] login applied — basecamp: ${applied.basecamp}, ti: ${applied.ti}`,
  );
  return applied;
}

/**
 * The current auth status derived from the persistent session: which cookies are
 * non-empty right now. Used by the AUTH_STATUS channel and startup self-heal.
 */
export async function currentAuthStatus(sess: Session): Promise<AuthStatus> {
  const harvested = await harvestCookies(sess.cookies);
  return {
    basecamp: Boolean(harvested.basecampSessionId),
    ti: Boolean(harvested.tiCookie),
  };
}

function logHarvest(stage: string, harvested: HarvestedCookies): void {
  console.log(
    `[toastmasters] ${stage} — basecamp sessionid: ` +
      `${harvested.basecampSessionId ? "captured" : "missing"}, ` +
      `TI cookies: ${harvested.tiCookie ? "captured" : "missing"}`,
  );
}
