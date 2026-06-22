import { createServer } from "http";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, resolve } from "path";
import { parse } from "csv-parse/sync";
import { findLatestMembershipFile } from "../helpers/files";
import { pathwayInitials, nextLevelToComplete, isOverviewLesson, isLevelDone } from "../helpers/pathway";
import {
  DEFAULT_DB_PATH,
  getLatestProgress,
  getLatestMembership,
  ProgressSnapshot,
} from "../helpers/db";
import { RESULTS_DIR } from "../config";

const PORT = 3000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SummaryRow {
  name: string;
  title: string;
  pathway: string;
  nextLevel: string;
  remaining: number;
}

interface ProjectRow {
  lesson: string;
  complete: boolean;
  type: string;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

const PARSE_OPTS = { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true } as const;

function parseCsv(filePath: string): Record<string, string>[] {
  return parse(readFileSync(filePath, "utf-8"), PARSE_OPTS);
}

// ── Incomplete-project index (shared by both data paths) ──────────────────────

function buildIncompleteIndex(resultsDir: string): Map<string, string[]> {
  const detailsPath = join(resultsDir, "details.csv");
  const idx = new Map<string, string[]>();
  if (!existsSync(detailsPath)) return idx;

  for (const row of parseCsv(detailsPath)) {
    if (row["Complete"] !== "No") continue;
    if (isOverviewLesson(row["Lesson"])) continue;
    const key = `${row["User Name"]}|||${row["Path Name"]}|||${row["Level"]}`;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key)!.push(row["Lesson"]);
  }
  return idx;
}

// ── Data loading: SQLite path ─────────────────────────────────────────────────

function nextLevelFromFlags(p: ProgressSnapshot): string {
  if (!p.level1) return "Level 1";
  if (!p.level2) return "Level 2";
  if (!p.level3) return "Level 3";
  if (!p.level4) return "Level 4";
  if (!p.level5) return "Level 5";
  if (!p.pathDone) return "Path Completion";
  return "Completed";
}

function titleFromFlags(p: ProgressSnapshot, credentials: string): string {
  if (/\bDTM\b/.test(credentials)) return "DTM";
  const init = pathwayInitials(p.pathName);
  if (p.level5) return init + "5";
  if (p.level4) return init + "4";
  if (p.level3) return init + "3";
  if (p.level2) return init + "2";
  if (p.level1) return init + "1";
  return "";
}

