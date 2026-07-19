import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Phase 12 — the pure, core-free cookie helpers in src/main/auth.ts.
 *
 * `harvestCookies` and `applyCookies` decide what the scrapers authenticate with,
 * so their edge cases are safety-critical: a botched harvest that returns an empty
 * string, or an apply that writes it, would silently WIPE a still-valid credential
 * and break every subsequent refresh. These tests attack exactly those failure
 * modes with a mocked cookie source and a throwaway config.env in the OS temp dir —
 * never the real userData file, never the repo .env.
 *
 * auth.ts statically imports { BrowserWindow, session } from "electron", which does
 * not exist in a plain node test process, so electron is mocked at the module
 * boundary. The mock is proven engaged below before anything else runs.
 *
 * Phase 24 — every write auth.ts makes (`applyCookies`, `logOut`) now flows
 * through `upsertCredential`, which encrypts via `safeStorage` (also mocked
 * below, with a fake but non-identity, reversible cipher). Tests here that
 * assert on config.env's exact on-disk contents therefore decrypt the stored
 * value back via `CredentialCipher` rather than string-matching the raw
 * plaintext, which is no longer what's on disk once safeStorage reports
 * encryption as available (the default for the mock).
 */

/**
 * The `webContents` fake attached to every `FakeBrowserWindow` below, and also
 * usable standalone for the `watchForNavigationCapture` unit tests. It is an
 * `on`/`off`/fire event-emitter stub for exactly the two navigation events
 * `watchForNavigationCapture` listens to — `did-navigate` (full navigations,
 * including the initial load) and `did-navigate-in-page` (SPA-style
 * same-document URL changes) — mirroring Electron's real argument shape
 * `(event, url)` (a few Electron events carry more args; this module only
 * reads `url`, so the fake only carries `url`).
 */
const { FakeBrowserWindow, FakeWebContents } = vi.hoisted(() => {
  class FakeWebContents {
    private listeners: Record<string, Array<(event: unknown, url: string) => void>> = {
      "did-navigate": [],
      "did-navigate-in-page": [],
    };

    on(event: string, listener: (event: unknown, url: string) => void): void {
      this.listeners[event]?.push(listener);
    }

    off(event: string, listener: (event: unknown, url: string) => void): void {
      const arr = this.listeners[event];
      if (!arr) return;
      const i = arr.indexOf(listener);
      if (i !== -1) arr.splice(i, 1);
    }

    fireDidNavigate(url: string): void {
      for (const l of [...this.listeners["did-navigate"]]) l(undefined, url);
    }

    fireDidNavigateInPage(url: string): void {
      for (const l of [...this.listeners["did-navigate-in-page"]]) l(undefined, url);
    }
  }

  /**
   * The `BrowserWindow` fake used by the `runLoginFlow`/`openLoginWindow` wiring
   * tests below. It is deliberately a *behavioural* fake, not a stub: `close()`
   * synchronously invokes whatever `once("closed", cb)` registered — mirroring
   * how Electron itself fires "closed" once the native window is torn down —
   * and `isDestroyed()` reflects that. Every constructed instance is pushed onto
   * a static `instances` array so a test can inspect (and manually "close",
   * simulating the OS, or fire navigation events on `.webContents`) whichever
   * login window `runLoginFlow` opened, the same pattern `tests/main-ipc.test.ts`
   * uses for its `windowOptions` capture.
   */
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    closedCallback: (() => void) | null = null;
    destroyed = false;
    webContents = new FakeWebContents();

    constructor(_options?: unknown) {
      FakeBrowserWindow.instances.push(this);
    }

    once(event: string, cb: () => void): void {
      if (event === "closed") this.closedCallback = cb;
    }

    /** Mirrors the real BrowserWindow: closing fires the registered "closed" listener. */
    close(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.closedCallback?.();
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    loadURL(): Promise<void> {
      return Promise.resolve();
    }
  }
  // Declared inside `vi.hoisted` because `vi.mock` factories are hoisted above
  // every other statement in the file (including plain `class` declarations),
  // so a class referenced by the factory must be hoisted along with it or the
  // factory would see it as not-yet-initialized.
  return { FakeBrowserWindow, FakeWebContents };
});

/**
 * `safeStorage` mock (Phase 24): `upsertCredential` (via `CredentialCipher`)
 * calls `safeStorage.isEncryptionAvailable()`/`encryptString`/`decryptString`
 * on every write, so any auth.ts path that persists a cookie (applyCookies,
 * logOut, runLoginFlow) now reaches into this mock too. Defaults to
 * "encryption available" with a reversible identity-ish transform (prefix the
 * plaintext with a tag, strip it back off) — none of the tests in this file
 * care about the *cipher* itself, only that credentials.ts's own encrypt/
 * decrypt/rewrite plumbing (covered directly in credentials.test.ts) doesn't
 * blow up when auth.ts's write paths run through it.
 */
const FAKE_ENCRYPTED_TAG = "fake-encrypted:";
vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  session: { fromPartition: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`${FAKE_ENCRYPTED_TAG}${value}`, "utf-8")),
    decryptString: vi.fn((buf: Buffer) => buf.toString("utf-8").slice(FAKE_ENCRYPTED_TAG.length)),
  },
}));

import * as electron from "electron";
import {
  applyCookies,
  currentAuthStatus,
  harvestCookies,
  logOut,
  looksLikeLoginPage,
  runLoginFlow,
  watchForCapture,
  watchForNavigationCapture,
  BASECAMP_LOGIN_URL,
  BASECAMP_COOKIE_URL,
  type CookieSource,
  type CookieWatcher,
  type HarvestedCookies,
  type NavigationSource,
} from "../src/main/auth";
import { CredentialCipher, loadCredentials } from "../src/main/credentials";

/** Extracts the raw stored value for `key`'s line in a config.env's contents,
 *  decrypting it first if it carries the Phase 24 `enc:v1:` prefix — the
 *  round-trip counterpart to string-matching a plaintext value, since
 *  `upsertCredential` now encrypts by default (the mocked safeStorage above
 *  reports encryption as available unless a test overrides it). */
function storedValue(fileContents: string, key: string): string {
  const line = fileContents.split("\n").find((l) => l.startsWith(`${key}=`));
  if (line === undefined) throw new Error(`no ${key}= line found`);
  const raw = line.slice(key.length + 1);
  return CredentialCipher.isEncrypted(raw) ? CredentialCipher.decrypt(raw) : raw;
}

/** A cookie source whose `.get({url})` returns a canned list keyed by URL. */
function cookieSource(byUrl: Record<string, Array<{ name: string; value: string }>>): CookieSource {
  return {
    get: vi.fn(async ({ url }: { url: string }) => byUrl[url] ?? []),
  };
}

/**
 * A mutable cookie source that also implements the `on`/`off` "changed" event
 * pair `watchForCapture` needs, so a test can simulate Chromium's cookie-changed
 * event by mutating `byUrl` and then calling `.fireChanged()`. A plain manual
 * listener-array stub — no EventEmitter dependency needed.
 */
