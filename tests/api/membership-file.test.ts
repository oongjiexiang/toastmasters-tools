import { vi, describe, it, expect, beforeEach } from "vitest";
import { findLatestMembershipFile } from "@/helpers/files";
import { GET } from "../../app/api/membership-file/route.js";

vi.mock("@/helpers/files", () => ({
  findLatestMembershipFile: vi.fn(),
}));

vi.mock("@/config", () => ({
  RESULTS_DIR: "results",
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, readFileSync: vi.fn() };
});

import { readFileSync } from "fs";

describe("GET /api/membership-file", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when no membership file exists", async () => {
    vi.mocked(findLatestMembershipFile).mockImplementation(() => {
      throw new Error("No membership file found");
    });
    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 200 with CSV content when a file exists", async () => {
    vi.mocked(findLatestMembershipFile).mockReturnValue("/results/membership-2025-01-01.csv");
    vi.mocked(readFileSync).mockReturnValue(Buffer.from("email,name\nalice@example.com,Alice"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("membership-2025-01-01.csv");
  });
});
