import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberProgress } from "../types";

/**
 * Phase 18 — `fetchAllProgress` learned to fetch pages 2..N concurrently
 * (chunks of `PROGRESS_CONCURRENCY = 5` via `Promise.allSettled`) whenever it
 * can safely predict every page URL up front: `page1.next` must parse as a
 * URL with `page=2`, `pageSize` (`page1.results.length`) must be > 0, and
 * `count` must be a finite positive number. If any of those checks fails, it
 * falls back to the original sequential `next`-walk.
 *
 * These tests attack the NEW parallel path and its fallback guards. They
 * mirror the `vi.stubGlobal("fetch", ...)` + `vi.resetModules()` + dynamic
 * `await import("../helpers/api")` pattern already used in
 * `config-dynamic.test.ts`'s "fetchAllProgress streams progress through the
 * injected reporter" block, but live in their own file per instructions.
 */

const KEYS = ["BASECAMP_SESSIONID"] as const;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function member(tag: string): MemberProgress {
  return {
    user: {
      id: 1,
      first_name: "First",
      last_name: "Last",
      name: "First Last",
      email: `${tag}@example.com`,
      username: tag,
    },
    path_name: "Innovative Planning",
    course_id: "course-1",
    progression: {},
  };
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  };
}

function errorResponse(status = 500, statusText = "Internal Server Error") {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  };
}

/** Clone `url`, setting (or overwriting) its `page` search param. */
function withPage(url: string, page: number | string): string {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  return u.toString();
}

describe("fetchAllProgress — parallel path assembles pages in order (Case 1)", () => {
  it("keeps results in page order even when a later page resolves before an earlier one", async () => {
    // count=6, pageSize=2 -> totalPages=3 -> pages 2 and 3 fetched in the same
    // Promise.allSettled batch. Page 2 is deliberately SLOWER than page 3, so a
    // naive "push results as they arrive" implementation would misorder them.
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "2") {
        await delay(40);
        return okResponse({ count: 6, next: null, results: [member("p2-a"), member("p2-b")] });
      }
      if (page === "3") {
        await delay(5);
        return okResponse({ count: 6, next: null, results: [member("p3-a"), member("p3-b")] });
      }
      return okResponse({
        count: 6,
        next: withPage(url, 2),
        results: [member("p1-a"), member("p1-b")],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const lines: string[] = [];
    const members = await api.fetchAllProgress((line) => lines.push(line));

    expect(members.map((m) => m.user.username)).toEqual([
      "p1-a",
      "p1-b",
      "p2-a",
      "p2-b",
      "p3-a",
      "p3-b",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lines).toEqual([
      "  Found 6 members; downloading…",
      "  Page 1: 2 of 6 downloaded.",
      "  Page 2: 4 of 6 downloaded.",
      "  Page 3: 6 of 6 downloaded.",
    ]);
  });
});

describe("fetchAllProgress — pages 2..N are fetched concurrently (Case 2, negative control)", () => {
  it("has more than one page request in flight at once", async () => {
    // count=10, pageSize=2 -> totalPages=5 -> 4 remaining pages (2..5), all
    // within one PROGRESS_CONCURRENCY=5 batch. Each remaining page sleeps 30ms
    // before responding; we track how many are in flight simultaneously.
    //
    // Why this fails against a reverted, sequential `while (url) await
    // fetchPage(url)` implementation: each `fetchPage` call would be fully
    // awaited (including its 30ms delay) before the next one is issued, so
    // `concurrent` would never exceed 1 and `maxConcurrent` would stay at 1,
    // failing the `toBeGreaterThan(1)` assertion below.
    let concurrent = 0;
    let maxConcurrent = 0;

    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "1") {
        return okResponse({
          count: 10,
          next: withPage(url, 2),
          results: [member("p1-a"), member("p1-b")],
        });
      }
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(30);
      concurrent--;
      return okResponse({
        count: 10,
        next: null,
        results: [member(`p${page}-a`), member(`p${page}-b`)],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const members = await api.fetchAllProgress(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(5); // page 1 + pages 2..5
    expect(members).toHaveLength(10);
    expect(maxConcurrent).toBeGreaterThan(1);
  });
});

describe("fetchAllProgress — a single failed page is skipped, not fatal (Case 3)", () => {
  it("omits the failed page's members but keeps the rest, in order, with a warning", async () => {
    // count=8, pageSize=2 -> totalPages=4 -> remaining pages 2,3,4. Page 3
    // returns a non-ok HTTP response, which fetchPage turns into a thrown
    // Error, which Promise.allSettled turns into a rejected settlement.
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "1") {
        return okResponse({
          count: 8,
          next: withPage(url, 2),
          results: [member("p1-a"), member("p1-b")],
        });
      }
      if (page === "3") {
        return errorResponse(500, "Internal Server Error");
      }
      return okResponse({
        count: 8,
        next: null,
        results: [member(`p${page}-a`), member(`p${page}-b`)],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const lines: string[] = [];
    const members = await api.fetchAllProgress((line) => lines.push(line));

    expect(members.map((m) => m.user.username)).toEqual([
      "p1-a",
      "p1-b",
      "p2-a",
      "p2-b",
      "p4-a",
      "p4-b",
    ]);
    expect(lines).toContainEqual(
      expect.stringContaining("Warning: could not fetch page 3:")
    );
    // Cumulative count does not advance for the failed page, but a progress
    // line is still emitted for it, in page-index order. All three remaining
    // pages (2, 3, 4) land in a single Promise.allSettled batch, so the
    // warning for the rejected page is emitted while that batch is being
    // settled — before the separate per-page report loop that runs afterward.
    expect(lines).toEqual([
      "  Found 8 members; downloading…",
      "  Page 1: 2 of 8 downloaded.",
      expect.stringContaining("Warning: could not fetch page 3:"),
      "  Page 2: 4 of 8 downloaded.",
      "  Page 3: 4 of 8 downloaded.",
      "  Page 4: 6 of 8 downloaded.",
    ]);
  });
});

describe("fetchAllProgress — single-page result still fast-paths (Case 4, regression guard)", () => {
  it("does not build any page=2 URL when page1.next is null", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ count: 0, next: null, results: [] })
    );
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const members = await api.fetchAllProgress(() => {});

    expect(members).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAllProgress — fallback path when count is missing/invalid (Case 5)", () => {
  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -3],
    ["NaN", Number.NaN],
  ])("falls back to sequential fetching when count is %s", async (_label, countValue) => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "2") {
        return okResponse({
          count: countValue,
          next: null,
          results: [member("p2-a"), member("p2-b")],
        });
      }
      const body: Record<string, unknown> = {
        next: withPage(url, 2),
        results: [member("p1-a"), member("p1-b")],
      };
      if (countValue !== undefined) {
        body.count = countValue;
      }
      return okResponse(body);
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const members = await api.fetchAllProgress(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(members.map((m) => m.user.username)).toEqual([
      "p1-a",
      "p1-b",
      "p2-a",
      "p2-b",
    ]);
  });
});