function cookieWatcher(
  byUrl: Record<string, Array<{ name: string; value: string }>>,
): CookieWatcher & { fireChanged: () => void } {
  const listeners: Array<() => void> = [];
  return {
    get: vi.fn(async ({ url }: { url: string }) => byUrl[url] ?? []),
    on: (_event, listener) => {
      listeners.push(listener);
    },
    off: (_event, listener) => {
      const i = listeners.indexOf(listener);
      if (i !== -1) listeners.splice(i, 1);
    },
    fireChanged: () => {
      for (const l of [...listeners]) l();
    },
  };
}

/**
 * A standalone `NavigationSource` fake for the `watchForNavigationCapture`
 * unit tests below — the same shape as `FakeWebContents` above, but usable
 * without going through a `FakeBrowserWindow`/`openLoginWindow`.
 */
function fakeWebContents(): NavigationSource & {
  fireDidNavigate: (url: string) => void;
  fireDidNavigateInPage: (url: string) => void;
} {
  const listeners: Record<string, Array<(event: unknown, url: string) => void>> = {
    "did-navigate": [],
    "did-navigate-in-page": [],
  };
  return {
    on: (event, listener) => {
      listeners[event].push(listener);
    },
    off: (event, listener) => {
      const arr = listeners[event];
      const i = arr.indexOf(listener);
      if (i !== -1) arr.splice(i, 1);
    },
    fireDidNavigate: (url) => {
      for (const l of [...listeners["did-navigate"]]) l(undefined, url);
    },
    fireDidNavigateInPage: (url) => {
      for (const l of [...listeners["did-navigate-in-page"]]) l(undefined, url);
    },
  };
}

const BASECAMP_URL = "https://basecamp.toastmasters.org/";
const TI_URL = "https://www.toastmasters.org/";

const ENV_KEYS = ["BASECAMP_SESSIONID", "TI_COOKIE"] as const;
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;
let credsFile: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  tmpDir = mkdtempSync(join(tmpdir(), "tm-auth-"));
  credsFile = join(tmpDir, "config.env");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the electron mock is actually engaged (guards against a silent no-op)", () => {
  it("replaces session.fromPartition with a vitest mock", () => {
    expect(vi.isMockFunction(electron.session.fromPartition)).toBe(true);
  });
});

describe("harvestCookies picks the Basecamp sessionid by NAME", () => {
  it("returns the sessionid value as basecampSessionId when present", async () => {
    const src = cookieSource({ [BASECAMP_URL]: [{ name: "sessionid", value: "SID-123" }] });

    const harvested = await harvestCookies(src);

    expect(harvested.basecampSessionId).toBe("SID-123");
  });

  it("finds sessionid even when other cookies surround it (not the first, not the last)", async () => {
    const src = cookieSource({
      [BASECAMP_URL]: [
        { name: "csrftoken", value: "CSRF-should-not-win" },
        { name: "sessionid", value: "SID-REAL" },
        { name: "ai_user", value: "telemetry-should-not-win" },
      ],
    });

    const harvested = await harvestCookies(src);

    // By NAME, not by position: a naive `cookies[0].value` would return
    // "CSRF-should-not-win" here.
    expect(harvested.basecampSessionId).toBe("SID-REAL");
  });

  it("omits basecampSessionId when no sessionid cookie exists", async () => {
    const src = cookieSource({ [BASECAMP_URL]: [{ name: "csrftoken", value: "x" }] });

    const harvested = await harvestCookies(src);

    expect(harvested.basecampSessionId).toBeUndefined();
  });

  it("omits basecampSessionId when the sessionid cookie is present but empty", async () => {
    const src = cookieSource({ [BASECAMP_URL]: [{ name: "sessionid", value: "" }] });

    const harvested = await harvestCookies(src);

    expect(harvested.basecampSessionId).toBeUndefined();
  });

  it("queries the Basecamp origin explicitly", async () => {
    const src = cookieSource({ [BASECAMP_URL]: [{ name: "sessionid", value: "SID" }] });

    await harvestCookies(src);

    expect(src.get).toHaveBeenCalledWith({ url: BASECAMP_URL });
  });
});

describe("harvestCookies joins the TI cookies into one Cookie-header string", () => {
  it("joins every www.toastmasters.org cookie as name=value with '; ', preserving order", async () => {
    const src = cookieSource({
      [TI_URL]: [
        { name: "ASP.NET_SessionId", value: "aaa" },
        { name: "sc_analytics", value: "bbb" },
        { name: "auth_token", value: "ccc" },
      ],
    });

    const harvested = await harvestCookies(src);

    // A naive `join(",")` would produce commas, which is NOT a valid Cookie header
    // separator; order is preserved so it matches what the browser would send.
    expect(harvested.tiCookie).toBe(
      "ASP.NET_SessionId=aaa; sc_analytics=bbb; auth_token=ccc",
    );
  });

  it("omits tiCookie (rather than storing an empty string) when TI has no cookies", async () => {
    const src = cookieSource({ [TI_URL]: [] });

    const harvested = await harvestCookies(src);

    // Critical: an empty string here would later OVERWRITE a good TI_COOKIE.
    expect(harvested.tiCookie).toBeUndefined();
    expect("tiCookie" in harvested).toBe(false);
  });

  it("queries the TI origin explicitly", async () => {
    const src = cookieSource({ [TI_URL]: [{ name: "x", value: "1" }] });

    await harvestCookies(src);

    expect(src.get).toHaveBeenCalledWith({ url: TI_URL });
  });
});

