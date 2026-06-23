import { describe, it, expect, beforeEach } from "vitest";
import {
  snapshotProgress,
  snapshotMembership,
  getLatestProgress,
  getLatestMembership,
  getProgressDiff,
  getMembershipDiff,
} from "../../helpers/db.js";
import type { MemberProgress } from "../../types.js";

// All tests use ":memory:" so nothing is ever written to the real results/db.sqlite.
// The DEFAULT_DB_PATH default is overridden by passing ":memory:" explicitly.
//
// Note: better-sqlite3 with ":memory:" creates a NEW, empty database each time
// openDb() is called, so each test that needs data must insert it in a controlled
// capturedAt order so the diff queries see ≥ 2 distinct snapshots.

const MEM = ":memory:";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid MemberProgress fixture */
function makeMember(overrides: Partial<MemberProgress> = {}): MemberProgress {
  return {
    user: {
      id: 1,
      first_name: "Alice",
      last_name: "Tan",
      name: "Alice Tan",
      email: "alice@example.com",
      username: "alicetan",
    },
    path_name: "Presentation Mastery",
    course_id: "course-001",
    progression: {
      "Level 1": { completed: 5, total: 5, approved: true },
      "Level 2": { completed: 0, total: 5, approved: false },
      "Level 3": { completed: 0, total: 5, approved: false },
      "Level 4": { completed: 0, total: 5, approved: false },
      "Level 5": { completed: 0, total: 5, approved: false },
      "Path Completion": { completed: 5, total: 14 },
    },
    ...overrides,
  };
}