describe("fetchAllProgress — fallback path when `next` doesn't match page=N (Case 6, negative control)", () => {
  it("fetches the exact cursor-style next URL rather than fabricating a page= URL", async () => {
    let expectedNextUrl = "";

    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get("cursor") === "abc123") {
        return okResponse({ count: 4, next: null, results: [member("p2-a"), member("p2-b")] });
      }
      const nextUrl = new URL(url);
      nextUrl.searchParams.delete("page");
      nextUrl.searchParams.set("cursor", "abc123");
      expectedNextUrl = nextUrl.toString();
      return okResponse({
        count: 4,
        next: expectedNextUrl,
        results: [member("p1-a"), member("p1-b")],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const members = await api.fetchAllProgress(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Why this is a real negative control: a fabricating implementation would
    // ignore the cursor and request `?...&page=2` (or `page=3`) instead of the
    // literal `next` URL the server returned — this exact-string comparison
    // (and the absence of any `page=` param) would fail against that code.
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toBe(expectedNextUrl);
    expect(secondCallUrl).not.toMatch(/page=/);
    expect(members.map((m) => m.user.username)).toEqual([
      "p1-a",
      "p1-b",
      "p2-a",
      "p2-b",
    ]);
  });
});

describe("NEGATIVE CONTROL: the mock is actually engaged (Case 7)", () => {
  it("asserts an exact call count that only a properly-stubbed fetch could satisfy", async () => {
    // If vi.stubGlobal hadn't taken effect (e.g. wrong import order, or the
    // module under test capturing a real `fetch` reference before the stub
    // was applied), this would either hit the real network — erroring or
    // hanging in this sandboxed test environment — or the call count captured
    // by this mock would be 0, failing the exact-count assertion below rather
    // than silently passing.
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("page=1");
      return okResponse({ count: 2, next: null, results: [member("only-a"), member("only-b")] });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const members = await api.fetchAllProgress(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(members.map((m) => m.user.username)).toEqual(["only-a", "only-b"]);
  });
});