describe("applyCookies never lets an empty harvest wipe a good credential", () => {
  it("leaves both process.env and config.env untouched when the harvest is empty", () => {
    // Pre-seed a KNOWN-GOOD state, exactly as a prior successful login would leave it.
    process.env.BASECAMP_SESSIONID = "good-basecamp";
    process.env.TI_COOKIE = "good-ti";
    const goodFile =
      "# comment\nBASECAMP_SESSIONID=good-basecamp\nTI_COOKIE=good-ti\nCLUB_ID=\n";
    writeFileSync(credsFile, goodFile, "utf-8");

    const applied = applyCookies(credsFile, {});

    expect(applied).toEqual({ basecamp: false, ti: false });
    // The live env is untouched — the next refresh still uses the good cookies.
    expect(process.env.BASECAMP_SESSIONID).toBe("good-basecamp");
    expect(process.env.TI_COOKIE).toBe("good-ti");
    // The durable file is byte-for-byte unchanged.
    expect(readFileSync(credsFile, "utf-8")).toBe(goodFile);
  });

  it("applies only the Basecamp cookie on a Basecamp-only harvest", () => {
    process.env.TI_COOKIE = "good-ti";
    writeFileSync(credsFile, "BASECAMP_SESSIONID=\nTI_COOKIE=good-ti\n", "utf-8");

    const applied = applyCookies(credsFile, { basecampSessionId: "new-sid" });

    expect(applied).toEqual({ basecamp: true, ti: false });
    expect(process.env.BASECAMP_SESSIONID).toBe("new-sid");
    // The untouched TI credential survives verbatim in both env and file —
    // applyCookies never even calls upsertCredential for it here, so it was
    // never re-encrypted either.
    expect(process.env.TI_COOKIE).toBe("good-ti");
    const written = readFileSync(credsFile, "utf-8");
    expect(written).toContain("TI_COOKIE=good-ti");
    // The Basecamp credential WAS written via upsertCredential, so (Phase 24)
    // it is now encrypted on disk — decrypt it back to prove the right value
    // landed, and separately prove it's genuinely encrypted (not left plain).
    expect(storedValue(written, "BASECAMP_SESSIONID")).toBe("new-sid");
    expect(written).not.toContain("BASECAMP_SESSIONID=new-sid");
  });

  it("applies only the TI cookie on a TI-only harvest", () => {
    process.env.BASECAMP_SESSIONID = "good-sid";
    writeFileSync(credsFile, "BASECAMP_SESSIONID=good-sid\nTI_COOKIE=\n", "utf-8");

    const applied = applyCookies(credsFile, { tiCookie: "a=1; b=2" });

    expect(applied).toEqual({ basecamp: false, ti: true });
    expect(process.env.TI_COOKIE).toBe("a=1; b=2");
    expect(process.env.BASECAMP_SESSIONID).toBe("good-sid");
    const written = readFileSync(credsFile, "utf-8");
    // The untouched Basecamp credential was never re-written, so it stays
    // plaintext exactly as it started.
    expect(written).toContain("BASECAMP_SESSIONID=good-sid");
    expect(storedValue(written, "TI_COOKIE")).toBe("a=1; b=2");
    expect(written).not.toContain("TI_COOKIE=a=1; b=2");
  });

  it("applies both cookies and reports both flags when a full harvest arrives", () => {
    const harvested: HarvestedCookies = {
      basecampSessionId: "sid-full",
      tiCookie: "x=1; y=2",
    };

    const applied = applyCookies(credsFile, harvested);

    expect(applied).toEqual({ basecamp: true, ti: true });
    expect(process.env.BASECAMP_SESSIONID).toBe("sid-full");
    expect(process.env.TI_COOKIE).toBe("x=1; y=2");
    const written = readFileSync(credsFile, "utf-8");
    expect(storedValue(written, "BASECAMP_SESSIONID")).toBe("sid-full");
    expect(storedValue(written, "TI_COOKIE")).toBe("x=1; y=2");
  });
});

describe("currentAuthStatus reports which cookies are currently held", () => {
  it("is true/true when both cookies are present in the session", async () => {
    const sess = {
      cookies: cookieSource({
        [BASECAMP_URL]: [{ name: "sessionid", value: "sid" }],
        [TI_URL]: [{ name: "a", value: "1" }],
      }),
    } as unknown as Parameters<typeof currentAuthStatus>[0];

    expect(await currentAuthStatus(sess)).toEqual({ basecamp: true, ti: true });
  });

  it("is false/false when the session holds neither cookie", async () => {
    const sess = {
      cookies: cookieSource({ [BASECAMP_URL]: [], [TI_URL]: [] }),
    } as unknown as Parameters<typeof currentAuthStatus>[0];

    expect(await currentAuthStatus(sess)).toEqual({ basecamp: false, ti: false });
  });

  it("reflects a partial session (Basecamp only) as basecamp:true, ti:false", async () => {
    const sess = {
      cookies: cookieSource({
        [BASECAMP_URL]: [{ name: "sessionid", value: "sid" }],
        [TI_URL]: [],
      }),
    } as unknown as Parameters<typeof currentAuthStatus>[0];

    expect(await currentAuthStatus(sess)).toEqual({ basecamp: true, ti: false });
  });
});

/**
 * A fake `Session` for `logOut` tests. `cookies.get`/`cookies.remove` are
 * wired to the same `byUrl` store: `get` reads it directly (via the shared
 * `cookieSource` helper), and `remove` records every call (so a test can
 * assert the exact url/name arguments) and, by default, behaves like a
 * genuine removal — deleting the named cookie from `byUrl` so a subsequent
 * `currentAuthStatus` re-check sees the real post-clear state. Passing
 * `removeReallyWorks: false` simulates Electron's `cookies.remove` resolving
 * successfully while the underlying cookie store stays stale — the exact
 * "silent no-op" failure mode `logOut` exists to fix (see auth.ts's doc
 * comment on `logOut` and the bug report that motivated Phase 17).
 */
function fakeSession(
  byUrl: Record<string, Array<{ name: string; value: string }>>,
  { removeReallyWorks = true }: { removeReallyWorks?: boolean } = {},
): { cookies: CookieSource & { remove: ReturnType<typeof vi.fn> } } {
  return {
    cookies: {
      ...cookieSource(byUrl),
      remove: vi.fn(async (url: string, name: string) => {
        if (removeReallyWorks) {
          byUrl[url] = (byUrl[url] ?? []).filter((c) => c.name !== name);
        }
      }),
    },
  };
}

