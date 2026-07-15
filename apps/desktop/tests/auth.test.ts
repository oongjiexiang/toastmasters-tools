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

vi.mock("electron", () => ({
  BrowserWindow: class {},
  session: { fromPartition: vi.fn() },
}));

import * as electron from "electron";
import {
  applyCookies,
  currentAuthStatus,
  harvestCookies,
  type CookieSource,
  type HarvestedCookies,
} from "../src/main/auth";

/** A cookie source whose `.get({url})` returns a canned list keyed by URL. */
function cookieSource(byUrl: Record<string, Array<{ name: string; value: string }>>): CookieSource {
  return {
    get: vi.fn(async ({ url }: { url: string }) => byUrl[url] ?? []),
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
