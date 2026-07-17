import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberProgress } from "../types";

/**
 * Phase 22 — `services/fetch.ts`'s `main()` now accepts an optional
 * `AbortSignal` and threads it into Step 1 (`fetchAllProgress`) and Step 2
 * (`fetchDetail`, concurrency-limited). Per the roadmap: "an abort during
 * Step 2 skips Step 3 (`snapshotProjects`) rather than writing incomplete
 * data — Step 1's snapshot, already written, is safe to keep."
 *
 * `helpers/api.ts` and `helpers/db.ts` are mocked at the module boundary
 * (mirrors `main-ipc.test.ts`'s "mock the one module that crosses the
 * boundary" pattern) so this exercises only `main()`'s own control flow —
 * whether it calls `snapshotProgress`/`snapshotProjects` and whether it
 * throws — not the real HTTP/DB layers underneath (those are covered by
 * `api-cancellation.test.ts` and `db.test.ts` respectively).
 */

const KEYS = ["BASECAMP_SESSIONID"] as const;
let saved: Record<string, string | undefined>;

const snapshotProgress = vi.fn();
const snapshotProjects = vi.fn();
const fetchAllProgress = vi.fn();
const fetchDetail = vi.fn();

class FakeCancelledError extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

vi.mock("../helpers/db", () => ({
  snapshotProgress,
  snapshotProjects,
}));

vi.mock("../helpers/api", () => ({
  fetchAllProgress,
  fetchDetail,
  CancelledError: FakeCancelledError,
}));

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.BASECAMP_SESSIONID = "sid";
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

function member(username: string): MemberProgress {
  return {
    user: {
      id: 1,
      first_name: "First",
      last_name: username,
      name: `First ${username}`,
      email: `${username}@example.com`,
      username,
    },
    path_name: "Innovative Planning",
    course_id: `course-${username}`,
    progression: {},
  };
}

describe("services/fetch.ts main() — cancellation mid Step 2 skips Step 3 (Phase 22)", () => {
  it("rejects with CancelledError, keeps Step 1's snapshotProgress, and never calls snapshotProjects", async () => {
    const members = [member("alice"), member("bob"), member("carol")];
    fetchAllProgress.mockResolvedValue(members);

    const controller = new AbortController();
    // All three members fit in a single DETAIL_CONCURRENCY=5 batch. Aborting
    // from inside one member's fetchDetail call simulates the user clicking
    // Cancel while Step 2 is mid-flight; the batch still settles (the other
    // two calls resolve normally), and only the post-batch `signal?.aborted`
    // check stops the run before Step 3.
    fetchDetail.mockImplementation(async (_courseId: string, username: string) => {
      if (username === "alice") controller.abort();
      return { blocks: {}, speeches: {} };
    });

    const { main } = await import("../services/fetch");

    await expect(main(() => {}, controller.signal)).rejects.toMatchObject({
      name: "CancelledError",
    });

    expect(snapshotProgress).toHaveBeenCalledTimes(1);
    expect(snapshotProgress).toHaveBeenCalledWith(members);
    expect(snapshotProjects).not.toHaveBeenCalled();
  });

  it("NEGATIVE CONTROL: without an abort, Step 3 (snapshotProjects) runs normally", async () => {
    // Proves the above test can actually fail: revert the `if (signal?.aborted)
    // throw new CancelledError()` checks in services/fetch.ts and the first
    // test's promise would resolve (not reject) and snapshotProjects WOULD be
    // called — this test pins down that snapshotProjects being called is the
    // expected, un-cancelled behaviour, not something these mocks force either way.
    const members = [member("alice"), member("bob")];
    fetchAllProgress.mockResolvedValue(members);
    fetchDetail.mockResolvedValue({ blocks: {}, speeches: {} });

    const { main } = await import("../services/fetch");

    await expect(main(() => {})).resolves.toBeUndefined();

    expect(snapshotProgress).toHaveBeenCalledTimes(1);
    expect(snapshotProjects).toHaveBeenCalledTimes(1);
  });

  it("rejects with CancelledError via the loop's post-loop check when Step 1 returns zero members", async () => {
    // With zero members, Step 2's `for` loop body never executes (so its own
    // internal `if (signal?.aborted)` check never runs) — this is the ONE
    // scenario that reaches the second, otherwise-redundant
    // `if (signal?.aborted) throw new CancelledError();` sitting right after
    // the loop. Proves that check independently, not just the same one twice.
    fetchAllProgress.mockResolvedValue([]);

    const controller = new AbortController();
    controller.abort();

    const { main } = await import("../services/fetch");

    await expect(main(() => {}, controller.signal)).rejects.toMatchObject({
      name: "CancelledError",
    });
    expect(fetchDetail).not.toHaveBeenCalled();
    expect(snapshotProjects).not.toHaveBeenCalled();
  });
});