describe("logOut clears the real session partition, not just config.env (Phase 17)", () => {
  it("removes each cookie individually, scoped to its own url — never a bare whole-partition clear", async () => {
    const byUrl = {
      [BASECAMP_URL]: [{ name: "sessionid", value: "sid" }],
      [TI_URL]: [{ name: "a", value: "1" }],
    };
    const sess = fakeSession(byUrl);

    await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    // Exact call arguments, not just "was called": logOut must enumerate via
    // cookies.get and remove each cookie by name, scoped to its own url — the
    // same per-origin scoping `harvestCookies` already reads with, so nothing
    // outside these two origins is ever touched. If the source regressed to
    // some blanket clear, `toHaveBeenCalledTimes(2)` below would go red (a
    // different call count), and the per-argument assertions would go red too.
    expect(sess.cookies.remove).toHaveBeenCalledTimes(2);
    expect(sess.cookies.remove).toHaveBeenCalledWith(BASECAMP_URL, "sessionid");
    expect(sess.cookies.remove).toHaveBeenCalledWith(TI_URL, "a");
    expect(sess.cookies.remove).not.toHaveBeenCalledWith();
    expect(sess.cookies.remove).not.toHaveBeenCalledWith(undefined);
  });

  it("removes EVERY cookie in a multi-cookie jar individually, not just the first one found", async () => {
    // Mirrors harvestCookies's own multi-cookie TI test data above: a
    // realistic TI cookie jar holds several cookies at once, so a `logOut`
    // that (e.g.) only removed cookies[0] would still leave the session
    // authenticated via the others.
    const byUrl = {
      [BASECAMP_URL]: [{ name: "sessionid", value: "sid" }],
      [TI_URL]: [
        { name: "ASP.NET_SessionId", value: "aaa" },
        { name: "sc_analytics", value: "bbb" },
        { name: "auth_token", value: "ccc" },
      ],
    };
    const sess = fakeSession(byUrl);

    const status = await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    expect(sess.cookies.remove).toHaveBeenCalledTimes(4);
    expect(sess.cookies.remove).toHaveBeenCalledWith(TI_URL, "ASP.NET_SessionId");
    expect(sess.cookies.remove).toHaveBeenCalledWith(TI_URL, "sc_analytics");
    expect(sess.cookies.remove).toHaveBeenCalledWith(TI_URL, "auth_token");
    // The session is genuinely empty afterwards — not just "removed the
    // first cookie and gave up", which harvestCookies's post-clear re-check
    // would still see as a still-present TI cookie (joining the leftovers).
    expect(status).toEqual({ basecamp: false, ti: false });
  });

  it("clears both live process.env cookie values", async () => {
    process.env.BASECAMP_SESSIONID = "good-basecamp";
    process.env.TI_COOKIE = "good-ti";
    const byUrl = { [BASECAMP_URL]: [], [TI_URL]: [] };
    const sess = fakeSession(byUrl);

    await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    expect(process.env.BASECAMP_SESSIONID).toBeUndefined();
    expect(process.env.TI_COOKIE).toBeUndefined();
  });

  it("blanks the config.env cookie lines in place, leaving comments and unrelated keys untouched", async () => {
    const original =
      "# setup instructions\nBASECAMP_SESSIONID=real-sid\nTI_COOKIE=real-ti-cookie\nCLUB_ID=1234567\n";
    writeFileSync(credsFile, original, "utf-8");
    const byUrl = { [BASECAMP_URL]: [], [TI_URL]: [] };
    const sess = fakeSession(byUrl);

    await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    const written = readFileSync(credsFile, "utf-8");
    // Blanked, not deleted: the key stays so a future login can upsert it
    // again, and the file remains a valid template. Phase 24: `upsertCredential`
    // always encrypts what it writes — even an empty string — so the line is
    // no longer a literal "KEY=" blank; it's an enc:v1: line that DECRYPTS
    // back to "".
    expect(storedValue(written, "BASECAMP_SESSIONID")).toBe("");
    expect(storedValue(written, "TI_COOKIE")).toBe("");
    const sidLine = written.split("\n").find((l) => l.startsWith("BASECAMP_SESSIONID="));
    const tiLine = written.split("\n").find((l) => l.startsWith("TI_COOKIE="));
    expect(sidLine!.slice("BASECAMP_SESSIONID=".length).startsWith("enc:v1:")).toBe(true);
    expect(tiLine!.slice("TI_COOKIE=".length).startsWith("enc:v1:")).toBe(true);
    expect(written).not.toContain("real-sid");
    expect(written).not.toContain("real-ti-cookie");
    // Unrelated lines survive verbatim — logOut must not touch anything it
    // doesn't own.
    expect(written).toContain("# setup instructions");
    expect(written).toContain("CLUB_ID=1234567");
  });

  it("Phase 24 logout parity: blanking via the new encrypted path is treated as unset on a fresh loadCredentials, exactly as a literal plaintext blank was before Phase 24", async () => {
    const original = "BASECAMP_SESSIONID=real-sid\nTI_COOKIE=real-ti-cookie\n";
    writeFileSync(credsFile, original, "utf-8");
    const byUrl = { [BASECAMP_URL]: [], [TI_URL]: [] };
    const sess = fakeSession(byUrl);

    await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    // Simulate a fresh app start reading the file back from scratch, as
    // index.ts's bootstrap does — not just inspecting the in-memory
    // process.env logOut already cleared directly.
    delete process.env.BASECAMP_SESSIONID;
    delete process.env.TI_COOKIE;
    loadCredentials(credsFile);

    expect(process.env.BASECAMP_SESSIONID).toBeUndefined();
    expect(process.env.TI_COOKIE).toBeUndefined();
  });

  it("returns basecamp:false, ti:false derived from the session genuinely being empty after the clear", async () => {
    const byUrl = {
      [BASECAMP_URL]: [{ name: "sessionid", value: "sid" }],
      [TI_URL]: [{ name: "a", value: "1" }],
    };
    const sess = fakeSession(byUrl, { removeReallyWorks: true });

    const status = await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    expect(status).toEqual({ basecamp: false, ti: false });
  });

  it("negative control: reports basecamp:true when cookies.remove silently fails to actually clear the cookie store — proving the return value is re-derived live, not hardcoded", async () => {
    const byUrl = {
      [BASECAMP_URL]: [{ name: "sessionid", value: "sid" }],
      [TI_URL]: [],
    };
    // removeReallyWorks: false simulates Electron resolving cookies.remove
    // successfully while the underlying cookie store stays stale — the exact
    // silent-no-op bug this feature exists to fix (deleting cookies from
    // config.env by hand didn't actually log the app out either).
    const sess = fakeSession(byUrl, { removeReallyWorks: false });

    const status = await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    // Proves remove was genuinely attempted (not skipped) — without this,
    // a `logOut` that forgot to call `cookies.remove` at all would land on
    // this exact same byUrl state (cookie never removed either way) and
    // would wrongly make the assertion below look like it "caught" the bug.
    expect(sess.cookies.remove).toHaveBeenCalledWith(BASECAMP_URL, "sessionid");

    // A `logOut` that hand-waved success by returning a hardcoded
    // `{ basecamp: false, ti: false }` would make this assertion fail: the
    // session here truthfully still holds the Basecamp cookie, so a
    // genuinely-live re-check via currentAuthStatus(sess) must report
    // basecamp:true — the opposite of what a hardcoded "success" value would
    // claim. This is the actual regression test for the bug Phase 17 fixes.
    expect(status).toEqual({ basecamp: true, ti: false });
  });

  it("propagates a rejection from cookies.remove rather than swallowing it", async () => {
    const err = new Error("cookies.remove failed: partition locked");
    const sess = {
      cookies: {
        get: vi.fn(async () => [{ name: "sessionid", value: "sid" }]),
        remove: vi.fn().mockRejectedValueOnce(err),
      },
    };

    // The IPC handler (main/index.ts) needs to see a failed logout as a
    // genuine error, not a silent no-op that reports success anyway.
    await expect(
      logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]),
    ).rejects.toThrow("cookies.remove failed: partition locked");
  });

  it("does not touch an unrelated credential (CLUB_ID) or write to the file when nothing needs clearing", async () => {
    writeFileSync(credsFile, "CLUB_ID=9999999\n", "utf-8");
    const byUrl = { [BASECAMP_URL]: [], [TI_URL]: [] };
    const sess = fakeSession(byUrl);

    await logOut(credsFile, sess as unknown as Parameters<typeof logOut>[1]);

    const written = readFileSync(credsFile, "utf-8");
    expect(written).toContain("CLUB_ID=9999999");
  });
});

describe("watchForCapture resolves as soon as the target cookie is captured", () => {
  it("resolves immediately when the cookie is already present, with no 'changed' event needed", async () => {
    const src = cookieWatcher({ [BASECAMP_URL]: [{ name: "sessionid", value: "sid" }] });

    const { promise } = watchForCapture(src, (h) => Boolean(h.basecampSessionId));

    // Resolves purely from the immediate check() call inside watchForCapture —
    // no fireChanged() call happens before this await.
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves after a 'changed' event once the mocked cookie source starts returning the target cookie", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
    };
    const src = cookieWatcher(byUrl);

    const { promise } = watchForCapture(src, (h) => Boolean(h.basecampSessionId));

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    // Give the immediate check() a turn to run and see the cookie is absent.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // The cookie lands, Chromium fires "changed" — simulate both.
    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "sid" }];
    src.fireChanged();

    await expect(promise).resolves.toBeUndefined();
  });
});

