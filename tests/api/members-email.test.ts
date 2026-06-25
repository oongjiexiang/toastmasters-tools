import { vi, describe, it, expect, beforeEach } from "vitest";
import { getLatestProgress, getLatestMembership, getLatestProjects } from "@/helpers/db";
import { GET } from "../../app/api/members/[email]/route.js";

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

function makeRequest(email: string, pathway?: string): Request {
  const url = `http://localhost/api/members/${encodeURIComponent(email)}${pathway ? `?pathway=${encodeURIComponent(pathway)}` : ""}`;
  return new Request(url);
}

function makeParams(email: string) {
  return { params: Promise.resolve({ email: encodeURIComponent(email) }) };
}

describe("GET /api/members/[email]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when pathway param is missing", async () => {
    const res = await GET(makeRequest("alice@example.com"), makeParams("alice@example.com"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
  });

  it("returns 503 when progress snapshot is missing", async () => {
    vi.mocked(getLatestProgress).mockReturnValue(null);
    const res = await GET(
      makeRequest("alice@example.com", "Presentation Mastery"),
      makeParams("alice@example.com"),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("SNAPSHOT_MISSING");
  });

  it("returns 404 when the member is not found in the snapshot", async () => {
    vi.mocked(getLatestProgress).mockReturnValue([mockProgressRow] as never);
    const res = await GET(
      makeRequest("other@example.com", "Presentation Mastery"),
      makeParams("other@example.com"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 200 with full level detail for a found member", async () => {
    vi.mocked(getLatestProgress).mockReturnValue([mockProgressRow] as never);
    vi.mocked(getLatestMembership).mockReturnValue([]);
    vi.mocked(getLatestProjects).mockReturnValue([]);
    const res = await GET(
      makeRequest("alice@example.com", "Presentation Mastery"),
      makeParams("alice@example.com"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.email).toBe("alice@example.com");
    expect(body.data.levels).toHaveLength(6);
  });
});
