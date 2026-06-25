import { vi, describe, it, expect, beforeEach } from "vitest";
import { getLatestProgress, getLatestMembership, getLatestProjects } from "@/helpers/db";
import { GET } from "../../app/api/members/route.js";

vi.mock("@/helpers/db", () => ({
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
