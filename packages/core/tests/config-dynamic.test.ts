import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 12, Task 1 — core reads the two auth cookies LIVE from process.env.
 *
 * `config.ts` still exports the frozen `SESSION_ID` / `TI_COOKIE` consts (bound at
 * module-evaluation time) for backward-compat, but the scrapers now go through the
 * `getSessionId()` / `getTiCookie()` accessors, which read `process.env` at CALL
 * time. That is the whole point of the phase: a cookie applied *after* core was
 * imported (by the Electron in-app login) must take effect on the very next
 * request, with no restart.
 *
 * Each case controls the freeze point with `vi.resetModules()` + a dynamic import,
 * so `SESSION_ID` freezes to a value THIS test chose, and mutates env afterwards to
 * prove the accessor — but never the const — observes the change.
 */

const KEYS = ["BASECAMP_SESSIONID", "TI_COOKIE"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("getSessionId / getTiCookie read process.env at call time", () => {
  it("getSessionId reflects a BASECAMP_SESSIONID set AFTER config was imported", async () => {
    process.env.BASECAMP_SESSIONID = "cookie-at-import";
    const config = await import("../config");

    expect(config.getSessionId()).toBe("cookie-at-import");

    process.env.BASECAMP_SESSIONID = "cookie-applied-later";
    expect(config.getSessionId()).toBe("cookie-applied-later");
  });

  it("getTiCookie reflects a TI_COOKIE set AFTER config was imported", async () => {
    process.env.TI_COOKIE = "ti-at-import";
    const config = await import("../config");

    expect(config.getTiCookie()).toBe("ti-at-import");

    process.env.TI_COOKIE = "ti-applied-later";
    expect(config.getTiCookie()).toBe("ti-applied-later");
  });

  // "Unset" is modelled as the empty-string placeholder the credentials template
  // writes, NOT `delete`: config's `./paths` side effect re-runs `loadEnvFile()` on
  // every fresh import, and a *deleted* key would simply be repopulated from the
  // repo-root .env. An empty string stays "in" process.env, so the reload skips it —
  // exactly how the real placeholder behaves.
  it("getSessionId is an empty string when the cookie is unset (core's own guard fires)", async () => {
    process.env.BASECAMP_SESSIONID = "";
    const config = await import("../config");

    expect(config.getSessionId()).toBe("");
  });

  it("getTiCookie is an empty string when the cookie is unset", async () => {
    process.env.TI_COOKIE = "";
    const config = await import("../config");

    expect(config.getTiCookie()).toBe("");
  });
});

describe("NEGATIVE CONTROL: the frozen consts do NOT observe a mid-run change", () => {
  // This is the pin for the whole phase. If the scrapers had kept binding the
  // frozen `SESSION_ID` const (the pre-Phase-12 behaviour), a login performed
  // after core was imported would be invisible until restart. We prove the const
  // and the accessor DIVERGE after a mid-run env mutation — so any code reading
  // the const is demonstrably broken, and only the accessor is correct.
  it("SESSION_ID stays frozen while getSessionId() moves on", async () => {
    process.env.BASECAMP_SESSIONID = "frozen-at-import";
    const config = await import("../config");

    expect(config.SESSION_ID).toBe("frozen-at-import");

    process.env.BASECAMP_SESSIONID = "changed-mid-run";

    // The accessor tracks the live env...
    expect(config.getSessionId()).toBe("changed-mid-run");
    // ...but the const is still what it was frozen to at import.
    expect(config.SESSION_ID).toBe("frozen-at-import");
    // Hence they diverge — the frozen-const path could not have reflected login.
    expect(config.getSessionId()).not.toBe(config.SESSION_ID);
  });

  it("TI_COOKIE stays frozen while getTiCookie() moves on", async () => {
    process.env.TI_COOKIE = "ti-frozen-at-import";
    const config = await import("../config");

    expect(config.TI_COOKIE).toBe("ti-frozen-at-import");

    process.env.TI_COOKIE = "ti-changed-mid-run";

    expect(config.getTiCookie()).toBe("ti-changed-mid-run");
    expect(config.TI_COOKIE).toBe("ti-frozen-at-import");
    expect(config.getTiCookie()).not.toBe(config.TI_COOKIE);
  });
});

describe("buildHeaders in helpers/api.ts reads the session cookie live", () => {
  // buildHeaders is private, so we exercise it through the one public function
  // that makes a single request — fetchDetail — and inspect the Cookie header
  // handed to a mocked global fetch. A live read means the SECOND request, made
  // after an env change with no re-import, carries the NEW cookie.
  function okJsonFetch() {
    return vi.fn(
      async (_url: string, _init: { headers: Record<string, string> }) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      }),
    );
  }

  it("sends the freshly-applied sessionid on the very next request, no restart", async () => {
    const fetchMock = okJsonFetch();
    vi.stubGlobal("fetch", fetchMock);

    process.env.BASECAMP_SESSIONID = "cookie-A";
    const api = await import("../helpers/api");

    await api.fetchDetail("course-1", "user-1");
    const firstHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(firstHeaders.Cookie).toBe("sessionid=cookie-A;");

    process.env.BASECAMP_SESSIONID = "cookie-B";
    await api.fetchDetail("course-1", "user-1");
    const secondHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(secondHeaders.Cookie).toBe("sessionid=cookie-B;");
  });

  it("omits the Cookie header entirely when no sessionid is set", async () => {
    const fetchMock = okJsonFetch();
    vi.stubGlobal("fetch", fetchMock);

    process.env.BASECAMP_SESSIONID = "";
    const api = await import("../helpers/api");

    await api.fetchDetail("course-1", "user-1");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Cookie).toBeUndefined();
  });
});

describe("fetchAllProgress streams progress through the injected reporter", () => {
  // The reporter is how the Electron refresh panel shows the run advancing. A
  // one-page club is enough to pin the emitted lines; the loop runs once and stops
  // when the API's `next` is null.
  function onePageFetch(count: number, rows: number) {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        count,
        next: null,
        results: Array.from({ length: rows }, () => ({})),
      }),
    }));
  }

  it("emits a 'found' line then a per-page progress line", async () => {
    vi.stubGlobal("fetch", onePageFetch(2, 2));
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const lines: string[] = [];
    const members = await api.fetchAllProgress((line) => lines.push(line));

    expect(members).toHaveLength(2);
    expect(lines).toEqual([
      "  Found 2 members; downloading…",
      "  Page 1: 2 of 2 downloaded.",
    ]);
  });

  it("defaults to console.log when no reporter is passed (the CLI path)", async () => {
    vi.stubGlobal("fetch", onePageFetch(0, 0));
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await api.fetchAllProgress();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
