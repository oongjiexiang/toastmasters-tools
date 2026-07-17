import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberProgress } from "../types";

/**
 * Phase 22 — `helpers/api.ts` gained `CancelledError` and an optional
 * `AbortSignal` threaded through `fetchPage` (internal), `fetchAllProgress`,
 * and `fetchDetail`. `fetchAllProgress` checks `signal?.aborted` in three
 * places: right after page 1, between each parallel batch (the
 * `PROGRESS_CONCURRENCY = 5` chunks), and in the sequential fallback's
 * per-page loop.
 *
 * These tests attack that new cancellation surface directly — nothing in the
 * existing suite calls any of these functions with a signal at all. They
 * mirror the `vi.stubGlobal("fetch", ...)` + `vi.resetModules()` + dynamic
 * `await import("../helpers/api")` pattern from `api-progress-parallel.test.ts`
 * and `config-dynamic.test.ts`, but live in their own file since they attack a
 * different concern (cancellation, not ordering/concurrency).
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

function withPage(url: string, page: number | string): string {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  return u.toString();
}

describe("fetchAllProgress — an already-aborted signal stops after page 1 (Case A)", () => {
  it("throws CancelledError and never fetches page 2, rather than silently returning page 1's results", async () => {
    // count=10, pageSize=2 -> a naive/reverted implementation without the
    // post-page-1 `signal?.aborted` check would happily continue on to build
    // and fetch page 2's URL, and this test would then see a second fetch
    // call and/or a resolved (not rejected) promise.
    const fetchMock = vi.fn(async (url: string) =>
      okResponse({ count: 10, next: withPage(url, 2), results: [member("p1-a"), member("p1-b")] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const controller = new AbortController();
    controller.abort();

    await expect(api.fetchAllProgress(() => {}, controller.signal)).rejects.toMatchObject({
      name: "CancelledError",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAllProgress — aborting mid-batch stops the parallel path before the next batch (Case B)", () => {
  it("never issues the second batch's page requests and throws CancelledError instead of returning partial results", async () => {
    // count=20, pageSize=2 -> totalPages=10 -> remaining pages 2..10 (9 pages),
    // split into batches of PROGRESS_CONCURRENCY=5: batch 1 = pages 2-6,
    // batch 2 = pages 7-10. Aborting the signal from inside page 4's handler
    // (partway through batch 1) must NOT be checked until batch 1 fully
    // settles — but batch 2 (pages 7-10) must never be requested at all.
    const controller = new AbortController();
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "1") {
        return okResponse({
          count: 20,
          next: withPage(url, 2),
          results: [member("p1-a"), member("p1-b")],
        });
      }
      if (page === "4") {
        controller.abort();
      }
      return okResponse({ count: 20, next: null, results: [member(`p${page}-a`), member(`p${page}-b`)] });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    await expect(
      api.fetchAllProgress(() => {}, controller.signal),
    ).rejects.toMatchObject({ name: "CancelledError" });

    // page 1 + pages 2-6 (batch 1) = 6 calls; batch 2 (pages 7-10) never fires.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const requestedPages = fetchMock.mock.calls.map(
      (call) => new URL(call[0] as string).searchParams.get("page"),
    );
    expect(requestedPages).not.toContain("7");
    expect(requestedPages).not.toContain("8");
    expect(requestedPages).not.toContain("9");
    expect(requestedPages).not.toContain("10");
  });
});

describe("fetchAllProgress — aborting mid-run stops the sequential fallback path (Case C)", () => {
  it("never fetches the next page after the one that triggered the abort, and throws CancelledError", async () => {
    // count is missing on page 1 -> fetchAllProgress cannot safely predict
    // page URLs, so it falls back to the sequential fetchRemainingSequentially
    // walk. Abort while handling page 2; page 3 must never be requested.
    const controller = new AbortController();
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "2") {
        controller.abort();
        return okResponse({ count: 6, next: withPage(url, 3), results: [member("p2-a")] });
      }
      if (page === "3") {
        return okResponse({ count: 6, next: null, results: [member("p3-a")] });
      }
      return okResponse({
        next: withPage(url, 2),
        results: [member("p1-a")],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    await expect(
      api.fetchAllProgress(() => {}, controller.signal),
    ).rejects.toMatchObject({ name: "CancelledError" });

    // page 1 + page 2 only; page 3 is never requested.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedPages = fetchMock.mock.calls.map(
      (call) => new URL(call[0] as string).searchParams.get("page"),
    );
    expect(requestedPages).not.toContain("3");
  });
});

describe("fetchDetail — respects an already-aborted signal (Case D)", () => {
  it("propagates a real fetch()'s AbortError rejection rather than swallowing it or ignoring the signal", async () => {
    // Real `fetch` rejects with a DOMException named "AbortError" when handed
    // an aborted signal. This mock reproduces that exact contract and only
    // does so when it actually observes an aborted `init.signal` — proving
    // fetchDetail truly threads the signal through to the underlying
    // fetch(...) call rather than dropping it (which would make this mock
    // see `init.signal` as undefined/not-aborted and resolve normally).
    const controller = new AbortController();
    controller.abort();

    const fetchMock = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      if (init.signal?.aborted) {
        const abortError = new Error("The operation was aborted.");
        abortError.name = "AbortError";
        throw abortError;
      }
      return okResponse({ blocks: {}, speeches: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    await expect(
      api.fetchDetail("course-1", "user-1", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("NEGATIVE CONTROL: cancellation checks do not fire on an un-aborted signal", () => {
  it("fetchAllProgress completes normally (parallel path) when the signal is never aborted", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "1") {
        return okResponse({
          count: 6,
          next: withPage(url, 2),
          results: [member("p1-a"), member("p1-b")],
        });
      }
      return okResponse({ count: 6, next: null, results: [member(`p${page}-a`), member(`p${page}-b`)] });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.BASECAMP_SESSIONID = "sid";
    const api = await import("../helpers/api");

    const controller = new AbortController();
    const members = await api.fetchAllProgress(() => {}, controller.signal);

    expect(members).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