describe("watchForCapture: cancel() is a real unsubscribe, not a no-op (adversarial)", () => {
  it("never resolves from a 'changed' event fired after cancel() — proven with a `.then` spy plus a microtask flush", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
    };
    const src = cookieWatcher(byUrl);

    const { promise, cancel } = watchForCapture(src, (h) => Boolean(h.basecampSessionId));

    const thenSpy = vi.fn();
    void promise.then(thenSpy);

    // Let the immediate check() run and see the cookie absent — the spy must
    // not yet have fired.
    await Promise.resolve();
    await Promise.resolve();
    expect(thenSpy).not.toHaveBeenCalled();

    cancel();

    // The cookie now lands and Chromium fires "changed" — but cancel() already
    // unsubscribed, so this must be a no-op as far as the promise is concerned.
    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "sid" }];
    src.fireChanged();

    // Flush every microtask the harvestCookies().then(...) chain inside
    // check() would need, in case cancel() failed to stop it.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(thenSpy).not.toHaveBeenCalled();
  });

  /*
   * NEGATIVE CONTROL (do not leave this in place — it is documentation, run by hand):
   * With `cancel()` in src/main/auth.ts temporarily replaced by a no-op —
   *
   *   cancel: () => {},
   *
   * — the test above goes RED: `thenSpy` gets called once the post-cancel
   * `fireChanged()` lands, because nothing stopped `check()` from still seeing
   * the listener and resolving. This confirms the test actually exercises
   * cancel()'s unsubscribe behaviour rather than passing vacuously.
   */
});

describe("watchForCapture: repeated 'changed' events before capture (adversarial)", () => {
  it("resolves only on the event where the predicate turns true, and calls off() exactly once — not once per event", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
    };
    const src = cookieWatcher(byUrl);
    const offSpy = vi.spyOn(src, "off");

    const { promise } = watchForCapture(src, (h) => Boolean(h.basecampSessionId));

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    // The immediate check() sees the cookie absent.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(offSpy).not.toHaveBeenCalled();

    // Two more "changed" events fire while the cookie is still absent.
    src.fireChanged();
    await Promise.resolve();
    await Promise.resolve();
    src.fireChanged();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(offSpy).not.toHaveBeenCalled();

    // Now the cookie lands and a final "changed" event fires — this is the
    // only event that should resolve the promise and unsubscribe.
    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "sid" }];
    src.fireChanged();

    await expect(promise).resolves.toBeUndefined();
    expect(offSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * NEGATIVE CONTROL (documentation, run by hand):
   * With the guard in `check()`'s `.then` callback in src/main/auth.ts changed
   * from:
   *
   *   if (settled || !isCaptured(h)) return;
   *   settled = true;
   *   cookieSource.off("changed", check);
   *   resolveFn();
   *
   * to unconditionally deregister on every event, e.g.:
   *
   *   cookieSource.off("changed", check);
   *   if (settled || !isCaptured(h)) return;
   *   settled = true;
   *   resolveFn();
   *
   * the test above goes RED: `offSpy` is already called after the very first
   * (immediate, cookie-absent) check — well before any "changed" event fires —
   * so `expect(offSpy).not.toHaveBeenCalled()` fails immediately after the
   * first flush. (Because the listener is removed that early, the later
   * "changed" events never even reach `check()` again, so the promise then
   * never resolves either — the final `await expect(promise).resolves...`
   * times out red as well.) This confirms the test would catch an
   * over-eager/duplicate unsubscribe.
   */
});

describe("watchForCapture: the predicate must see the FULL current cookie state, not just 'something changed' (adversarial)", () => {
  it("does not resolve when a 'changed' event brings in the TI cookie but not the Basecamp sessionid being watched for", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const src = cookieWatcher(byUrl);

    const { promise } = watchForCapture(src, (h) => Boolean(h.basecampSessionId));

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // A "changed" event fires, but only the TI cookie showed up — not the
    // Basecamp sessionid this watch cares about.
    byUrl[TI_URL] = [{ name: "auth", value: "abc" }];
    src.fireChanged();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolved).toBe(false);

    // Sanity check the watch is still alive and correctly wired: it resolves
    // once the actually-awaited cookie lands.
    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "sid" }];
    src.fireChanged();

    await expect(promise).resolves.toBeUndefined();
  });

  /*
   * NEGATIVE CONTROL (documentation, run by hand):
   * With the guard in `check()`'s `.then` callback in src/main/auth.ts changed
   * from:
   *
   *   if (settled || !isCaptured(h)) return;
   *
   * to drop the predicate check entirely:
   *
   *   if (settled) return;
   *
   * the test above goes RED: the promise resolves as soon as ANY "changed"
   * event fires (the TI-only one), because nothing checks whether the
   * *specific* cookie being watched for actually landed. This confirms the
   * test would catch a watcher that reacts to "something changed" instead of
   * "the thing I'm watching for is now present".
   */
});

describe("looksLikeLoginPage classifies URLs by a loose pathname substring match (Phase 17 Finding #2)", () => {
  it("is true for login, signin, sso, and auth pathnames, case-insensitively", () => {
    expect(looksLikeLoginPage("https://www.toastmasters.org/login")).toBe(true);
    expect(looksLikeLoginPage("https://www.toastmasters.org/LOGIN")).toBe(true);
    expect(looksLikeLoginPage("https://app.basecamp.toastmasters.org/signin")).toBe(true);
    expect(looksLikeLoginPage("https://id.toastmasters.org/sso/authorize")).toBe(true);
    expect(looksLikeLoginPage("https://www.toastmasters.org/auth/callback")).toBe(true);
  });

  it("is true for a login-shaped URL carrying an error query string (failed-login redisplay)", () => {
    expect(
      looksLikeLoginPage("https://www.toastmasters.org/login?error=invalid_credentials"),
    ).toBe(true);
  });

  it("is false for a genuine post-login destination", () => {
    expect(looksLikeLoginPage("https://www.toastmasters.org/dashboard")).toBe(false);
    expect(looksLikeLoginPage("https://app.basecamp.toastmasters.org/dashboard")).toBe(false);
  });

  it("is false (not throwing) for an unparsable URL", () => {
    expect(looksLikeLoginPage("not-a-url")).toBe(false);
  });
});

