import { vi, describe, it, expect, beforeEach } from "vitest";
import { getProgressDiff, getMembershipDiff } from "@toastmasters/core/db";
import { GET } from "../../app/api/diff/route.js";

vi.mock("@toastmasters/core/db", () => ({
  getProgressDiff: vi.fn(),
  getMembershipDiff: vi.fn(),
}));

describe("GET /api/diff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 503 when either diff snapshot is missing", async () => {
    vi.mocked(getProgressDiff).mockReturnValue(null);
    vi.mocked(getMembershipDiff).mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("SNAPSHOT_MISSING");
  });

  it("returns 200 with progress and membership diff data", async () => {
    const mockProgress = { older: "2025-01-01", newer: "2025-02-01", changes: [] };
    const mockMembership = { older: "2025-01-01", newer: "2025-02-01", joined: [], left: [], statusChanged: [] };
    vi.mocked(getProgressDiff).mockReturnValue(mockProgress as never);
    vi.mocked(getMembershipDiff).mockReturnValue(mockMembership as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.progress).toEqual(mockProgress);
    expect(body.data.membership).toEqual(mockMembership);
  });

  // See members.test.ts: proves the mock is engaged on the *route's* side of the
  // import graph, not just on this test file's side.
  it("reaches the database only through the mocked core module", async () => {
    vi.mocked(getProgressDiff).mockReturnValue(null);
    vi.mocked(getMembershipDiff).mockReturnValue(null);

    await GET();

    expect(getProgressDiff).toHaveBeenCalledTimes(1);
    expect(getMembershipDiff).toHaveBeenCalledTimes(1);
  });
});