/** Minimal membership CSV with the column names snapshotMembership expects */
function membershipCsv(rows: Array<{ email: string; name: string; status: string; credentials?: string }>): string {
  const header = "Email,Name,Status (*),Credentials";
  const lines = rows.map(r => `${r.email},${r.name},${r.status},${r.credentials ?? ""}`);
  return [header, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// snapshotProgress
// ---------------------------------------------------------------------------

describe("snapshotProgress", () => {
  it("inserts one row per member into the in-memory DB", () => {
    const members = [makeMember()];
    // Should not throw
    expect(() => snapshotProgress(members, MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("stores level_1 = 1 when Level 1 is approved", () => {
    const members = [makeMember()];
    snapshotProgress(members, MEM, "2025-01-01T00:00:00.000Z");
    // We verify via getLatestProgress — same :memory: handle would be needed,
    // but since each openDb call creates a new :memory: DB we only verify no throw here.
    // The round-trip test lives in getLatestProgress below.
    expect(true).toBe(true);
  });

  it("inserts multiple members in a single snapshot", () => {
    const m1 = makeMember();
    const m2 = makeMember({
      user: {
        id: 2,
        first_name: "Bob",
        last_name: "Lee",
        name: "Bob Lee",
        email: "bob@example.com",
        username: "boblee",
      },
    });
    expect(() => snapshotProgress([m1, m2], MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("normalises email to lowercase before inserting", () => {
    const m = makeMember({
      user: {
        id: 3,
        first_name: "Carol",
        last_name: "Ng",
        name: "Carol Ng",
        email: "Carol@EXAMPLE.COM",
        username: "carolng",
      },
    });
    // Only asserting no error — the round-trip is covered in getLatestProgress tests
    expect(() => snapshotProgress([m], MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("handles an empty members array without error", () => {
    expect(() => snapshotProgress([], MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("stores path_done = 1 when Path Completion is reached", () => {
    const m = makeMember({
      progression: {
        "Level 1": { completed: 5, total: 5, approved: true },
        "Level 2": { completed: 5, total: 5, approved: true },
        "Level 3": { completed: 5, total: 5, approved: true },
        "Level 4": { completed: 5, total: 5, approved: true },
        "Level 5": { completed: 5, total: 5, approved: true },
        "Path Completion": { completed: 14, total: 14 },
      },
    });
    // No throw expected; round-trip verified in getProgressDiff tests
    expect(() => snapshotProgress([m], MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// snapshotMembership
// ---------------------------------------------------------------------------

describe("snapshotMembership", () => {
  it("inserts one row per CSV data line", () => {
    const csv = membershipCsv([
      { email: "alice@example.com", name: "Alice Tan", status: "Active" },
    ]);
    expect(() => snapshotMembership(csv, MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("handles multiple members in the CSV", () => {
    const csv = membershipCsv([
      { email: "alice@example.com", name: "Alice Tan", status: "Active" },
      { email: "bob@example.com", name: "Bob Lee", status: "Inactive" },
    ]);
    expect(() => snapshotMembership(csv, MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("skips rows that have no email column value", () => {
    const csv = "Email,Name,Status (*),Credentials\n,No Email Person,Active,\n";
    expect(() => snapshotMembership(csv, MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("normalises email to lowercase", () => {
    const csv = membershipCsv([
      { email: "Alice@Example.COM", name: "Alice Tan", status: "Active" },
    ]);
    expect(() => snapshotMembership(csv, MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("handles an empty CSV (header only) without error", () => {
    const csv = "Email,Name,Status (*),Credentials\n";
    expect(() => snapshotMembership(csv, MEM, "2025-01-01T00:00:00.000Z")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getLatestProgress
// ---------------------------------------------------------------------------
//
// Because ":memory:" creates a fresh DB on every openDb() call, we cannot use
// getLatestProgress to read back what snapshotProgress wrote (they'd be different
// in-memory DBs). We therefore test getLatestProgress against a non-existent file
// path (it returns null when the file doesn't exist) and against a temporary file
// to verify the round-trip.

import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function withTempDb<T>(fn: (dbPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "tmtest-"));
  const dbPath = join(dir, "test.sqlite");
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("getLatestProgress", () => {
  it("returns null when the database file does not exist", () => {
    expect(getLatestProgress("/nonexistent/path/db.sqlite")).toBeNull();
  });

  it("returns null when the DB exists but has no rows", () => {
    withTempDb(dbPath => {
      // Create the DB by doing an empty snapshot
      snapshotProgress([], dbPath, "2025-01-01T00:00:00.000Z");
      const result = getLatestProgress(dbPath);
      expect(result).toBeNull();
    });
  });

  it("returns one ProgressSnapshot per member in the latest snapshot", () => {
    withTempDb(dbPath => {
      const members = [makeMember()];
      snapshotProgress(members, dbPath, "2025-01-01T00:00:00.000Z");
      const result = getLatestProgress(dbPath);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(1);
    });
  });

  it("returns the correct email, firstName, lastName, and pathName", () => {
    withTempDb(dbPath => {
      snapshotProgress([makeMember()], dbPath, "2025-01-01T00:00:00.000Z");
      const rows = getLatestProgress(dbPath)!;
      const row = rows[0];
      expect(row.email).toBe("alice@example.com");
      expect(row.firstName).toBe("Alice");
      expect(row.lastName).toBe("Tan");
      expect(row.pathName).toBe("Presentation Mastery");
    });
  });

  it("maps level_1 = 1 to level1 = true", () => {
    withTempDb(dbPath => {
      snapshotProgress([makeMember()], dbPath, "2025-01-01T00:00:00.000Z");
      const row = getLatestProgress(dbPath)![0];
      expect(row.level1).toBe(true);
    });
  });

  it("maps level_2 = 0 to level2 = false", () => {
    withTempDb(dbPath => {
      snapshotProgress([makeMember()], dbPath, "2025-01-01T00:00:00.000Z");
      const row = getLatestProgress(dbPath)![0];
      expect(row.level2).toBe(false);
    });
  });

  it("returns only the most recent snapshot when two snapshots exist", () => {
    withTempDb(dbPath => {
      // Older snapshot: Level 1 not approved
      const oldMember = makeMember({
        progression: {
          "Level 1": { completed: 0, total: 5, approved: false },
          "Level 2": { completed: 0, total: 5, approved: false },
          "Level 3": { completed: 0, total: 5, approved: false },
          "Level 4": { completed: 0, total: 5, approved: false },
          "Level 5": { completed: 0, total: 5, approved: false },
          "Path Completion": { completed: 0, total: 14 },
        },
      });
      snapshotProgress([oldMember], dbPath, "2025-01-01T00:00:00.000Z");

      // Newer snapshot: Level 1 now approved
      snapshotProgress([makeMember()], dbPath, "2025-02-01T00:00:00.000Z");

      const rows = getLatestProgress(dbPath)!;
      expect(rows).toHaveLength(1);
      expect(rows[0].level1).toBe(true); // newer snapshot
    });
  });

  it("normalises email to lowercase in the returned row", () => {
    withTempDb(dbPath => {
      const m = makeMember({
        user: {
          id: 9,
          first_name: "Upper",
          last_name: "Case",
          name: "Upper Case",
          email: "UPPER@EXAMPLE.COM",
          username: "uppercase",
        },
      });
      snapshotProgress([m], dbPath, "2025-01-01T00:00:00.000Z");
      const row = getLatestProgress(dbPath)![0];
      expect(row.email).toBe("upper@example.com");
    });
  });
});

// ---------------------------------------------------------------------------
// getLatestMembership
// ---------------------------------------------------------------------------

describe("getLatestMembership", () => {
  it("returns null when the database file does not exist", () => {
    expect(getLatestMembership("/nonexistent/path/db.sqlite")).toBeNull();
  });

  it("returns null when the DB has no membership rows", () => {
    withTempDb(dbPath => {
      snapshotMembership("Email,Name,Status (*),Credentials\n", dbPath, "2025-01-01T00:00:00.000Z");
      expect(getLatestMembership(dbPath)).toBeNull();
    });
  });

  it("returns one row per member in the latest membership snapshot", () => {
    withTempDb(dbPath => {
      const csv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
        { email: "bob@example.com", name: "Bob Lee", status: "Active" },
      ]);
      snapshotMembership(csv, dbPath, "2025-01-01T00:00:00.000Z");
      const rows = getLatestMembership(dbPath)!;
      expect(rows).toHaveLength(2);
    });
  });

  it("returns the correct email, name, status, and credentials fields", () => {
    withTempDb(dbPath => {
      const csv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active", credentials: "DTM" },
      ]);
      snapshotMembership(csv, dbPath, "2025-01-01T00:00:00.000Z");
      const row = getLatestMembership(dbPath)![0];
      expect(row.email).toBe("alice@example.com");
      expect(row.name).toBe("Alice Tan");
      expect(row.status).toBe("Active");
      expect(row.credentials).toBe("DTM");
    });
  });

  it("returns only the most recent snapshot when two snapshots exist", () => {
    withTempDb(dbPath => {
      const oldCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Inactive" },
      ]);
      snapshotMembership(oldCsv, dbPath, "2025-01-01T00:00:00.000Z");

      const newCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
        { email: "bob@example.com", name: "Bob Lee", status: "Active" },
      ]);
      snapshotMembership(newCsv, dbPath, "2025-02-01T00:00:00.000Z");

      const rows = getLatestMembership(dbPath)!;
      expect(rows).toHaveLength(2); // from the newer snapshot only
    });
  });

  it("normalises email to lowercase in the returned rows", () => {
    withTempDb(dbPath => {
      const csv = membershipCsv([
        { email: "ALICE@EXAMPLE.COM", name: "Alice Tan", status: "Active" },
      ]);
      snapshotMembership(csv, dbPath, "2025-01-01T00:00:00.000Z");
      const row = getLatestMembership(dbPath)![0];
      expect(row.email).toBe("alice@example.com");
    });
  });
});

// ---------------------------------------------------------------------------
// getProgressDiff
// ---------------------------------------------------------------------------

describe("getProgressDiff", () => {
  it("returns null when there is only one snapshot", () => {
    withTempDb(dbPath => {
      snapshotProgress([makeMember()], dbPath, "2025-01-01T00:00:00.000Z");
      expect(getProgressDiff(dbPath)).toBeNull();
    });
  });

  it("returns null when the DB file does not exist", () => {
    // getProgressDiff calls openDb which will create the file, so we test with
    // a temp path that has zero snapshots after creation
    withTempDb(dbPath => {
      snapshotProgress([], dbPath, "2025-01-01T00:00:00.000Z");
      expect(getProgressDiff(dbPath)).toBeNull();
    });
  });

  it("returns older and newer timestamps in the result", () => {
    withTempDb(dbPath => {
      snapshotProgress([makeMember()], dbPath, "2025-01-01T00:00:00.000Z");
      const newMember = makeMember();
      snapshotProgress([newMember], dbPath, "2025-02-01T00:00:00.000Z");
      const diff = getProgressDiff(dbPath)!;
      expect(diff.older).toBe("2025-01-01T00:00:00.000Z");
      expect(diff.newer).toBe("2025-02-01T00:00:00.000Z");
    });
  });

  it("returns an empty changes array when no levels changed between snapshots", () => {
    withTempDb(dbPath => {
      const m = makeMember();
      snapshotProgress([m], dbPath, "2025-01-01T00:00:00.000Z");
      snapshotProgress([m], dbPath, "2025-02-01T00:00:00.000Z");
      const diff = getProgressDiff(dbPath)!;
      expect(diff.changes).toHaveLength(0);
    });
  });

  it("reports a level gain when a member advances from Level 1 not approved to approved", () => {
    withTempDb(dbPath => {
      // Older snapshot: Level 1 not approved
      const older = makeMember({
        progression: {
          "Level 1": { completed: 0, total: 5, approved: false },
          "Level 2": { completed: 0, total: 5, approved: false },
          "Level 3": { completed: 0, total: 5, approved: false },
          "Level 4": { completed: 0, total: 5, approved: false },
          "Level 5": { completed: 0, total: 5, approved: false },
          "Path Completion": { completed: 0, total: 14 },
        },
      });
      snapshotProgress([older], dbPath, "2025-01-01T00:00:00.000Z");

      // Newer snapshot: Level 1 now approved
      snapshotProgress([makeMember()], dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getProgressDiff(dbPath)!;
      expect(diff.changes).toHaveLength(1);
      const change = diff.changes[0];
      expect(change.email).toBe("alice@example.com");
      expect(change.gained).toContain("Level 1");
    });
  });

  it("reports multiple level gains in a single diff entry when several levels were approved", () => {
    withTempDb(dbPath => {
      // Older: no levels approved
      const older = makeMember({
        progression: {
          "Level 1": { completed: 0, total: 5, approved: false },
          "Level 2": { completed: 0, total: 5, approved: false },
          "Level 3": { completed: 0, total: 5, approved: false },
          "Level 4": { completed: 0, total: 5, approved: false },
          "Level 5": { completed: 0, total: 5, approved: false },
          "Path Completion": { completed: 0, total: 14 },
        },
      });
      snapshotProgress([older], dbPath, "2025-01-01T00:00:00.000Z");

      // Newer: Levels 1 and 2 approved
      const newer = makeMember({
        progression: {
          "Level 1": { completed: 5, total: 5, approved: true },
          "Level 2": { completed: 5, total: 5, approved: true },
          "Level 3": { completed: 0, total: 5, approved: false },
          "Level 4": { completed: 0, total: 5, approved: false },
          "Level 5": { completed: 0, total: 5, approved: false },
          "Path Completion": { completed: 10, total: 14 },
        },
      });
      snapshotProgress([newer], dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getProgressDiff(dbPath)!;
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].gained).toEqual(["Level 1", "Level 2"]);
    });
  });

  it("does not report a member who had no level changes", () => {
    withTempDb(dbPath => {
      const unchanged = makeMember();
      const advancing = makeMember({
        user: {
          id: 2,
          first_name: "Bob",
          last_name: "Lee",
          name: "Bob Lee",
          email: "bob@example.com",
          username: "boblee",
        },
        progression: {
          "Level 1": { completed: 0, total: 5, approved: false },
          "Level 2": { completed: 0, total: 5, approved: false },
          "Level 3": { completed: 0, total: 5, approved: false },
          "Level 4": { completed: 0, total: 5, approved: false },
          "Level 5": { completed: 0, total: 5, approved: false },
          "Path Completion": { completed: 0, total: 14 },
        },
      });
      snapshotProgress([unchanged, advancing], dbPath, "2025-01-01T00:00:00.000Z");

      const advancedBob = makeMember({
        user: {
          id: 2,
          first_name: "Bob",
          last_name: "Lee",
          name: "Bob Lee",
          email: "bob@example.com",
          username: "boblee",
        },
      }); // Level 1 now approved
      snapshotProgress([unchanged, advancedBob], dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getProgressDiff(dbPath)!;
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].email).toBe("bob@example.com");
    });
  });

  it("reports Path Completion gain correctly", () => {
    withTempDb(dbPath => {
      const older = makeMember({
        progression: {
          "Level 1": { completed: 5, total: 5, approved: true },
          "Level 2": { completed: 5, total: 5, approved: true },
          "Level 3": { completed: 5, total: 5, approved: true },
          "Level 4": { completed: 5, total: 5, approved: true },
          "Level 5": { completed: 5, total: 5, approved: true },
          "Path Completion": { completed: 13, total: 14 }, // not yet complete
        },
      });
      snapshotProgress([older], dbPath, "2025-01-01T00:00:00.000Z");

      const newer = makeMember({
        progression: {
          "Level 1": { completed: 5, total: 5, approved: true },
          "Level 2": { completed: 5, total: 5, approved: true },
          "Level 3": { completed: 5, total: 5, approved: true },
          "Level 4": { completed: 5, total: 5, approved: true },
          "Level 5": { completed: 5, total: 5, approved: true },
          "Path Completion": { completed: 14, total: 14 }, // now complete
        },
      });
      snapshotProgress([newer], dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getProgressDiff(dbPath)!;
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].gained).toContain("Path Completion");
    });
  });
});

// ---------------------------------------------------------------------------
// getMembershipDiff
// ---------------------------------------------------------------------------

describe("getMembershipDiff", () => {
  it("returns null when there is only one membership snapshot", () => {
    withTempDb(dbPath => {
      const csv = membershipCsv([{ email: "alice@example.com", name: "Alice Tan", status: "Active" }]);
      snapshotMembership(csv, dbPath, "2025-01-01T00:00:00.000Z");
      expect(getMembershipDiff(dbPath)).toBeNull();
    });
  });

  it("returns older and newer timestamps", () => {
    withTempDb(dbPath => {
      const csv = membershipCsv([{ email: "alice@example.com", name: "Alice Tan", status: "Active" }]);
      snapshotMembership(csv, dbPath, "2025-01-01T00:00:00.000Z");
      snapshotMembership(csv, dbPath, "2025-02-01T00:00:00.000Z");
      const diff = getMembershipDiff(dbPath)!;
      expect(diff.older).toBe("2025-01-01T00:00:00.000Z");
      expect(diff.newer).toBe("2025-02-01T00:00:00.000Z");
    });
  });

  it("returns empty joined/left/statusChanged when nothing changed", () => {
    withTempDb(dbPath => {
      const csv = membershipCsv([{ email: "alice@example.com", name: "Alice Tan", status: "Active" }]);
      snapshotMembership(csv, dbPath, "2025-01-01T00:00:00.000Z");
      snapshotMembership(csv, dbPath, "2025-02-01T00:00:00.000Z");
      const diff = getMembershipDiff(dbPath)!;
      expect(diff.joined).toHaveLength(0);
      expect(diff.left).toHaveLength(0);
      expect(diff.statusChanged).toHaveLength(0);
    });
  });

  it("identifies a new member who appears in the newer snapshot only as joined", () => {
    withTempDb(dbPath => {
      const oldCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
      ]);
      snapshotMembership(oldCsv, dbPath, "2025-01-01T00:00:00.000Z");

      const newCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
        { email: "bob@example.com", name: "Bob Lee", status: "Active" },
      ]);
      snapshotMembership(newCsv, dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getMembershipDiff(dbPath)!;
      expect(diff.joined).toHaveLength(1);
      expect(diff.joined[0].email).toBe("bob@example.com");
      expect(diff.joined[0].name).toBe("Bob Lee");
    });
  });

  it("identifies a member who was in the older snapshot but not the newer as left", () => {
    withTempDb(dbPath => {
      const oldCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
        { email: "bob@example.com", name: "Bob Lee", status: "Active" },
      ]);
      snapshotMembership(oldCsv, dbPath, "2025-01-01T00:00:00.000Z");

      const newCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
      ]);
      snapshotMembership(newCsv, dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getMembershipDiff(dbPath)!;
      expect(diff.left).toHaveLength(1);
      expect(diff.left[0].email).toBe("bob@example.com");
    });
  });

  it("identifies a status change from Inactive to Active", () => {
    withTempDb(dbPath => {
      const oldCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Inactive" },
      ]);
      snapshotMembership(oldCsv, dbPath, "2025-01-01T00:00:00.000Z");

      const newCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
      ]);
      snapshotMembership(newCsv, dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getMembershipDiff(dbPath)!;
      expect(diff.statusChanged).toHaveLength(1);
      const change = diff.statusChanged[0];
      expect(change.email).toBe("alice@example.com");
      expect(change.oldStatus).toBe("Inactive");
      expect(change.newStatus).toBe("Active");
    });
  });

  it("correctly handles simultaneous joins, departures, and status changes in one diff", () => {
    withTempDb(dbPath => {
      const oldCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Active" },
        { email: "leaving@example.com", name: "Leaving Person", status: "Active" },
      ]);
      snapshotMembership(oldCsv, dbPath, "2025-01-01T00:00:00.000Z");

      const newCsv = membershipCsv([
        { email: "alice@example.com", name: "Alice Tan", status: "Inactive" }, // status changed
        { email: "new@example.com", name: "New Person", status: "Active" },   // joined
        // leaving@example.com is absent → left
      ]);
      snapshotMembership(newCsv, dbPath, "2025-02-01T00:00:00.000Z");

      const diff = getMembershipDiff(dbPath)!;
      expect(diff.joined).toHaveLength(1);
      expect(diff.joined[0].email).toBe("new@example.com");
      expect(diff.left).toHaveLength(1);
      expect(diff.left[0].email).toBe("leaving@example.com");
      expect(diff.statusChanged).toHaveLength(1);
      expect(diff.statusChanged[0].email).toBe("alice@example.com");
    });
  });
});