describe("the Basecamp login window opens the SPA host that mints the authenticated session, not the bare API host (Phase 27)", () => {
  // Phase 27's first attempt repointed BASECAMP_LOGIN_URL at the bare API host
  // `basecamp.toastmasters.org/`, reasoning it should match the harvest host. That
  // regressed refresh to HTTP 401/403: the bare host only 302-redirects an
  // unauthenticated visit and leaves an ANONYMOUS sessionid, which the nav-capture
  // gate still captures. The authenticated sessionid is minted by the Base Camp app
  // SPA (`app.basecamp.toastmasters.org`) completing its TI-SSO handshake. So the
  // login host and the harvest/API host are DELIBERATELY DIFFERENT — this guards
  // against collapsing them again.
  it("opens the app.basecamp SPA host (which drives the authenticated SSO handshake)", () => {
    expect(new URL(BASECAMP_LOGIN_URL).host).toBe("app.basecamp.toastmasters.org");
  });

  it("does NOT open the bare API host we harvest from (that only yields an anonymous session)", () => {
    expect(new URL(BASECAMP_LOGIN_URL).host).not.toBe(new URL(BASECAMP_COOKIE_URL).host);
  });
});

describe("watchForNavigationCapture gates capture on leaving a login-shaped URL, not on cookie presence (Phase 17 Finding #2 fix)", () => {
  it("(a) does NOT resolve on a plain load of the login URL alone, even once a cookie appears — the regression test for the false-positive bug", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();

    const { promise } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    // The login page finishes its initial load — still login-shaped — and, as
    // in the real bug, an anonymous session/CSRF cookie shows up anyway.
    byUrl[TI_URL] = [{ name: "csrftoken", value: "anon-cookie" }];
    wc.fireDidNavigate("https://www.toastmasters.org/login");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // This is exactly the scenario the OLD cookie-presence-only watchForCapture
    // would have wrongly resolved on (the cookie is present) — proving the fix:
    // navigation never left the login page, so capture must not fire.
    expect(resolved).toBe(false);
  });

  it("(b) resolves once navigation lands on a non-login-shaped URL and the target cookie is present", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();

    const { promise } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    // Login page loads first (login-shaped) — no capture yet, same as case (a).
    wc.fireDidNavigate("https://www.toastmasters.org/login");
    await Promise.resolve();
    await Promise.resolve();

    // The user submits real credentials; the site accepts them and redirects
    // to a non-login-shaped destination, and the real session cookie lands.
    byUrl[TI_URL] = [{ name: "auth_token", value: "real-session" }];
    wc.fireDidNavigate("https://www.toastmasters.org/dashboard");

    await expect(promise).resolves.toBeUndefined();
  });

  it("(c) captures immediately on an 'already logged in' instant redirect away from the login URL — preserves the fast path", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [{ name: "auth_token", value: "already-logged-in" }],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();

    const { promise } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    // The very first navigation this window ever fires already lands
    // somewhere non-login-shaped (a prior valid session), so capture must not
    // wait for a second navigation.
    wc.fireDidNavigate("https://www.toastmasters.org/dashboard");

    await expect(promise).resolves.toBeUndefined();
  });

  it("(d) does not falsely capture a failed-login redisplay of the same login-shaped URL (e.g. an error query string)", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [{ name: "csrftoken", value: "anon-cookie" }],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();

    const { promise } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    wc.fireDidNavigate("https://www.toastmasters.org/login");
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // A failed login attempt redisplays the login page with an error query
    // string — still login-shaped by the substring match, so this must not
    // falsely capture even though the (anonymous) cookie is already present
    // and would satisfy `isCaptured` on its own.
    wc.fireDidNavigate("https://www.toastmasters.org/login?error=invalid_credentials");
    await Promise.resolve();
    await Promise.resolve();

    expect(resolved).toBe(false);
  });

  it("cancel() unsubscribes both navigation listeners — a post-cancel navigation never resolves the promise", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();

    const { promise, cancel } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    const thenSpy = vi.fn();
    void promise.then(thenSpy);

    cancel();

    byUrl[TI_URL] = [{ name: "auth_token", value: "real-session" }];
    wc.fireDidNavigate("https://www.toastmasters.org/dashboard");
    wc.fireDidNavigateInPage("https://www.toastmasters.org/dashboard");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(thenSpy).not.toHaveBeenCalled();
  });

  it("(adversarial) did-navigate and did-navigate-in-page firing back-to-back for the SAME successful navigation, before either's cookie harvest has settled, still resolves exactly once and unsubscribes exactly once", async () => {
    // Plausible in the real app: a full navigation that also triggers an
    // in-page URL update (or a client-side redirect that fires both events).
    // Both `onNavigate` calls happen synchronously, so BOTH pass the
    // `if (settled || looksLikeLoginPage(url)) return;` guard — `settled` is
    // still false for both, since it is only ever set inside the async
    // `harvestCookies(...).then(...)` callback, not by the guard itself. The
    // correctness of "exactly once" therefore rests entirely on the SECOND
    // `if (settled || !isCaptured(h)) return;` recheck inside that `.then`,
    // which must observe `settled === true` by the time it runs (because the
    // first callback's synchronous `settled = true` already ran first).
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [{ name: "auth_token", value: "real-session" }],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();
    const offSpy = vi.spyOn(wc, "off");

    const { promise } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    const thenSpy = vi.fn();
    void promise.then(thenSpy);

    // Fire both events synchronously, in the same tick — neither event's
    // internal `harvestCookies(...)` promise has had a chance to settle yet.
    wc.fireDidNavigate("https://www.toastmasters.org/dashboard");
    wc.fireDidNavigateInPage("https://www.toastmasters.org/dashboard");

    // Flush enough microtasks for both concurrent harvestCookies() calls
    // (each itself awaiting cookieSource.get(), an async fn) to settle and
    // both `.then` callbacks to run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(thenSpy).toHaveBeenCalledTimes(1);
    // unsubscribe() removes BOTH listener types (did-navigate AND
    // did-navigate-in-page) — so exactly ONE call to unsubscribe() means
    // exactly 2 off() calls. If the inner `settled` recheck were missing (or
    // misplaced before the `await`), the second event's harvest would ALSO
    // pass its own guard and call unsubscribe() a second time, producing 4
    // off() calls instead of 2 — see the negative control below.
    expect(offSpy).toHaveBeenCalledTimes(2);

    /*
     * NEGATIVE CONTROL (verified by hand against a temporarily-broken
     * src/main/auth.ts, then reverted — do not leave any such edit in
     * place): with the `.then` callback inside `onNavigate` changed from
     *
     *   .then((h) => {
     *     if (settled || !isCaptured(h)) return;
     *     settled = true;
     *     unsubscribe();
     *     resolveFn();
     *   });
     *
     * to drop the re-check of `settled` (i.e. only the OUTER guard remains):
     *
     *   .then((h) => {
     *     if (!isCaptured(h)) return;
     *     settled = true;
     *     unsubscribe();
     *     resolveFn();
     *   });
     *
     * this test goes RED on `expect(offSpy).toHaveBeenCalledTimes(2)`: BOTH
     * events' harvests pass their `.then` guard (isCaptured is true for
     * both, and neither observes the other's `settled = true` because the
     * inner check was removed), so unsubscribe() runs twice — 4 off() calls.
     * This confirms the test would catch a race where the `settled` flag is
     * checked only before the async gap, not after it.
     */
  });
});

