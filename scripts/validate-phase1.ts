/**
 * Validation script for Phase 1 (SQLite persistence).
 * Uses isolated temp databases — safe to run at any time without touching results/db.sqlite.
 *
 * Usage: npm run validate
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  snapshotProgress,
  snapshotMembership,
  getProgressDiff,
  getMembershipDiff,
} from "../helpers/db";
import type { MemberProgress } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "tm-validate-"));
  return { path: join(dir, "test.db"), cleanup: () => rmSync(dir, { recursive: true }) };
}

function member(overrides: {
  email: string;
  firstName: string;
  lastName: string;
  pathName: string;
  levels: Partial<Record<"1" | "2" | "3" | "4" | "5", boolean>>;
  pathDone?: boolean;
}): MemberProgress {
  const { email, firstName, lastName, pathName, levels, pathDone = false } = overrides;
  return {
    user: {
      id: 1,
      first_name: firstName,
      last_name: lastName,
      name: `${firstName} ${lastName}`,
      email,
      username: email.split("@")[0],
    },
    path_name: pathName,
    course_id: "course-test",
    progression: {
      "Level 1": { completed: levels["1"] ? 5 : 2, total: 5, approved: levels["1"] ?? false },
      "Level 2": { completed: levels["2"] ? 5 : 0, total: 5, approved: levels["2"] ?? false },
      "Level 3": { completed: levels["3"] ? 5 : 0, total: 5, approved: levels["3"] ?? false },
      "Level 4": { completed: levels["4"] ? 5 : 0, total: 5, approved: levels["4"] ?? false },
      "Level 5": { completed: levels["5"] ? 5 : 0, total: 5, approved: levels["5"] ?? false },
      "Path Completion": { completed: pathDone ? 1 : 0, total: 1 },
    },
  };
}

function membershipCsv(
  rows: Array<{ name: string; email: string; status: string; credentials?: string }>
): string {
  const header = "Name,Email,Status (*),Credentials";
  const lines = rows.map(r =>
    `${r.name},${r.email},${r.status},${r.credentials ?? ""}`
  );
  return [header, ...lines].join("\n");
}

// ── Progress snapshot & diff ──────────────────────────────────────────────────

console.log("\nProgress snapshots");

check("single snapshot returns null diff", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotProgress(
      [member({ email: "a@x.com", firstName: "Alice", lastName: "A", pathName: "PM", levels: { "1": true } })],
      path, "2026-05-01T00:00:00.000Z",
    );
    assert.strictEqual(getProgressDiff(path), null);
  } finally { cleanup(); }
});

check("no changes between identical snapshots", () => {
  const { path, cleanup } = tempDb();
  try {
    const m = [member({ email: "a@x.com", firstName: "Alice", lastName: "A", pathName: "PM", levels: { "1": true } })];
    snapshotProgress(m, path, "2026-05-01T00:00:00.000Z");
    snapshotProgress(m, path, "2026-06-01T00:00:00.000Z");
    const diff = getProgressDiff(path)!;
    assert.strictEqual(diff.changes.length, 0);
  } finally { cleanup(); }
});

check("detects single level gain", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotProgress(
      [member({ email: "b@x.com", firstName: "Bob", lastName: "B", pathName: "DL", levels: { "1": true } })],
      path, "2026-05-01T00:00:00.000Z",
    );
    snapshotProgress(
      [member({ email: "b@x.com", firstName: "Bob", lastName: "B", pathName: "DL", levels: { "1": true, "2": true } })],
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getProgressDiff(path)!;
    assert.strictEqual(diff.changes.length, 1);
    assert.deepStrictEqual(diff.changes[0].gained, ["Level 2"]);
    assert.strictEqual(diff.changes[0].firstName, "Bob");
  } finally { cleanup(); }
});

check("detects multiple levels gained in one run", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotProgress(
      [member({ email: "c@x.com", firstName: "Carol", lastName: "C", pathName: "PM", levels: { "1": true } })],
      path, "2026-04-01T00:00:00.000Z",
    );
    snapshotProgress(
      [member({ email: "c@x.com", firstName: "Carol", lastName: "C", pathName: "PM", levels: { "1": true, "2": true, "3": true } })],
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getProgressDiff(path)!;
    assert.deepStrictEqual(diff.changes[0].gained, ["Level 2", "Level 3"]);
  } finally { cleanup(); }
});

check("ignores members with no level changes", () => {
  const { path, cleanup } = tempDb();
  try {
    const unchanged = member({ email: "d@x.com", firstName: "Dave", lastName: "D", pathName: "PM", levels: { "1": true } });
    const advancing = member({ email: "e@x.com", firstName: "Eve", lastName: "E", pathName: "DL", levels: { "1": true } });
    snapshotProgress([unchanged, advancing], path, "2026-05-01T00:00:00.000Z");
    snapshotProgress(
      [unchanged, member({ email: "e@x.com", firstName: "Eve", lastName: "E", pathName: "DL", levels: { "1": true, "2": true } })],
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getProgressDiff(path)!;
    assert.strictEqual(diff.changes.length, 1);
    assert.strictEqual(diff.changes[0].email, "e@x.com");
  } finally { cleanup(); }
});

check("uses only the two most recent snapshots (ignores older ones)", () => {
  const { path, cleanup } = tempDb();
  try {
    // Three runs: level 1 → level 1+2 → level 1+2 (no change in last two)
    snapshotProgress(
      [member({ email: "f@x.com", firstName: "Frank", lastName: "F", pathName: "PM", levels: { "1": true } })],
      path, "2026-04-01T00:00:00.000Z",
    );
    snapshotProgress(
      [member({ email: "f@x.com", firstName: "Frank", lastName: "F", pathName: "PM", levels: { "1": true, "2": true } })],
      path, "2026-05-01T00:00:00.000Z",
    );
    snapshotProgress(
      [member({ email: "f@x.com", firstName: "Frank", lastName: "F", pathName: "PM", levels: { "1": true, "2": true } })],
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getProgressDiff(path)!;
    // Latest two snapshots (May→Jun) have no change
    assert.strictEqual(diff.changes.length, 0);
  } finally { cleanup(); }
});

check("detects path completion", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotProgress(
      [member({ email: "g@x.com", firstName: "Grace", lastName: "G", pathName: "PM", levels: { "1": true, "2": true, "3": true, "4": true, "5": true }, pathDone: false })],
      path, "2026-05-01T00:00:00.000Z",
    );
    snapshotProgress(
      [member({ email: "g@x.com", firstName: "Grace", lastName: "G", pathName: "PM", levels: { "1": true, "2": true, "3": true, "4": true, "5": true }, pathDone: true })],
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getProgressDiff(path)!;
    assert.deepStrictEqual(diff.changes[0].gained, ["Path Completion"]);
  } finally { cleanup(); }
});

// ── Membership snapshot & diff ────────────────────────────────────────────────

console.log("\nMembership snapshots");

check("single snapshot returns null diff", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotMembership(
      membershipCsv([{ name: "Alice A", email: "a@x.com", status: "Active" }]),
      path, "2026-05-01T00:00:00.000Z",
    );
    assert.strictEqual(getMembershipDiff(path), null);
  } finally { cleanup(); }
});

check("no changes between identical snapshots", () => {
  const { path, cleanup } = tempDb();
  try {
    const csv = membershipCsv([{ name: "Alice A", email: "a@x.com", status: "Active" }]);
    snapshotMembership(csv, path, "2026-05-01T00:00:00.000Z");
    snapshotMembership(csv, path, "2026-06-01T00:00:00.000Z");
    const diff = getMembershipDiff(path)!;
    assert.strictEqual(diff.joined.length, 0);
    assert.strictEqual(diff.left.length, 0);
    assert.strictEqual(diff.statusChanged.length, 0);
  } finally { cleanup(); }
});

check("detects new member (joined)", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotMembership(
      membershipCsv([{ name: "Alice A", email: "a@x.com", status: "Active" }]),
      path, "2026-05-01T00:00:00.000Z",
    );
    snapshotMembership(
      membershipCsv([
        { name: "Alice A", email: "a@x.com", status: "Active" },
        { name: "Bob B",   email: "b@x.com", status: "Active" },
      ]),
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getMembershipDiff(path)!;
    assert.strictEqual(diff.joined.length, 1);
    assert.strictEqual(diff.joined[0].name, "Bob B");
  } finally { cleanup(); }
});

check("detects member who left", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotMembership(
      membershipCsv([
        { name: "Alice A", email: "a@x.com", status: "Active" },
        { name: "Bob B",   email: "b@x.com", status: "Active" },
      ]),
      path, "2026-05-01T00:00:00.000Z",
    );
    snapshotMembership(
      membershipCsv([{ name: "Alice A", email: "a@x.com", status: "Active" }]),
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getMembershipDiff(path)!;
    assert.strictEqual(diff.left.length, 1);
    assert.strictEqual(diff.left[0].name, "Bob B");
  } finally { cleanup(); }
});

check("detects status change (went unpaid)", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotMembership(
      membershipCsv([{ name: "Carol C", email: "c@x.com", status: "Active" }]),
      path, "2026-05-01T00:00:00.000Z",
    );
    snapshotMembership(
      membershipCsv([{ name: "Carol C", email: "c@x.com", status: "UnpaidMember" }]),
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getMembershipDiff(path)!;
    assert.strictEqual(diff.statusChanged.length, 1);
    assert.strictEqual(diff.statusChanged[0].oldStatus, "Active");
    assert.strictEqual(diff.statusChanged[0].newStatus, "UnpaidMember");
  } finally { cleanup(); }
});

check("email matching is case-insensitive", () => {
  const { path, cleanup } = tempDb();
  try {
    snapshotMembership(
      membershipCsv([{ name: "Dave D", email: "Dave@X.COM", status: "Active" }]),
      path, "2026-05-01T00:00:00.000Z",
    );
    snapshotMembership(
      membershipCsv([{ name: "Dave D", email: "dave@x.com", status: "Active" }]),
      path, "2026-06-01T00:00:00.000Z",
    );
    const diff = getMembershipDiff(path)!;
    // Same person, different casing — should be no changes
    assert.strictEqual(diff.joined.length, 0);
    assert.strictEqual(diff.left.length, 0);
  } finally { cleanup(); }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
