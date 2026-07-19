/**
 * Read-model queries for the dashboard.
 *
 * This module holds the logic that used to live inside the Next.js API routes
 * (`apps/web/app/api/{members,members/[email],diff}/route.ts`, removed in
 * Phase 14). It is transport-agnostic on purpose: the now-removed web app
 * used to map the results onto HTTP responses, and the Electron main process
 * (Phase 11) maps the *same* results onto IPC replies. No consumer forks the
 * logic — see `specs/tech-stack.md`.
 *
 * Failures are returned, not thrown, as a discriminated union (`QueryResult`).
 * Each transport owns its own mapping:
 *
 *   SNAPSHOT_MISSING -> HTTP 503 / IPC error toast
 *   NOT_FOUND        -> HTTP 404 / IPC error toast
 *
 * Genuinely unexpected failures (a corrupt database, a filesystem error) still
 * throw, so the caller can map them to a 500 / generic error.
 *
 * Every function takes an optional `dbPath` that defaults to `DEFAULT_DB_PATH`,
 * mirroring the helpers in `helpers/db.ts` so tests can inject a fixture DB.
 */

import {
  getLatestMembership,
  getLatestProgress,
  getLatestProjects,
  getLatestSnapshotAt,
  getMembershipDiff,
  getProgressDiff,
  type MembershipDiff,
  type MembershipSnapshotRow,
  type ProgressDiff,
  type ProgressSnapshot,
} from "./helpers/db";
import {
  isOverviewLesson,
  nextLevelFromFlags,
  STANDARD_LEVELS,
  titleFromFlags,
} from "./helpers/pathway";

// ── Result envelope ───────────────────────────────────────────────────────────

export type QueryErrorCode = "SNAPSHOT_MISSING" | "NOT_FOUND";

export type QueryResult<T> =
  { ok: true; data: T } | { ok: false; code: QueryErrorCode; message: string };

const SNAPSHOT_MISSING = {
  ok: false,
  code: "SNAPSHOT_MISSING",
  message: "No data yet — use the Refresh buttons to load member data.",
} as const;

const NOT_FOUND = {
  ok: false,
  code: "NOT_FOUND",
  message: "Member not found.",
} as const;

// ── View models ───────────────────────────────────────────────────────────────

export interface PathwaySummary {
  pathway: string;
  title: string;
  nextLevel: string;
  remaining: number;
  status: "completed" | "ready" | "close" | "in-progress" | "not-started";
}

export interface MemberSummary {
  email: string;
  name: string;
  title: string;
  pathways: PathwaySummary[];
}

/**
 * `listMembers`'s success payload. Bundles the member rows with the latest
 * snapshot timestamp (across both the progress and membership tables) so the
 * dashboard header can render a freshness indicator without a second IPC
 * round-trip. `latestSnapshotAt` is `null` only on a fresh install that has
 * never captured any snapshot at all.
 */
export interface ListMembersResult {
  members: MemberSummary[];
  latestSnapshotAt: string | null;
}

export interface LevelGroup {
  level: string;
  approved: boolean;
  projectsDone: number;
  projectsTotal: number;
  projects: { lesson: string; complete: boolean; type: "Core" | "Elective" }[];
}

export interface MemberDetail {
  email: string;
  name: string;
  pathway: string;
  title: string;
  levels: LevelGroup[];
}

export interface DiffResult {
  progress: ProgressDiff;
  membership: MembershipDiff;
}

// ── Internal rules ────────────────────────────────────────────────────────────

function computeStatus(
  nextLevel: string,
  projectsDone: number,
  projectsTotal: number,
  remaining: number,
): PathwaySummary["status"] {
  if (nextLevel === "Completed") return "completed";
  if (projectsTotal > 0 && projectsDone === projectsTotal) return "ready";
  if (remaining === 1) return "close";
  if (projectsDone > 0) return "in-progress";
  return "not-started";
}