describe("watchForNavigationCapture: a non-login navigation that does NOT yet satisfy isCaptured must keep waiting, not settle early (adversarial)", () => {
  it("does not resolve (or unsubscribe) when navigation leaves the login-shaped URL but the target cookie has not landed yet, and correctly captures on a LATER navigation once it does", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();
    const offSpy = vi.spyOn(wc, "off");

    const { promise } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    // Navigation leaves the login-shaped URL for some intermediate,
    // non-login-shaped page (e.g. an interstitial "please wait" redirect
    // hop) — but the target cookie has not landed yet.
    wc.fireDidNavigate("https://www.toastmasters.org/interstitial");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Must still be waiting, not stuck-unsubscribed: this is the deadlock
    // risk the task calls out — if `unsubscribe()`/`settled` were set as
    // soon as navigation left a login-shaped URL (regardless of
    // isCaptured), the watch would be permanently dead here, and the
    // later navigation below would never be able to resolve it.
    expect(resolved).toBe(false);
    expect(offSpy).not.toHaveBeenCalled();

    // A LATER navigation — still non-login-shaped — finally carries the
    // real cookie.
    byUrl[TI_URL] = [{ name: "auth_token", value: "real-session" }];
    wc.fireDidNavigate("https://www.toastmasters.org/dashboard");

    await expect(promise).resolves.toBeUndefined();
    // unsubscribe() removes BOTH listener types in one call, so exactly one
    // (successful) unsubscribe means exactly 2 off() calls.
    expect(offSpy).toHaveBeenCalledTimes(2);
  });

  /*
   * NEGATIVE CONTROL (verified by hand against a temporarily-broken
   * src/main/auth.ts, then reverted — do not leave any such edit in place):
   * with `onNavigate` changed from
   *
   *   function onNavigate(_event, url) {
   *     if (settled || looksLikeLoginPage(url)) return;
   *     void harvestCookies(cookieSource).then((h) => {
   *       if (settled || !isCaptured(h)) return;
   *       settled = true;
   *       unsubscribe();
   *       resolveFn();
   *     });
   *   }
   *
   * to settle/unsubscribe as soon as navigation leaves a login-shaped URL,
   * regardless of isCaptured:
   *
   *   function onNavigate(_event, url) {
   *     if (settled || looksLikeLoginPage(url)) return;
   *     settled = true;
   *     unsubscribe();
   *     void harvestCookies(cookieSource).then((h) => {
   *       if (!isCaptured(h)) return;
   *       resolveFn();
   *     });
   *   }
   *
   * this test goes RED at the final `await expect(promise).resolves...`,
   * which times out: the FIRST (uncaptured) navigation already unsubscribed
   * both listeners, so the second `fireDidNavigate` call above reaches no
   * listener at all and the promise never settles. This confirms the test
   * would catch a watcher that gives up permanently instead of continuing
   * to wait for a later, actually-captured navigation.
   */
});

