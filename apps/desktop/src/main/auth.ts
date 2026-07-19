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
// logger.ts is core-free too (see its header comment) — safe to import
// statically here for the same reason `credentials.ts` is.
import { logger } from "./logger";

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
/**
 * Base Camp login entry point — deliberately the app SPA host
 * (`app.basecamp.toastmasters.org`), NOT the bare API host
 * {@link BASECAMP_COOKIE_URL} we harvest from. This is load-bearing:
 *
 *   • The scraper authenticates against `basecamp.toastmasters.org/api/...` with
 *     an *authenticated* `sessionid` cookie. That authenticated session is minted
 *     by the Base Camp app (`app.basecamp.toastmasters.org`) completing its TI-SSO
 *     handshake (a `login_refresh` XHR) once the TI window has logged the shared
 *     partition in. Opening this host is what drives that handshake.
 *   • Do NOT "simplify" this to `https://basecamp.toastmasters.org/`: that bare
 *     host merely 302-redirects an unauthenticated visit to `toastmasters.org` and
 *     leaves only an *anonymous* `sessionid` — which the window's navigation-capture
 *     gate happily captures, so login "succeeds" but every scrape then fails
 *     `HTTP 401/403`. (Regressed exactly this way in Phase 27's first attempt.)
 *
 * The blank-shell/i18n crash this SPA throws only happens on a *fresh,
 * unauthenticated* partition; `runLoginFlow` opens this window second — after TI
 * login — so it boots authenticated and renders, exactly as it did through 1.8.0.
 * See Phase 27 in specs/roadmap.md.
 */
export const BASECAMP_LOGIN_URL = "https://app.basecamp.toastmasters.org/dashboard";

/**
 * The origins we read cookies back from after the user has authenticated.
 * `BASECAMP_COOKIE_URL` is exported so a unit test can assert it stays a *different*
 * host from {@link BASECAMP_LOGIN_URL} (the API host vs the SPA host — collapsing
 * them is the Phase 27 anonymous-session regression).
 */
export const BASECAMP_COOKIE_URL = "https://basecamp.toastmasters.org/";
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
 * {@link AuthStatus}, plus whether the Basecamp login window gave up (Phase
 * 27): it exhausted its auto-reload retries on Basecamp's own third-party
 * "getLocale called before configuring i18n" crash (see the module header)
 * without the `sessionid` cookie ever landing. Only `runLoginFlow`'s Basecamp
 * branch can set this — the TI-only fast path (SSO already covered Basecamp,
 * so no second window was opened) always leaves it unset.
 */
export interface LoginResult extends AuthStatus {
  basecampGaveUp?: boolean;
}

/**
 * Reads the two cookie sets the scrapers need out of an Electron cookie store.
 *
 * A pure function of its `cookieSource` argument — no `BrowserWindow`, no
 * globals — so it is unit-testable with a mocked `session.cookies.get`.
 */
