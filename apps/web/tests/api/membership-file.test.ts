import { vi, describe, it, expect, beforeEach } from "vitest";
import { isAbsolute } from "path";
import { findLatestMembershipFile } from "@toastmasters/core/files";
import { RESULTS_DIR } from "@toastmasters/core/config";
import { GET } from "../../app/api/membership-file/route.js";

// findLatestMembershipFile and readFileSync are mocked because they are the
// filesystem boundary. @toastmasters/core/config is deliberately NOT mocked: this
// route's whole job is to hand core's RESULTS_DIR to the file lookup, and the
// Phase 10 bug was RESULTS_DIR being the *relative* string "results", which under
// the Next server's cwd (apps/web) pointed at the wrong directory. A stubbed
// RESULTS_DIR would hide exactly that regression.
vi.mock("@toastmasters/core/files", () => ({
  findLatestMembershipFile: vi.fn(),
}));

// readFileSync defaults to the real implementation and is overridden per test.
// It must not default to `undefined`: core/paths.ts reads the repo-root .env with
// readFileSync at module-load time, and a blanket stub breaks that bootstrap.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
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

  it("looks for the membership file in an absolute directory, never a cwd-relative one", async () => {
    vi.mocked(findLatestMembershipFile).mockReturnValue("/results/membership-2025-01-01.csv");
    vi.mocked(readFileSync).mockReturnValue(Buffer.from("email,name"));

    await GET();

    const [dir] = vi.mocked(findLatestMembershipFile).mock.calls[0];
    expect(isAbsolute(dir)).toBe(true);
  });

  it("passes core's RESULTS_DIR through unmodified, without re-resolving it against cwd", async () => {
    vi.mocked(findLatestMembershipFile).mockReturnValue("/results/membership-2025-01-01.csv");
    vi.mocked(readFileSync).mockReturnValue(Buffer.from("email,name"));

    await GET();

    expect(findLatestMembershipFile).toHaveBeenCalledWith(RESULTS_DIR);
  });
});