function loadFromDb(resultsDir: string): SummaryRow[] | null {
  try {
    const progress = getLatestProgress();
    const membership = getLatestMembership();
    if (!progress || !membership) return null;

    const memByEmail = new Map(membership.map(m => [m.email, m]));
    const incomplete = buildIncompleteIndex(resultsDir);
    const rows: SummaryRow[] = [];

    for (const p of progress) {
      const mem = memByEmail.get(p.email);
      if (mem?.status === "UnpaidMember") continue;

      const name = `${p.firstName} ${p.lastName}`;
      const title = titleFromFlags(p, mem?.credentials ?? "");
      const nextLevel = nextLevelFromFlags(p);

      let remaining = 0;
      if (nextLevel !== "Completed" && nextLevel !== "Path Completion") {
        remaining = incomplete.get(`${name}|||${p.pathName}|||${nextLevel}`)?.length ?? 0;
      }

      rows.push({ name, title, pathway: p.pathName, nextLevel, remaining });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch {
    return null;
  }
}

// ── Data loading: CSV fallback ────────────────────────────────────────────────

function loadFromCsvs(resultsDir: string): SummaryRow[] | null {
  const progressPath = join(resultsDir, "progress.csv");
  if (!existsSync(progressPath)) return null;

  const progressRows = parseCsv(progressPath);
  const incomplete = buildIncompleteIndex(resultsDir);
  const membershipByEmail = new Map<string, Record<string, string>>();

  try {
    for (const m of parseCsv(findLatestMembershipFile(resultsDir))) {
      const email = m["Email"]?.toLowerCase().trim();
      if (email) membershipByEmail.set(email, m);
    }
  } catch { /* no membership file */ }

  const rows: SummaryRow[] = [];

  for (const prog of progressRows) {
    const email = prog["Email"]?.toLowerCase().trim() ?? "";
    const name = `${prog["First Name"]} ${prog["Last Name"]}`;
    const pathName = prog["Path Name"];
    const mem = membershipByEmail.get(email);

    if (mem?.["Status (*)"] === "UnpaidMember") continue;

    let title = "";
    if (mem && /\bDTM\b/.test(mem["Credentials"] ?? "")) {
      title = "DTM";
    } else {
      for (let n = 5; n >= 1; n--) {
        if (isLevelDone(prog, `Level ${n}`)) { title = pathwayInitials(pathName) + n; break; }
      }
    }

    const nextLevel = nextLevelToComplete(prog);
    let remaining = 0;
    if (nextLevel !== "Completed" && nextLevel !== "Path Completion") {
      remaining = incomplete.get(`${name}|||${pathName}|||${nextLevel}`)?.length ?? 0;
    }

    rows.push({ name, title, pathway: pathName, nextLevel, remaining });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// ── Project detail loading ────────────────────────────────────────────────────

function loadDetail(resultsDir: string, name: string, pathway: string, level: string): ProjectRow[] {
  const detailsPath = join(resultsDir, "details.csv");
  if (!existsSync(detailsPath)) return [];

  return parseCsv(detailsPath)
    .filter(r =>
      r["User Name"] === name &&
      r["Path Name"] === pathway &&
      r["Level"] === level &&
      !isOverviewLesson(r["Lesson"])
    )
    .map(r => ({ lesson: r["Lesson"], complete: r["Complete"] === "Yes", type: r["Type"] ?? "" }));
}

// ── HTML rendering ────────────────────────────────────────────────────────────

const CSS = `
  body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#111}
  h1{font-size:1.35rem;margin-bottom:.2rem}
  .sub{color:#666;font-size:.875rem;margin-bottom:1.5rem}
  table{border-collapse:collapse;width:100%;font-size:.875rem}
  th{text-align:left;padding:.5rem .75rem;border-bottom:2px solid #ddd;white-space:nowrap}
  td{padding:.4rem .75rem;border-bottom:1px solid #eee;vertical-align:top}
  tr:hover td{background:#f7f7f7}
  a{color:#0070c0;text-decoration:none}
  a:hover{text-decoration:underline}
  .badge{display:inline-block;padding:.1em .45em;border-radius:3px;font-size:.8em;font-weight:600}
  .b-title{background:#dbeafe;color:#1e40af}
  .b-done{background:#dcfce7;color:#166534}
  .b-pend{background:#fee2e2;color:#991b1b}
  .ok{color:#16a34a}
  .empty{color:#888;font-style:italic;padding:2rem 0;text-align:center}
  .back{margin-bottom:1rem;font-size:.9rem}
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderDashboard(rows: SummaryRow[], fromDb: boolean): string {
  if (rows.length === 0) {
    return page("Toastmasters Dashboard",
      `<h1>Toastmasters Dashboard</h1><p class="empty">No data found. Run <code>npm run fetch</code> and <code>npm run membership</code> first.</p>`);
  }

  const source = fromDb ? "SQLite (latest snapshot)" : "CSV files";
  const tbody = rows.map(r => {
    const complete = r.nextLevel === "Completed";
    const href = `/member?name=${encodeURIComponent(r.name)}&path=${encodeURIComponent(r.pathway)}&level=${encodeURIComponent(r.nextLevel)}`;
    const nameCell = complete ? esc(r.name) : `<a href="${href}">${esc(r.name)}</a>`;
    const badge = r.title ? `<span class="badge b-title">${esc(r.title)}</span>` : "";
    const rem = complete
      ? `<span class="ok">✓ Completed</span>`
      : r.remaining > 0 ? String(r.remaining) : "—";
    return `<tr><td>${nameCell}</td><td>${badge}</td><td>${esc(r.pathway)}</td><td>${esc(r.nextLevel)}</td><td>${rem}</td></tr>`;
  }).join("");

  return page("Toastmasters Dashboard", `
    <h1>Toastmasters Dashboard</h1>
    <p class="sub">Source: ${source} &nbsp;·&nbsp; ${rows.length} members</p>
    <table>
      <thead><tr><th>Name</th><th>Title</th><th>Pathway</th><th>Next Level</th><th>Remaining</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>`);
}

function renderDetail(name: string, pathway: string, level: string, projects: ProjectRow[]): string {
  const back = `<p class="back"><a href="/">← Back to dashboard</a></p>`;
  const heading = `<h1>${esc(name)}</h1><p class="sub">${esc(pathway)} &nbsp;·&nbsp; ${esc(level)}</p>`;

  if (projects.length === 0) {
    return page(`${name} – ${level}`,
      back + heading + `<p class="empty">No project data found for this level. Run <code>npm run fetch</code> to refresh.</p>`);
  }

  const done = projects.filter(p => p.complete).length;
  const tbody = projects.map(p => {
    const badge = p.complete
      ? `<span class="badge b-done">Done</span>`
      : `<span class="badge b-pend">Pending</span>`;
    const elective = p.type === "Elective" ? ` <em style="color:#888;font-size:.85em">(elective)</em>` : "";
    return `<tr><td>${esc(p.lesson)}${elective}</td><td>${badge}</td></tr>`;
  }).join("");

  return page(`${name} – ${level}`, `
    ${back}${heading}
    <p class="sub">${done} of ${projects.length} complete</p>
    <table>
      <thead><tr><th>Project</th><th>Status</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>`);
}

// ── Server ────────────────────────────────────────────────────────────────────

export function main(): Promise<void> {
  const resultsDir = resolve(process.cwd(), RESULTS_DIR);

  return new Promise((_resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");

      if (url.pathname === "/") {
        const fromDb = loadFromDb(resultsDir);
        const rows = fromDb ?? loadFromCsvs(resultsDir) ?? [];
        res.end(renderDashboard(rows, fromDb !== null));
        return;
      }

      if (url.pathname === "/member") {
        const name  = url.searchParams.get("name")  ?? "";
        const path  = url.searchParams.get("path")  ?? "";
        const level = url.searchParams.get("level") ?? "";
        res.end(renderDetail(name, path, level, loadDetail(resultsDir, name, path, level)));
        return;
      }

      res.statusCode = 404;
      res.end(page("Not found", "<h1>404</h1><p>Page not found.</p>"));
    });

    server.on("error", reject);
    server.listen(PORT, () => {
      console.log(`\nDashboard running at http://localhost:${PORT}\n`);
      console.log("Press Ctrl+C to stop.\n");
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
