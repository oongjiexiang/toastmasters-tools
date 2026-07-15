import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  getLatestProgress,
  getLatestMembership,
  getLatestProjects,
} from "@toastmasters/core/db";
import { GET } from "../../app/api/members/route.js";

/**
 * The route no longer imports `@toastmasters/core/db` — it imports
 * `@toastmasters/core/queries`, which imports `./helpers/db` *relatively*. Vitest
 * keys its mock registry by resolved module id, not by the specifier string, so
 * both spellings collapse onto the same file and this mock still intercepts the
 * route's database access.
 *
 * That is a load-bearing assumption, and a `vi.mock` whose specifier fails to
 * match is silent: the route would quietly hit the real results/db.sqlite and the
 * suite would still be "green" for the wrong reason. The
 * `expect(...).toHaveBeenCalled...` assertions below exist to make that failure
 * mode loud — they can only pass if the mock is actually engaged on the route's
 * side of the import graph.
 */
vi.mock("@toastmasters/core/db", () => ({
  getLatestProgress: vi.fn(),
  getLatestMembership: vi.fn(),
  getLatestProjects: vi.fn(),
}));

const mockProgressRow = {
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Smith",
  pathName: "Presentation Mastery",
  level1: true,
  level2: false,
  level3: false,
  level4: false,
  level5: false,
  pathDone: false,
};

const mockMembershipRow = {
  email: "alice@example.com",
  name: "Alice Smith",
  status: "Active",
  credentials: "",
};

describe("GET /api/members", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reaches the database only through the mocked core module", async () => {
    vi.mocked(getLatestProgress).mockReturnValue([mockProgressRow] as never);
    vi.mocked(getLatestMembership).mockReturnValue([mockMembershipRow] as never);
    vi.mocked(getLatestProjects).mockReturnValue([]);

    await GET();

    // Zero calls here would mean the route resolved a *different* copy of
    // helpers/db than the one this file mocked — i.e. it queried the real DB.
    expect(getLatestProgress).toHaveBeenCalledTimes(1);
    expect(getLatestMembership).toHaveBeenCalledTimes(1);
    expect(getLatestProjects).toHaveBeenCalledWith(
      "alice@example.com",
      "Presentation Mastery",
      undefined,
    );
  });

  it("returns 503 when progress snapshot is missing", async () => {
    vi.mocked(getLatestProgress).mockReturnValue(null);
    vi.mocked(getLatestMembership).mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("SNAPSHOT_MISSING");
  });

  it("returns 200 with member list when snapshots exist", async () => {
    vi.mocked(getLatestProgress).mockReturnValue([mockProgressRow] as never);
    vi.mocked(getLatestMembership).mockReturnValue([mockMembershipRow] as never);
    vi.mocked(getLatestProjects).mockReturnValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].email).toBe("alice@example.com");
    expect(body.data[0].name).toBe("Alice Smith");
  });

  it("excludes members with UnpaidMember status", async () => {
    vi.mocked(getLatestProgress).mockReturnValue([mockProgressRow] as never);
    vi.mocked(getLatestMembership).mockReturnValue([{ ...mockMembershipRow, status: "UnpaidMember" }] as never);
    vi.mocked(getLatestProjects).mockReturnValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });
});