function pickOverallTitle(pathways: PathwaySummary[], credentials: string): string {
  if (/\bDTM\b/.test(credentials)) return "DTM";

  // Collect non-empty titles and pick the "highest" one.
  // Titles look like "PM3", "DL4", etc. — compare by the trailing digit.
  const nonEmpty = pathways.map((pw) => pw.title).filter((t) => t.length > 0);

  if (nonEmpty.length === 0) return "";

  // Sort descending by the numeric suffix (last character assumed to be digit or letter).
  nonEmpty.sort((a, b) => {
    const aNum = parseInt(a.slice(-1), 10);
    const bNum = parseInt(b.slice(-1), 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return bNum - aNum;
    return b.localeCompare(a);
  });

  return nonEmpty[0] ?? "";
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Every paid member, one row per member, with a summary per enrolled pathway. */
export function listMembers(dbPath?: string): QueryResult<ListMembersResult> {
  const progressRows = getLatestProgress(dbPath);
  const membershipRows = getLatestMembership(dbPath);

  // A fresh install with no snapshot in either table at all is not an error —
  // it's the "Never refreshed" state the header renders cleanly. Distinguish
  // it from the (rarer, still-an-error) case where only one of the two tables
  // has ever been populated, which stays SNAPSHOT_MISSING as before.
  if (progressRows === null && membershipRows === null) {
    return { ok: true, data: { members: [], latestSnapshotAt: null } };
  }

  if (progressRows === null || membershipRows === null) {
    return SNAPSHOT_MISSING;
  }

  const memByEmail = new Map<string, MembershipSnapshotRow>(
    membershipRows.map((m) => [m.email, m]),
  );

  // Group progress rows by email
  const byEmail = new Map<string, ProgressSnapshot[]>();
  for (const row of progressRows) {
    const list = byEmail.get(row.email) ?? [];
    list.push(row);
    byEmail.set(row.email, list);
  }

  const results: MemberSummary[] = [];

  for (const [email, rows] of byEmail) {
    const membership = memByEmail.get(email);

    // Build pathway summaries, skipping UnpaidMember pathways
    const pathways: PathwaySummary[] = [];

    for (const p of rows) {
      if (membership?.status === "UnpaidMember") continue;

      const nextLevel = nextLevelFromFlags(p);
      const perPathTitle = titleFromFlags(p, p.pathName, membership?.credentials ?? "");
      const projectRows = getLatestProjects(email, p.pathName, dbPath);

      let remaining = 0;
      let projectsDone = 0;
      let projectsTotal = 0;

      if (nextLevel !== "Completed" && nextLevel !== "Path Completion") {
        const levelProjects = projectRows.filter(
          (pr) => pr.level === nextLevel && !isOverviewLesson(pr.lesson),
        );
        projectsTotal = levelProjects.length;
        projectsDone = levelProjects.filter((pr) => pr.complete).length;
        remaining = levelProjects.filter((pr) => !pr.complete).length;
      }

      const status = computeStatus(nextLevel, projectsDone, projectsTotal, remaining);

      pathways.push({
        pathway: p.pathName,
        title: perPathTitle,
        nextLevel,
        remaining,
        status,
      });
    }

    // Skip members where ALL pathways were skipped (all UnpaidMember)
    if (pathways.length === 0) continue;

    // rows is always non-empty here: byEmail only gains an entry when at least
    // one progress row was grouped into it (see the loop above).
    const [firstRow] = rows;
    if (!firstRow) continue;
    const name = `${firstRow.firstName} ${firstRow.lastName}`;
    const overallTitle = pickOverallTitle(pathways, membership?.credentials ?? "");

    results.push({ email, name, title: overallTitle, pathways });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, data: { members: results, latestSnapshotAt: getLatestSnapshotAt(dbPath) } };
}

/** One member on one pathway, with every project grouped by level (1–5 + Path Completion). */
export function getMemberDetail(
  email: string,
  pathway: string,
  dbPath?: string,
): QueryResult<MemberDetail> {
  const progressRows = getLatestProgress(dbPath);
  if (progressRows === null) {
    return SNAPSHOT_MISSING;
  }

  const progressRow = progressRows.find((p) => p.email === email && p.pathName === pathway);
  if (!progressRow) {
    return NOT_FOUND;
  }

  const projectRows = getLatestProjects(email, pathway, dbPath);

  const membershipRows = getLatestMembership(dbPath);
  const membershipRow = membershipRows?.find((m) => m.email === email);

  const title = titleFromFlags(progressRow, pathway, membershipRow?.credentials ?? "");

  const allLevels = [...STANDARD_LEVELS, "Path Completion"] as string[];

  const levelApprovedMap: Record<string, boolean> = {
    "Level 1": progressRow.level1,
    "Level 2": progressRow.level2,
    "Level 3": progressRow.level3,
    "Level 4": progressRow.level4,
    "Level 5": progressRow.level5,
    "Path Completion": progressRow.pathDone,
  };

  const levels: LevelGroup[] = allLevels.map((level) => {
    const filtered = projectRows.filter((r) => r.level === level && !isOverviewLesson(r.lesson));
    const projectsDone = filtered.filter((r) => r.complete).length;
    const projectsTotal = filtered.length;
    const projects = filtered.map((r) => ({
      lesson: r.lesson,
      complete: r.complete,
      type: r.type as "Core" | "Elective",
    }));

    return {
      level,
      approved: levelApprovedMap[level] ?? false,
      projectsDone,
      projectsTotal,
      projects,
    };
  });

  const name = `${progressRow.firstName} ${progressRow.lastName}`;

  return { ok: true, data: { email, name, pathway, title, levels } };
}

/** What changed between the two most recent snapshots. */
export function getDiff(dbPath?: string): QueryResult<DiffResult> {
  const progress = getProgressDiff(dbPath);
  const membership = getMembershipDiff(dbPath);

  if (progress === null || membership === null) {
    return SNAPSHOT_MISSING;
  }

  return { ok: true, data: { progress, membership } };
}

// ── Exports ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<PathwaySummary["status"], string> = {
  completed: "Completed",
  ready: "Ready",
  close: "Close",
  "in-progress": "In Progress",
  "not-started": "Not Started",
};

const PROGRESS_REPORT_HEADER = [
  "Name",
  "Email",
  "Title",
  "Pathway",
  "Next Level",
  "Projects Remaining",
  "Status",
];

/**
 * RFC-4180 escaping (quote fields containing a comma, double-quote, or
 * newline), plus the standard OWASP CSV-injection mitigation: a leading
 * `=`, `+`, `-`, `@`, or tab is prefixed with a `'` so spreadsheet software
 * (Excel/Sheets/LibreOffice) renders the cell as text instead of evaluating
 * it as a formula. `name`/`title`/`pathway`/`nextLevel` are free-text fields
 * members can set on their own TI/Basecamp profile, so this is untrusted
 * input from the report reader's point of view. The trigger-character check
 * runs against the value with leading plain/non-breaking spaces stripped
 * (not the raw value) because Excel itself strips leading spaces before
 * deciding whether a cell is a formula — testing the untrimmed string would
 * let a leading-space payload like `" =cmd|'/c calc'!A1"` bypass the guard.
 * Only space characters are stripped for this check, not tab/CR: those are
 * themselves trigger characters, so stripping them first would erase the
 * very character the check is looking for.
 */
function csvField(value: string | number): string {
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str.replace(/^[ \u00A0]+/, ""))) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(",");
}