describe("runLoginFlow wires watchForNavigationCapture into openLoginWindow, so leaving the login page (with cookies confirmed) programmatically closes the window", () => {
  beforeEach(() => {
    FakeBrowserWindow.instances.length = 0;
  });

  it("closes the TI login window once navigation leaves the login page and the cookie has landed, and resolves with the correct AuthStatus", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const cookies = cookieSource(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);

    // Let the TI BrowserWindow get constructed.
    await new Promise((r) => setTimeout(r, 0));

    expect(FakeBrowserWindow.instances).toHaveLength(1);
    const tiWindow = FakeBrowserWindow.instances[0];
    expect(tiWindow.isDestroyed()).toBe(false);

    // The login page's own initial load is login-shaped and must NOT close
    // the window on its own — the Finding #2 regression scenario, inline in
    // the wiring test too.
    tiWindow.webContents.fireDidNavigate("https://www.toastmasters.org/login");
    await new Promise((r) => setTimeout(r, 0));
    expect(tiWindow.isDestroyed()).toBe(false);

    // The TI login also grants Basecamp SSO in this run (both cookies land at
    // once), so runLoginFlow never needs to open the second window. The site
    // then redirects away from the login-shaped URL.
    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "SID-1" }];
    byUrl[TI_URL] = [{ name: "auth", value: "abc" }];
    tiWindow.webContents.fireDidNavigate("https://www.toastmasters.org/dashboard");

    // Flush the chain: onNavigate -> harvestCookies -> isCaptured -> resolveFn
    // -> capture.promise.then -> win.close().
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The literal user-visible behaviour: the window actually closed itself.
    expect(tiWindow.isDestroyed()).toBe(true);
    // And only the one (TI) window was ever opened, since SSO covered Basecamp.
    expect(FakeBrowserWindow.instances).toHaveLength(1);

    const applied = await flow;
    expect(applied).toEqual({ basecamp: true, ti: true });
  });

  it("opens a second (Basecamp) window when TI login alone didn't capture the Basecamp sessionid, and closes that one too once captured", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const cookies = cookieSource(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeBrowserWindow.instances).toHaveLength(1);

    // TI login captures only the TI cookie — no SSO into Basecamp this time.
    byUrl[TI_URL] = [{ name: "auth", value: "abc" }];
    FakeBrowserWindow.instances[0].webContents.fireDidNavigate(
      "https://www.toastmasters.org/dashboard",
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(FakeBrowserWindow.instances[0].isDestroyed()).toBe(true);

    // runLoginFlow should now have opened the second (Basecamp) window.
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    const bcWindow = FakeBrowserWindow.instances[1];
    expect(bcWindow.isDestroyed()).toBe(false);

    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "SID-2" }];
    bcWindow.webContents.fireDidNavigate("https://app.basecamp.toastmasters.org/dashboard");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(bcWindow.isDestroyed()).toBe(true);

    const applied = await flow;
    expect(applied).toEqual({ basecamp: true, ti: true });
  });

  it("finding: a manual close of the TI window (before any navigation-gated capture) does not hang runLoginFlow — it falls through to the Basecamp window and resolves with a partial/empty AuthStatus", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const cookies = cookieSource(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeBrowserWindow.instances).toHaveLength(1);

    // The user closes the TI window manually (simulating the OS firing
    // "closed" directly) — bypassing the programmatic close() path entirely.
    // No navigation away from the login page ever happened.
    FakeBrowserWindow.instances[0].closedCallback?.();
    await new Promise((r) => setTimeout(r, 0));

    // runLoginFlow must fall through to the Basecamp window rather than hang:
    // openLoginWindow's "closed" handler resolves (and cancels the capture
    // watcher) unconditionally, regardless of which path resolved it.
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    expect(FakeBrowserWindow.instances[1].isDestroyed()).toBe(false);

    // The user also closes the Basecamp window manually without logging in.
    FakeBrowserWindow.instances[1].closedCallback?.();

    const applied = await flow;
    expect(applied).toEqual({ basecamp: false, ti: false });
  });

  it("(adversarial) cancel() being invoked via BOTH the capture-resolved path and the window's 'closed' handler is safe — it is idempotent, not double-effectful", async () => {
    // openLoginWindow calls capture.cancel() from two places: once inside
    // `capture.promise.then(...)` right before `win.close()`, and again
    // unconditionally inside `win.once("closed", ...)` once that close
    // actually fires. Both calls happen for every successful capture — this
    // proves the second one is a genuine no-op, not just "didn't happen to
    // throw in this fake".
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const cookies = cookieSource(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);
    await new Promise((r) => setTimeout(r, 0));

    const tiWindow = FakeBrowserWindow.instances[0];
    const offSpy = vi.spyOn(tiWindow.webContents, "off");

    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "SID-1" }];
    byUrl[TI_URL] = [{ name: "auth", value: "abc" }];
    tiWindow.webContents.fireDidNavigate("https://www.toastmasters.org/dashboard");

    // Flush the full chain: onNavigate -> harvestCookies -> resolveFn ->
    // capture.promise.then -> capture.cancel() (1st call, real unsubscribe)
    // -> win.close() -> "closed" handler -> capture?.cancel() (2nd call,
    // must be a no-op).
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(tiWindow.isDestroyed()).toBe(true);
    // unsubscribe() removes both listener types — exactly one EFFECTIVE
    // cancel() means exactly 2 off() calls, not 4.
    expect(offSpy).toHaveBeenCalledTimes(2);

    const applied = await flow;
    expect(applied).toEqual({ basecamp: true, ti: true });
  });

  it("(adversarial) a stray navigation event fired on a window's webContents AFTER it was manually closed (capture never resolved) is a harmless no-op — cancel() from the 'closed' handler already unsubscribed", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const cookies = cookieSource(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);
    await new Promise((r) => setTimeout(r, 0));
    const tiWindow = FakeBrowserWindow.instances[0];

    // The user closes the TI window manually — no navigation-gated capture
    // has fired yet, so this exercises openLoginWindow's "closed" handler
    // calling capture.cancel() directly (not via the capture.promise.then
    // path).
    tiWindow.closedCallback?.();
    await new Promise((r) => setTimeout(r, 0));

    // Snapshot how many times the underlying cookie store has been queried
    // so far (runLoginFlow's own "after TI login" harvestCookies call, plus
    // whatever the watcher itself already did, both already happened by
    // this point). If the stray navigation below reaches `onNavigate` at
    // all, it would trigger a fresh `harvestCookies(...)` call — i.e. two
    // more `cookies.get` calls (Basecamp + TI) — even though it can no
    // longer resolve anything (isCaptured wasn't satisfied and `settled` is
    // already true). Using the call count rather than the final `applied`
    // result avoids the confound of also asserting on `harvestCookies`
    // calls made independently, later, as part of runLoginFlow's own
    // (post-window-close) re-harvest — which reads the LIVE cookie store
    // regardless of whether any navigation event ever fired.
    const getCallsBeforeStray = vi.mocked(cookies.get).mock.calls.length;

    // A stray navigation event still lands on the now-destroyed window's
    // webContents afterwards (e.g. a slow in-flight navigation the OS
    // teardown didn't fully suppress). Must not throw, and — because
    // cancel() already unsubscribed both listeners — must trigger no cookie
    // query at all (the listener is simply gone).
    expect(() =>
      tiWindow.webContents.fireDidNavigate("https://www.toastmasters.org/dashboard"),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(cookies.get).mock.calls.length).toBe(getCallsBeforeStray);

    // runLoginFlow still fell through to the Basecamp window as normal.
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    FakeBrowserWindow.instances[1].closedCallback?.();

    const applied = await flow;
    expect(applied).toEqual({ basecamp: false, ti: false });
  });

  it("(adversarial) the Basecamp window's capture is wired to its OWN webContents — a stray navigation on the already-closed TI window afterwards does not affect it, and only the Basecamp window's own navigation captures it", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const cookies = cookieSource(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);
    await new Promise((r) => setTimeout(r, 0));

    // TI login captures only the TI cookie — no SSO into Basecamp.
    byUrl[TI_URL] = [{ name: "auth", value: "abc" }];
    const tiWindow = FakeBrowserWindow.instances[0];
    tiWindow.webContents.fireDidNavigate("https://www.toastmasters.org/dashboard");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(tiWindow.isDestroyed()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    const bcWindow = FakeBrowserWindow.instances[1];
    expect(bcWindow.isDestroyed()).toBe(false);

    // Fire an unrelated, "capturing-looking" navigation on the ALREADY
    // CLOSED TI window's webContents — a completely separate object from
    // bcWindow.webContents, and its listeners were already removed on
    // close. This must have zero effect on the still-open Basecamp watcher.
    tiWindow.webContents.fireDidNavigate("https://www.toastmasters.org/some-other-page");
    await new Promise((r) => setTimeout(r, 0));
    expect(bcWindow.isDestroyed()).toBe(false);

    // Only the Basecamp window's OWN navigation captures it.
    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "SID-2" }];
    bcWindow.webContents.fireDidNavigate("https://app.basecamp.toastmasters.org/dashboard");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(bcWindow.isDestroyed()).toBe(true);

    const applied = await flow;
    expect(applied).toEqual({ basecamp: true, ti: true });
  });
});

describe("looksLikeLoginPage: known heuristic limitation — the loose substring match can also false-POSITIVE on a genuine, unrelated destination (Phase 17 Finding #2 caveat)", () => {
  // The JSDoc on looksLikeLoginPage already flags it as "Deliberately
  // loose... a heuristic, not an exact match" — these tests characterize
  // exactly HOW loose: a genuine post-login destination whose path merely
  // CONTAINS "login"/"signin"/"sso"/"auth" as a substring (not a distinct
  // path segment) is misclassified as login-shaped. This is not something
  // these tests fix (that's a source-code tradeoff for the developer to
  // weigh, e.g. anchoring the match to a path segment boundary instead of a
  // bare substring) — they exist to make the risk concrete and regression-
  // visible rather than left as an abstract caveat in a comment.
  it("misclassifies a genuine '/author/...' destination as login-shaped, because 'author' contains 'auth' as a substring", () => {
    expect(looksLikeLoginPage("https://www.toastmasters.org/author/profile")).toBe(true);
  });

  it("misclassifies a genuine '/oauth-settings' destination as login-shaped, for the same reason", () => {
    expect(looksLikeLoginPage("https://www.toastmasters.org/oauth-settings")).toBe(true);
  });

  it("consequently: a watcher waiting on such a destination never captures — from its perspective navigation never 'leaves' a login-shaped URL, even once the real session cookie is already present", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [TI_URL]: [{ name: "auth_token", value: "real-session" }],
    };
    const src = cookieSource(byUrl);
    const wc = fakeWebContents();

    const { promise } = watchForNavigationCapture(wc, src, (h) => Boolean(h.tiCookie));

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    // The user's genuine post-login destination happens to be an author
    // page — by this heuristic it looks exactly like a login-shaped URL, so
    // the gate never opens even though the real session cookie already
    // landed.
    wc.fireDidNavigate("https://www.toastmasters.org/author/profile");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolved).toBe(false);
  });
});
