import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 22 — `services/membership.ts`'s `main()` now accepts an optional
 * `AbortSignal`, passed straight into its single `fetch(...)` call. Unlike
 * `services/fetch.ts` (which has its own explicit `signal?.aborted` checks
 * between batches), membership's cancellation relies entirely on `fetch`
 * itself rejecting when handed an aborted signal — the same real-world
 * contract exercised in `api-cancellation.test.ts`'s `fetchDetail` case.
 *
 * `fs`'s `writeFileSync`/`mkdirSync` and `helpers/db.ts`'s
 * `snapshotMembership` are mocked at the module boundary so this proves the
 * roadmap's contract directly: an abort before the response resolves must
 * mean neither the CSV file nor the DB snapshot are ever written.
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

describe("services/membership.ts main() — cancellation before the response resolves (Phase 22)", () => {
  it("never writes the CSV or snapshots membership when the signal aborts mid-fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      // Simulate the abort happening while the request is in flight, then
      // reproduce real fetch()'s AbortError-shaped rejection.
      controller.abort();
      if (init.signal?.aborted) {
        const abortError = new Error("The operation was aborted.");
        abortError.name = "AbortError";
        throw abortError;
      }
      return okTextResponse("Email,Name\n");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { main } = await import("../services/membership");

    await expect(main(() => {}, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(snapshotMembership).not.toHaveBeenCalled();
    // Proves the signal was actually threaded into the fetch(...) call rather
    // than dropped — a dropped signal would leave `init.signal` undefined,
    // this mock would never see `.aborted`, and it would resolve normally.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("NEGATIVE CONTROL: without an abort, the CSV is written and membership is snapshotted normally", async () => {
    // Proves the test above can actually fail: if `main()` stopped threading
    // the signal into fetch(...) (or swallowed the AbortError instead of
    // propagating it), this "happy path" would be indistinguishable from the
    // cancelled one. This pins down that writeFileSync/snapshotMembership
    // being skipped is specifically the cancelled-run behaviour.
    const fetchMock = vi.fn(async () => okTextResponse("Email,Name\nalice@example.com,Alice Smith\n"));
    vi.stubGlobal("fetch", fetchMock);

    const { main } = await import("../services/membership");

    await expect(main(() => {})).resolves.toBeUndefined();

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(snapshotMembership).toHaveBeenCalledTimes(1);
    expect(snapshotMembership).toHaveBeenCalledWith("Email,Name\nalice@example.com,Alice Smith\n");
  });
});