/**
 * Serializes the dashboard's derived member/pathway summary as a CSV report
 * (distinct from the raw TI membership-roster CSV). One row per
 * (member, pathway) — a member enrolled in two pathways yields two rows. A
 * member with an empty `pathways[]` contributes no rows; callers (currently
 * only `listMembers`, which already drops all-UnpaidMember members before
 * this ever sees them) are expected to filter out zero-pathway members
 * themselves rather than relying on this function to represent them.
 * Hand-rolled (no `csv-stringify` — dropped in Phase 10) and RFC-4180-escaped;
 * uses `\r\n` line endings for Excel. Prefixed with a UTF-8 BOM so Excel on
 * Windows (this app's primary platform) decodes non-ASCII names/pathways
 * (e.g. "José") as UTF-8 instead of silently mojibaking them via the system
 * ANSI code page.
 */
export function buildProgressReportCsv(members: MemberSummary[]): string {
  const lines = [csvRow(PROGRESS_REPORT_HEADER)];

  for (const member of members) {
    for (const pathway of member.pathways) {
      lines.push(
        csvRow([
          member.name,
          member.email,
          member.title,
          pathway.pathway,
          pathway.nextLevel,
          pathway.remaining,
          STATUS_LABELS[pathway.status],
        ]),
      );
    }
  }

  return "﻿" + lines.join("\r\n") + "\r\n";
}
