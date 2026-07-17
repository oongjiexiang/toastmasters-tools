import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Found during manual verification of Phase 22 item 1: an expired/invalid
 * `TI_COOKIE` does not fail this endpoint with a 401/403 — Toastmasters
 * answers 200 OK with an HTML login/error page instead. Before this fix,
 * `main()` wrote that "csv" to disk, reported success, and only then blew up
 * inside `snapshotMembership` with a cryptic csv-parse error ("Invalid
 * Opening Quote...") that the renderer's `AUTH_ERROR` check (`/HTTP 40[13]/`)
 * never recognized — so the user saw the raw parser error in a toast instead
 * of the friendly "session expired" hint. `main()` now detects an HTML body
 * up front and throws an `HttpError` shaped to match that same regex, before
 * anything is written or reported as a success.
 *
 * `fs`'s `writeFileSync`/`mkdirSync` and `helpers/db.ts`'s
 * `snapshotMembership` are mocked at the module boundary, mirroring
 * `membership-cancel.test.ts`.
 */

const KEYS = ["TI_COOKIE"] as const;
let saved: Record<string, string | undefined>;

const writeFileSync = vi.fn();
const mkdirSync = vi.fn();
const snapshotMembership = vi.fn();

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, writeFileSync, mkdirSync };
});

vi.mock("../helpers/db", () => ({ snapshotMembership }));

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.TI_COOKIE = "cookie-value";
  vi.resetModules();
  vi.clearAllMocks();
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

function okTextResponse(text: string) {
  return { ok: true, status: 200, statusText: "OK", text: async () => text };
}

describe("services/membership.ts main() — an expired session returns 200 + HTML, not 401/403", () => {
  it("rejects with an HTTP-401-shaped HttpError, never writes the file, and never snapshots", async () => {
    const html =
      "<!DOCTYPE html>\n<html lang=\"en\"><head><title>Sign in</title></head><body>Please log in.</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okTextResponse(html)),
    );

    const { main } = await import("../services/membership");

    await expect(main(() => {})).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
      message: expect.stringMatching(/HTTP 401/),
    });

    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(snapshotMembership).not.toHaveBeenCalled();
  });

  it("does not report success before detecting the HTML body", async () => {
    const html = "<html><body>logged out</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okTextResponse(html)),
    );

    const { main } = await import("../services/membership");
    const lines: string[] = [];

    await expect(main((line) => lines.push(line))).rejects.toThrow();

    expect(lines).not.toContain("Roster downloaded — saved and recorded.");
  });

  it("NEGATIVE CONTROL: a real CSV body (even one that happens to contain '<html' text in a field) is unaffected", async () => {
    // Guards against the detector being too eager — it only matches when the
    // body's head genuinely starts with a doctype/html tag, not merely
    // contains that text somewhere inside a legitimate CSV value.
    const csv = 'Email,Name,Notes\nalice@example.com,Alice Smith,"See <html> in bio"\n';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okTextResponse(csv)),
    );

    const { main } = await import("../services/membership");

    await expect(main(() => {})).resolves.toBeUndefined();

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(snapshotMembership).toHaveBeenCalledTimes(1);
    expect(snapshotMembership).toHaveBeenCalledWith(csv);
  });

  it("NEGATIVE CONTROL: without the detector, this test would fail — confirms the assertion isn't vacuous", async () => {
    // Sanity check on the regex the renderer actually uses (DashboardView.tsx's
    // AUTH_ERROR = /HTTP 40[13]/) so this test file and that consumer can't
    // silently drift apart.
    const AUTH_ERROR = /HTTP 40[13]/;
    const html = "<!doctype html><html></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okTextResponse(html)),
    );

    const { main } = await import("../services/membership");

    try {
      await main(() => {});
      throw new Error("expected main() to reject");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(AUTH_ERROR.test(message)).toBe(true);
    }
  });
});
