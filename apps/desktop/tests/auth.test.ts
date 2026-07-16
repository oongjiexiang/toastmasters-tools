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
 */

/**
 * The `BrowserWindow` fake used by the `runLoginFlow`/`openLoginWindow` wiring
 * tests below. It is deliberately a *behavioural* fake, not a stub: `close()`
 * synchronously invokes whatever `once("closed", cb)` registered — mirroring
 * how Electron itself fires "closed" once the native window is torn down —
 * and `isDestroyed()` reflects that. Every constructed instance is pushed onto
 * a static `instances` array so a test can inspect (and manually "close",
 * simulating the OS) whichever login window `runLoginFlow` opened, the same
 * pattern `tests/main-ipc.test.ts` uses for its `windowOptions` capture.
 *
 * Declared inside `vi.hoisted` because `vi.mock` factories are hoisted above
 * every other statement in the file (including plain `class` declarations),
 * so a class referenced by the factory must be hoisted along with it or the
 * factory would see it as not-yet-initialized.
 */
const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    closedCallback: (() => void) | null = null;
    destroyed = false;

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
  return { FakeBrowserWindow };
});

vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  session: { fromPartition: vi.fn() },
}));

import * as electron from "electron";
import {
  applyCookies,
  currentAuthStatus,
  harvestCookies,
  runLoginFlow,
  watchForCapture,
  type CookieSource,
  type CookieWatcher,
  type HarvestedCookies,
} from "../src/main/auth";

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
    // The untouched TI credential survives in both env and file.
    expect(process.env.TI_COOKIE).toBe("good-ti");
    expect(readFileSync(credsFile, "utf-8")).toContain("TI_COOKIE=good-ti");
    expect(readFileSync(credsFile, "utf-8")).toContain("BASECAMP_SESSIONID=new-sid");
  });

  it("applies only the TI cookie on a TI-only harvest", () => {
    process.env.BASECAMP_SESSIONID = "good-sid";
    writeFileSync(credsFile, "BASECAMP_SESSIONID=good-sid\nTI_COOKIE=\n", "utf-8");

    const applied = applyCookies(credsFile, { tiCookie: "a=1; b=2" });

    expect(applied).toEqual({ basecamp: false, ti: true });
    expect(process.env.TI_COOKIE).toBe("a=1; b=2");
    expect(process.env.BASECAMP_SESSIONID).toBe("good-sid");
    expect(readFileSync(credsFile, "utf-8")).toContain("BASECAMP_SESSIONID=good-sid");
    expect(readFileSync(credsFile, "utf-8")).toContain("TI_COOKIE=a=1; b=2");
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
    expect(written).toContain("BASECAMP_SESSIONID=sid-full");
    expect(written).toContain("TI_COOKIE=x=1; y=2");
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

describe("runLoginFlow wires watchForCapture into openLoginWindow, so a captured cookie programmatically closes the window", () => {
  beforeEach(() => {
    FakeBrowserWindow.instances.length = 0;
  });

  it("closes the TI login window as soon as the 'changed' event reveals the target cookie, and resolves with the correct AuthStatus", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const watcher = cookieWatcher(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies: watcher,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);

    // Let the TI BrowserWindow get constructed and watchForCapture's immediate
    // check() run (it sees no cookies yet).
    await new Promise((r) => setTimeout(r, 0));

    expect(FakeBrowserWindow.instances).toHaveLength(1);
    const tiWindow = FakeBrowserWindow.instances[0];
    expect(tiWindow.isDestroyed()).toBe(false);

    // The TI login also grants Basecamp SSO in this run (both cookies land at
    // once), so runLoginFlow never needs to open the second window.
    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "SID-1" }];
    byUrl[TI_URL] = [{ name: "auth", value: "abc" }];
    watcher.fireChanged();

    // Flush the chain: harvestCookies -> isCaptured -> resolveFn ->
    // captureSignal.then -> win.close().
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
    const watcher = cookieWatcher(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies: watcher,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeBrowserWindow.instances).toHaveLength(1);

    // TI login captures only the TI cookie — no SSO into Basecamp this time.
    byUrl[TI_URL] = [{ name: "auth", value: "abc" }];
    watcher.fireChanged();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(FakeBrowserWindow.instances[0].isDestroyed()).toBe(true);

    // runLoginFlow should now have opened the second (Basecamp) window.
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    const bcWindow = FakeBrowserWindow.instances[1];
    expect(bcWindow.isDestroyed()).toBe(false);

    byUrl[BASECAMP_URL] = [{ name: "sessionid", value: "SID-2" }];
    watcher.fireChanged();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(bcWindow.isDestroyed()).toBe(true);

    const applied = await flow;
    expect(applied).toEqual({ basecamp: true, ti: true });
  });

  it("finding: a manual close of the TI window (before any cookie is captured) does not hang runLoginFlow — it falls through to the Basecamp window and resolves with a partial/empty AuthStatus", async () => {
    const byUrl: Record<string, Array<{ name: string; value: string }>> = {
      [BASECAMP_URL]: [],
      [TI_URL]: [],
    };
    const watcher = cookieWatcher(byUrl);
    vi.mocked(electron.session.fromPartition).mockReturnValue({
      cookies: watcher,
    } as unknown as ReturnType<typeof electron.session.fromPartition>);

    const flow = runLoginFlow(credsFile);
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeBrowserWindow.instances).toHaveLength(1);

    // The user closes the TI window manually (simulating the OS firing
    // "closed" directly) — bypassing the programmatic close() path entirely.
    // No cookie was ever captured.
    FakeBrowserWindow.instances[0].closedCallback?.();
    await new Promise((r) => setTimeout(r, 0));

    // runLoginFlow must fall through to the Basecamp window rather than hang:
    // tiWatch.cancel() runs unconditionally right after openLoginWindow
    // resolves, regardless of which path resolved it.
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    expect(FakeBrowserWindow.instances[1].isDestroyed()).toBe(false);

    // The user also closes the Basecamp window manually without logging in.
    FakeBrowserWindow.instances[1].closedCallback?.();

    const applied = await flow;
    expect(applied).toEqual({ basecamp: false, ti: false });
  });
});