export async function harvestCookies(cookieSource: CookieSource): Promise<HarvestedCookies> {
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
export function applyCookies(credsFile: string, harvested: HarvestedCookies): AuthStatus {
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
 * with no cast needed.
 *
 * NOTE (Phase 17 Finding #2): cookie presence alone is NOT a reliable "login
 * captured" signal — an anonymous visit to a login page commonly sets a
 * session/CSRF cookie too. `runLoginFlow` no longer uses this watcher as its
 * capture gate (see {@link watchForNavigationCapture}); it is kept here as a
 * still-useful, independently-tested cookie-watching primitive.
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
 * Classifies a URL as "login-shaped": its pathname contains `login`, `signin`,
 * `sso`, or `auth` as a case-insensitive substring. Deliberately loose — we
 * don't control TI/Basecamp's URL scheme, so this is a heuristic, not an exact
 * match. An unparsable URL is treated as not login-shaped (never blocks
 * capture on a malformed value).
 */
export function looksLikeLoginPage(url: string): boolean {
  try {
    return /login|signin|sso|auth/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * The subset of Electron's `WebContents` needed to watch navigation for the
 * "left the login page" signal. Electron's real `WebContents` (an
 * EventEmitter) satisfies this structurally with no cast needed at the real
 * call site in `openLoginWindow`.
 */
export interface NavigationSource {
  on(event: "did-navigate", listener: (event: unknown, url: string) => void): void;
  on(event: "did-navigate-in-page", listener: (event: unknown, url: string) => void): void;
  off(event: "did-navigate", listener: (event: unknown, url: string) => void): void;
  off(event: "did-navigate-in-page", listener: (event: unknown, url: string) => void): void;
}

/**
 * Resolves once the login window has genuinely navigated away from a
 * login-shaped URL (see {@link looksLikeLoginPage}) AND `isCaptured` is true
 * for the cookies harvested at that moment. Navigation is the *gate* — it is
 * what distinguishes "the login page merely finished its first load" (which
 * commonly sets an anonymous session/CSRF cookie, the Phase 17 Finding #2
 * bug) from "the server actually accepted the credentials" — but the cookies
 * are still the real payload `applyCookies` needs, so they're harvested and
 * checked, not assumed, once navigation clears the gate.
 *
 * Listens to both `did-navigate` (full navigations, including the initial
 * load — so an "already logged in" instant redirect away from the login URL
 * still captures immediately, preserving the pre-existing fast path) and
 * `did-navigate-in-page` (SPA-style same-document URL changes), since it's
 * unknown whether TI/Basecamp's login flow uses full loads or client-side
 * routing. A navigation back onto (or a redisplay of) a login-shaped URL —
 * e.g. a failed-login redisplay with an error query string — does not
 * satisfy the gate and is correctly ignored.
 *
 * `cancel()` unsubscribes both listeners, mirroring {@link watchForCapture}'s
 * shape, so nothing leaks across repeated login attempts if the window
 * closes some other way first.
 */
export function watchForNavigationCapture(
  webContents: NavigationSource,
  cookieSource: CookieSource,
  isCaptured: (h: HarvestedCookies) => boolean,
): { promise: Promise<void>; cancel: () => void } {
  let settled = false;

  const unsubscribe = () => {
    webContents.off("did-navigate", onNavigate);
    webContents.off("did-navigate-in-page", onNavigate);
  };

  let resolveFn!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  function onNavigate(_event: unknown, url: string): void {
    if (settled || looksLikeLoginPage(url)) return;
    void harvestCookies(cookieSource).then((h) => {
      if (settled || !isCaptured(h)) return;
      settled = true;
      unsubscribe();
      resolveFn();
    });
  }

  webContents.on("did-navigate", onNavigate);
  webContents.on("did-navigate-in-page", onNavigate);

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      unsubscribe();
    },
  };
}

/**
 * Console-message signatures (Phase 27) that identify Basecamp's own
 * third-party crash on a fresh, unauthenticated session: a CORS-blocked
 * `login_refresh` XHR sends its client-side error-recovery path (its
 * `ErrorPage` component) into an uncaught exception before it renders
 * anything, leaving the window permanently blank. See the module header
 * "Finding" for the fully root-caused explanation — this is Basecamp's bug,
 * not ours; the signatures below just let us *detect* it without injecting
 * any script into the third-party page. Case-insensitive; the i18n message is
 * the load-bearing one (it's what's actually observed), the CORS/login_refresh
 * pattern is a best-effort second line covering the same failure reported via
 * the browser's default CORS console warning instead.
 */
const FAILURE_SIGNATURES: RegExp[] = [
  /getLocale called before configuring i18n/i,
  /(login_refresh.*cors)|(cors.*login_refresh)/i,
];

/** True when a console message matches one of {@link FAILURE_SIGNATURES}. Exported standalone so the matching logic is unit-testable without a `BrowserWindow`. */
export function isKnownLoginFailureSignature(message: string): boolean {
  return FAILURE_SIGNATURES.some((re) => re.test(message));
}

/** How long {@link openLoginWindow} waits, once a known failure signature has
 *  fired, for the capture signal to resolve on its own before reloading. */
const FAILURE_GRACE_WINDOW_MS = 5000;

/** The maximum number of automatic reloads {@link openLoginWindow} will issue
 *  per call — a genuine Basecamp outage must not retry forever. */
const MAX_AUTO_RELOADS = 2;

/** `new URL(candidate).origin`, or `undefined` if `candidate` isn't a parsable
 *  absolute URL (e.g. `webContents.getURL()` before the first navigation
 *  resolves, which returns `""`). Used by {@link openLoginWindow}'s
 *  `safeReload` to confirm the window is still on the expected origin before
 *  reloading in place. */
function safeOrigin(candidate: string): string | undefined {
  try {
    return new URL(candidate).origin;
  } catch {
    return undefined;
  }
}

/**
 * Opens a login window bound to the persistent partition and resolves once the
 * user closes it — or, when the watcher built by `buildCaptureSignal` resolves
 * first (the expected path: `runLoginFlow` wires it to
 * {@link watchForNavigationCapture}), once the window is closed programmatically
 * so the user isn't left staring at a login page after they've already
 * finished. `buildCaptureSignal` is a factory rather than a plain
 * `Promise<void>` because the navigation watcher needs the window's actual
 * `webContents` to attach its listeners to, which doesn't exist until after
 * the `BrowserWindow` is constructed — so `openLoginWindow` invokes it itself,
 * right after construction and before `loadURL`, and owns calling `.cancel()`
 * on it once the window closes for any reason (captured or manual), so no
 * listener is ever leaked onto a `webContents` whose window has gone away.
 *
 * Resolves `{ gaveUp: true }` when the window closed with the capture signal
 * never having resolved AND the {@link MAX_AUTO_RELOADS} auto-reload cap was
 * reached — i.e. the known third-party crash kept recurring and the window
 * gave up rather than retrying forever (Phase 27). `runLoginFlow` uses this to
 * tell the renderer apart from a plain user-closed-without-logging-in case.
 *
 * Phase 27 resilience, still with NO script injected into the third-party
 * page: a `console-message` listener watches for {@link FAILURE_SIGNATURES}
 * and, if the capture signal hasn't resolved within
 * {@link FAILURE_GRACE_WINDOW_MS} of the signature firing, calls
 * `webContents.reload()` (capped at `MAX_AUTO_RELOADS`); a `before-input-event`
 * listener binds F5/Ctrl+R/Cmd+R to a manual `webContents.reload()`, restoring
 * the reload affordance `autoHideMenuBar: true` otherwise removes. Both are
 * Electron-level listeners on the host window, not content injected into the
 * page — they read/react to the page, they never execute code inside it.
 *
 * Security: the window shows a third-party page, so it runs with
 * `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` and NO
 * preload — it must never reach our IPC bridge. We inject no scripts into it.
 * Needs Electron; kept thin and not unit-tested directly (exercised indirectly
 * via `runLoginFlow`'s `FakeBrowserWindow`-backed tests).
 */
export function openLoginWindow(
  url: string,
  buildCaptureSignal?: (webContents: Electron.WebContents) => {
    promise: Promise<void>;
    cancel: () => void;
  },
): Promise<{ gaveUp: boolean }> {
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

    const capture = buildCaptureSignal?.(win.webContents);

    let captured = false;
    let reloadCount = 0;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const clearGraceTimer = () => {
      if (graceTimer === undefined) return;
      clearTimeout(graceTimer);
      graceTimer = undefined;
    };

    /**
     * `webContents.reload()` reloads whatever URL is *currently* loaded, not
     * necessarily `url`. If the window were ever navigated off the genuine
     * TI/Basecamp origin (e.g. an open redirect on their own site), a page
     * reached that way could deliberately emit a matching console message to
     * make this retry logic keep re-fetching *that* page — `FAILURE_SIGNATURES`
     * is public in this open-source repo. Guard against that: only `reload()`
     * when still on the expected origin; otherwise fall back to `loadURL(url)`,
     * restoring the known-good login page (the same fail-safe a plain
     * close-and-reopen already has).
     */
    const safeReload = () => {
      if (win.isDestroyed()) return;
      const expected = safeOrigin(url);
      const current = safeOrigin(win.webContents.getURL());
      if (expected && current === expected) {
        win.webContents.reload();
      } else {
        void win.loadURL(url);
      }
    };

    const onConsoleMessage = (_event: unknown, _level: unknown, message: string) => {
      if (captured || graceTimer !== undefined || reloadCount >= MAX_AUTO_RELOADS) return;
      if (!isKnownLoginFailureSignature(message)) return;
      graceTimer = setTimeout(() => {
        graceTimer = undefined;
        if (captured || win.isDestroyed()) return;
        reloadCount += 1;
        safeReload();
      }, FAILURE_GRACE_WINDOW_MS);
    };
    win.webContents.on("console-message", onConsoleMessage);

    const onBeforeInput = (_event: unknown, input: Electron.Input) => {
      if (input.type !== "keyDown" || win.isDestroyed()) return;
      const isF5 = input.key === "F5";
      const isReloadShortcut = (input.control || input.meta) && input.key.toLowerCase() === "r";
      if (isF5 || isReloadShortcut) safeReload();
    };
    win.webContents.on("before-input-event", onBeforeInput);

    win.once("closed", () => {
      capture?.cancel();
      clearGraceTimer();
      win.webContents.off("console-message", onConsoleMessage);
      win.webContents.off("before-input-event", onBeforeInput);
      resolve({ gaveUp: !captured && reloadCount >= MAX_AUTO_RELOADS });
    });

    if (capture) {
      void capture.promise.then(() => {
        captured = true;
        clearGraceTimer();
        capture.cancel();
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
 * → apply. Each window auto-closes as soon as {@link watchForNavigationCapture}
 * sees the window navigate away from a login-shaped URL AND the relevant cookie
 * has landed, so the user gets immediate feedback that the login completed
 * instead of having to close the window themselves — without the Phase 17
 * Finding #2 false positive of treating a merely-loaded login page's anonymous
 * cookies as a completed login. The per-step logs are how the user's manual
 * validation determines the SSO-vs-two-login question.
 *
 * Phase 27: if the Basecamp window gives up (see {@link openLoginWindow})
 * after exhausting its auto-reload retries on Basecamp's own third-party
 * crash, and the `sessionid` cookie still never landed, the returned
 * {@link LoginResult} carries `basecampGaveUp: true` so the renderer can show
 * a distinct message instead of a silent "no cookies captured". The TI-only
 * fast path (no Basecamp window opened at all) never sets it.
 */
export async function runLoginFlow(credsFile: string): Promise<LoginResult> {
  const loginSession = session.fromPartition(LOGIN_PARTITION);
  const cookies = loginSession.cookies;

  await openLoginWindow(TI_LOGIN_URL, (webContents) =>
    watchForNavigationCapture(
      webContents,
      cookies,
      (h) => Boolean(h.tiCookie) || Boolean(h.basecampSessionId),
    ),
  );
  let harvested = await harvestCookies(cookies);
  logHarvest("after TI login", harvested);

  let basecampGaveUp = false;
  if (!harvested.basecampSessionId) {
    const { gaveUp } = await openLoginWindow(BASECAMP_LOGIN_URL, (webContents) =>
      watchForNavigationCapture(webContents, cookies, (h) => Boolean(h.basecampSessionId)),
    );
    basecampGaveUp = gaveUp;
    harvested = await harvestCookies(cookies);
    logHarvest("after Basecamp login", harvested);
  }

  const applied = applyCookies(credsFile, harvested);
  logger.info("login applied", { basecamp: applied.basecamp, ti: applied.ti });

  const result: LoginResult = { ...applied };
  if (basecampGaveUp && !applied.basecamp) {
    result.basecampGaveUp = true;
    logger.warn("basecamp login gave up after exhausting auto-reload retries");
  }
  return result;
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

/**
 * Removes every cookie Electron's `cookies.get` reports for `url`, one at a
 * time via `cookies.remove(url, name)`. Symmetric with `harvestCookies`
 * above, which reads cookies the exact same way (`cookieSource.get({ url })`)
 * — so "what login harvests" and "what logout removes" are provably the same
 * set. Deliberately not `sess.clearStorageData({ origin })`: besides taking a
 * bare origin (no trailing slash / path) rather than the full cookie URLs
 * used elsewhere in this module, `clearStorageData` is documented upstream in
 * Electron as unreliable specifically for cookies, and was observed in manual
 * testing to silently leave the session partition authenticated.
 */
async function clearCookiesForUrl(sess: Session, url: string): Promise<void> {
  const cookies = await sess.cookies.get({ url });
  await Promise.all(cookies.map((c) => sess.cookies.remove(url, c.name)));
}

/**
 * Clears the Toastmasters session for real (Phase 17).
 *
 * `config.env` is only ever a durable *copy* of whatever cookies the persistent
 * partition (`LOGIN_PARTITION`) holds — `applyCookies` writes it, but never the
 * other way around. So blanking `BASECAMP_SESSIONID` / `TI_COOKIE` in
 * `config.env` alone is cosmetic: the partition's cookie jar is still live on
 * disk, and the startup self-heal in `index.ts` (which re-harvests from that
 * same partition on every launch) would just rewrite the blanked lines right
 * back in, silently undoing the "logout". This function clears the partition's
 * cookies for the Basecamp and TI origins specifically — never the whole
 * partition — so nothing else stored there is disturbed, via `sess.cookies.get`
 * + `sess.cookies.remove` (see {@link clearCookiesForUrl}), then clears the
 * live `process.env` and the durable `config.env` copy to match. Returns the
 * resulting `AuthStatus` (re-derived from the now-cleared session, not assumed)
 * so the caller can confirm the session is genuinely cleared.
 */
export async function logOut(credsFile: string, sess: Session): Promise<AuthStatus> {
  await clearCookiesForUrl(sess, BASECAMP_COOKIE_URL);
  await clearCookiesForUrl(sess, TI_COOKIE_URL);

  delete process.env.BASECAMP_SESSIONID;
  delete process.env.TI_COOKIE;
  upsertCredential(credsFile, "BASECAMP_SESSIONID", "");
  upsertCredential(credsFile, "TI_COOKIE", "");

  return currentAuthStatus(sess);
}

function logHarvest(stage: string, harvested: HarvestedCookies): void {
  logger.info(`${stage} — cookie harvest`, {
    basecampSessionId: harvested.basecampSessionId ? "captured" : "missing",
    tiCookie: harvested.tiCookie ? "captured" : "missing",
  });
}
