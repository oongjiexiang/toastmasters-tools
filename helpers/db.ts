import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { RESULTS_DIR } from "../config";
import { DetailResponse, MemberProgress } from "../types";
import { isOverviewLesson } from "./pathway";

export const DEFAULT_DB_PATH = resolve(process.cwd(), RESULTS_DIR, "db.sqlite");

function openDb(dbPath: string): Database.Database {
  mkdirSync(resolve(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at  TEXT    NOT NULL,
      email        TEXT    NOT NULL,
      first_name   TEXT    NOT NULL,
      last_name    TEXT    NOT NULL,
      path_name    TEXT    NOT NULL,
      level_1      INTEGER NOT NULL DEFAULT 0,
      level_2      INTEGER NOT NULL DEFAULT 0,
      level_3      INTEGER NOT NULL DEFAULT 0,
      level_4      INTEGER NOT NULL DEFAULT 0,
      level_5      INTEGER NOT NULL DEFAULT 0,
      path_done    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS membership_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at  TEXT    NOT NULL,
      email        TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      status       TEXT    NOT NULL,
      credentials  TEXT    NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS project_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      email       TEXT NOT NULL,
      path_name   TEXT NOT NULL,
      level       TEXT NOT NULL,
      lesson      TEXT NOT NULL,
      complete    INTEGER NOT NULL,
      type        TEXT NOT NULL
    );
  `);
  return db;
}

export function snapshotProgress(
  members: MemberProgress[],
  dbPath = DEFAULT_DB_PATH,
  capturedAt = new Date().toISOString(),
): void {
  const db = openDb(dbPath);

  const insert = db.prepare(`
    INSERT INTO progress_snapshots
      (captured_at, email, first_name, last_name, path_name,
       level_1, level_2, level_3, level_4, level_5, path_done)
    VALUES
      (@capturedAt, @email, @firstName, @lastName, @pathName,
       @l1, @l2, @l3, @l4, @l5, @pd)
  `);

  db.transaction(() => {
    for (const m of members) {
      const p = m.progression;
      const pc = p["Path Completion"];
      insert.run({
        capturedAt,
        email: m.user.email.toLowerCase().trim(),
        firstName: m.user.first_name,
        lastName: m.user.last_name,
        pathName: m.path_name,
        l1: p["Level 1"]?.approved ? 1 : 0,
        l2: p["Level 2"]?.approved ? 1 : 0,
        l3: p["Level 3"]?.approved ? 1 : 0,
        l4: p["Level 4"]?.approved ? 1 : 0,
        l5: p["Level 5"]?.approved ? 1 : 0,
        pd: pc && pc.total > 0 && pc.completed >= pc.total ? 1 : 0,
      });
    }
  })();

  console.log(`  DB snapshot: ${members.length} progress rows (${capturedAt})`);
  db.close();
}

export function snapshotMembership(
  csvString: string,
  dbPath = DEFAULT_DB_PATH,
  capturedAt = new Date().toISOString(),
): void {
  const db = openDb(dbPath);

  const rows = parse(csvString, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const insert = db.prepare(`
    INSERT INTO membership_snapshots (captured_at, email, name, status, credentials)
    VALUES (@capturedAt, @email, @name, @status, @credentials)
  `);

  db.transaction(() => {
    for (const m of rows) {
      const email = m["Email"]?.toLowerCase().trim();
      if (!email) continue;
      insert.run({
        capturedAt,
        email,
        name: m["Name"] ?? "",
        status: m["Status (*)"] ?? "",
        credentials: m["Credentials"] ?? "",
      });
    }
  })();

  console.log(`  DB snapshot: ${rows.length} membership rows (${capturedAt})`);
  db.close();
}

export function snapshotProjects(
  entries: Array<{ member: MemberProgress; detail: DetailResponse }>,
  dbPath = DEFAULT_DB_PATH,
  capturedAt = new Date().toISOString(),
): void {
  const db = openDb(dbPath);

  const insert = db.prepare(`
    INSERT INTO project_snapshots
      (captured_at, email, path_name, level, lesson, complete, type)
    VALUES
      (@capturedAt, @email, @pathName, @level, @lesson, @complete, @type)
  `);

  let count = 0;
  db.transaction(() => {
    for (const { member, detail } of entries) {
      const email = member.user.email.toLowerCase().trim();
      for (const chapter of detail.blocks.children) {
        for (const lesson of chapter.children) {
          if (isOverviewLesson(lesson.display_name)) continue;
          insert.run({
            capturedAt,
            email,
            pathName: member.path_name,
            level: chapter.display_name,
            lesson: lesson.display_name,
            complete: lesson.complete ? 1 : 0,
            type: lesson.block_lib_type === "elective" ? "Elective" : "Core",
          });
          count++;
        }
      }
    }
  })();

  console.log(`  DB snapshot: ${count} project rows (${capturedAt})`);
  db.close();
}

export function getLatestProjects(
  email: string,
  pathName: string,
  dbPath = DEFAULT_DB_PATH,
): ProjectSnapshot[] {
  if (!existsSync(dbPath)) return [];
  const db = openDb(dbPath);

  const latestRow = db.prepare(`
    SELECT captured_at FROM project_snapshots
    WHERE email = ? AND path_name = ?
    ORDER BY captured_at DESC LIMIT 1
  `).get(email, pathName) as { captured_at: string } | undefined;

  if (!latestRow) {
    db.close();
    return [];
  }

  type RawRow = {
    email: string;
    path_name: string;
    level: string;
    lesson: string;
    complete: number;
    type: string;
  };

  const rows = db.prepare(`
    SELECT email, path_name, level, lesson, complete, type
    FROM project_snapshots WHERE captured_at = ? AND email = ? AND path_name = ?
  `).all(latestRow.captured_at, email, pathName) as RawRow[];

  db.close();

  return rows.map(r => ({
    email: r.email,
    pathName: r.path_name,
    level: r.level,
    lesson: r.lesson,
    complete: r.complete === 1,
    type: r.type,
  }));
}

// ── Diff types ────────────────────────────────────────────────────────────────

export interface ProgressChange {
  email: string;
  firstName: string;
  lastName: string;
  pathName: string;
  gained: string[];
}

export interface ProgressDiff {
  older: string;
  newer: string;
  changes: ProgressChange[];
}

export interface MembershipRow {
  email: string;
  name: string;
  status: string;
}

export interface StatusChange {
  email: string;
  name: string;
  oldStatus: string;
  newStatus: string;
}

export interface MembershipDiff {
  older: string;
  newer: string;
  joined: MembershipRow[];
  left: MembershipRow[];
  statusChanged: StatusChange[];
}

// ── Diff queries ──────────────────────────────────────────────────────────────

function twoLatestDates(db: Database.Database, table: string): [string, string] | null {
  const rows = db.prepare(
    `SELECT DISTINCT captured_at FROM ${table} ORDER BY captured_at DESC LIMIT 2`
  ).all() as { captured_at: string }[];
  if (rows.length < 2) return null;
  return [rows[1].captured_at, rows[0].captured_at]; // [older, newer]
}

export function getProgressDiff(dbPath = DEFAULT_DB_PATH): ProgressDiff | null {
  const db = openDb(dbPath);
  const dates = twoLatestDates(db, "progress_snapshots");

  if (!dates) {
    db.close();
    return null;
  }

  const [older, newer] = dates;

  type RawRow = {
    email: string; first_name: string; last_name: string; path_name: string;
    ol1: number; nl1: number; ol2: number; nl2: number;
    ol3: number; nl3: number; ol4: number; nl4: number;
    ol5: number; nl5: number; opd: number; npd: number;
  };

  const rows = db.prepare(`
    SELECT
      n.email, n.first_name, n.last_name, n.path_name,
      o.level_1 AS ol1, n.level_1 AS nl1,
      o.level_2 AS ol2, n.level_2 AS nl2,
      o.level_3 AS ol3, n.level_3 AS nl3,
      o.level_4 AS ol4, n.level_4 AS nl4,
      o.level_5 AS ol5, n.level_5 AS nl5,
      o.path_done AS opd, n.path_done AS npd
    FROM progress_snapshots n
    JOIN progress_snapshots o ON n.email = o.email AND n.path_name = o.path_name
    WHERE n.captured_at = ? AND o.captured_at = ?
      AND (n.level_1 != o.level_1 OR n.level_2 != o.level_2 OR n.level_3 != o.level_3
        OR n.level_4 != o.level_4 OR n.level_5 != o.level_5 OR n.path_done != o.path_done)
    ORDER BY n.last_name, n.first_name
  `).all(newer, older) as RawRow[];

  db.close();

  const changes: ProgressChange[] = rows.map(r => {
    const gained: string[] = [];
    if (!r.ol1 && r.nl1) gained.push("Level 1");
    if (!r.ol2 && r.nl2) gained.push("Level 2");
    if (!r.ol3 && r.nl3) gained.push("Level 3");
    if (!r.ol4 && r.nl4) gained.push("Level 4");
    if (!r.ol5 && r.nl5) gained.push("Level 5");
    if (!r.opd && r.npd) gained.push("Path Completion");
    return { email: r.email, firstName: r.first_name, lastName: r.last_name, pathName: r.path_name, gained };
  });

  return { older, newer, changes };
}

export function getMembershipDiff(dbPath = DEFAULT_DB_PATH): MembershipDiff | null {
  const db = openDb(dbPath);
  const dates = twoLatestDates(db, "membership_snapshots");

  if (!dates) {
    db.close();
    return null;
  }

  const [older, newer] = dates;

  const joined = db.prepare(`
    SELECT n.email, n.name, n.status FROM membership_snapshots n
    WHERE n.captured_at = ?
      AND NOT EXISTS (SELECT 1 FROM membership_snapshots o WHERE o.email = n.email AND o.captured_at = ?)
    ORDER BY n.name
  `).all(newer, older) as MembershipRow[];

  const left = db.prepare(`
    SELECT o.email, o.name, o.status FROM membership_snapshots o
    WHERE o.captured_at = ?
      AND NOT EXISTS (SELECT 1 FROM membership_snapshots n WHERE n.email = o.email AND n.captured_at = ?)
    ORDER BY o.name
  `).all(older, newer) as MembershipRow[];

  const statusChangedRaw = db.prepare(`
    SELECT n.email, n.name, o.status AS old_status, n.status AS new_status
    FROM membership_snapshots n
    JOIN membership_snapshots o ON n.email = o.email
    WHERE n.captured_at = ? AND o.captured_at = ? AND n.status != o.status
    ORDER BY n.name
  `).all(newer, older) as Array<{ email: string; name: string; old_status: string; new_status: string }>;

  db.close();

  return {
    older,
    newer,
    joined,
    left,
    statusChanged: statusChangedRaw.map(r => ({
      email: r.email, name: r.name, oldStatus: r.old_status, newStatus: r.new_status,
    })),
  };
}

// ── Latest-snapshot queries (used by services/ui.ts) ─────────────────────────

export interface ProgressSnapshot {
  email: string;
  firstName: string;
  lastName: string;
  pathName: string;
  level1: boolean;
  level2: boolean;
  level3: boolean;
  level4: boolean;
  level5: boolean;
  pathDone: boolean;
}

export interface MembershipSnapshotRow {
  email: string;
  name: string;
  status: string;
  credentials: string;
}

export interface ProjectSnapshot {
  email: string;
  pathName: string;
  level: string;
  lesson: string;
  complete: boolean;
  type: string;
}

export function getLatestProgress(dbPath = DEFAULT_DB_PATH): ProgressSnapshot[] | null {
  if (!existsSync(dbPath)) return null;
  const db = openDb(dbPath);

  const latest = db.prepare(
    "SELECT captured_at FROM progress_snapshots ORDER BY captured_at DESC LIMIT 1"
  ).get() as { captured_at: string } | undefined;

  if (!latest) { db.close(); return null; }

  type RawRow = {
    email: string; first_name: string; last_name: string; path_name: string;
    level_1: number; level_2: number; level_3: number; level_4: number; level_5: number; path_done: number;
  };

  const rows = db.prepare(`
    SELECT email, first_name, last_name, path_name,
           level_1, level_2, level_3, level_4, level_5, path_done
    FROM progress_snapshots WHERE captured_at = ?
  `).all(latest.captured_at) as RawRow[];

  db.close();

  return rows.map(r => ({
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    pathName: r.path_name,
    level1: r.level_1 === 1,
    level2: r.level_2 === 1,
    level3: r.level_3 === 1,
    level4: r.level_4 === 1,
    level5: r.level_5 === 1,
    pathDone: r.path_done === 1,
  }));
}

export function getLatestMembership(dbPath = DEFAULT_DB_PATH): MembershipSnapshotRow[] | null {
  if (!existsSync(dbPath)) return null;
  const db = openDb(dbPath);

  const latest = db.prepare(
    "SELECT captured_at FROM membership_snapshots ORDER BY captured_at DESC LIMIT 1"
  ).get() as { captured_at: string } | undefined;

  if (!latest) { db.close(); return null; }

  const rows = db.prepare(
    "SELECT email, name, status, credentials FROM membership_snapshots WHERE captured_at = ?"
  ).all(latest.captured_at) as MembershipSnapshotRow[];

  db.close();
  return rows;
}
