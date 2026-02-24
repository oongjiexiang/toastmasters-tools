/**
 * Toastmasters Member Status Analyzer
 *
 * Reads progress.csv, details.csv, and the latest membership-*.csv from the
 * results folder, then produces results/summary.csv with one row per member
 * per pathway.
 *
 * Columns: Name, Title, Pathways, Next Level to Complete, Next Project,
 *          Remaining Projects
 *
 * Usage:
 *   npm run analyze
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { escapeCsvField, parseCSV, csvToObjects } from "../helpers/csv";
import { findLatestMembershipFile } from "../helpers/files";
import {
  isOverviewLesson,
  nextLevelToComplete,
  pathwayInitials,
} from "../helpers/pathway";
import { RESULTS_DIR } from "../config";

// ─── Main ─────────────────────────────────────────────────────────────────────

interface OutputRow {
  name: string;
  title: string;
  pathways: string;
  nextLevel: string;
  nextProject: string;
  remaining: string;
}

function main(): void {
  const resultsDir = resolve(process.cwd(), RESULTS_DIR);
  const membershipPath = findLatestMembershipFile(resultsDir);
  console.log(`Using membership file: ${membershipPath}`);

  // ── Load CSVs ──────────────────────────────────────────────────────────────
  const membershipRows = csvToObjects(
    parseCSV(readFileSync(membershipPath, "utf-8"))
  );
  const progressRows = csvToObjects(
    parseCSV(readFileSync(join(resultsDir, "progress.csv"), "utf-8"))
  );
  const detailRows = csvToObjects(
    parseCSV(readFileSync(join(resultsDir, "details.csv"), "utf-8"))
  );

  // ── Build lookup: email → membership row ──────────────────────────────────
  const membershipByEmail = new Map<string, Record<string, string>>();
  for (const m of membershipRows) {
    const email = m["Email"]?.toLowerCase().trim();
    if (email) membershipByEmail.set(email, m);
  }

  // ── Build reverse map: pathway initials → full pathway name ─────────────
  // Used to decode membership-only credentials like "PM2" → "Presentation Mastery"
  const initialsToPathway = new Map<string, string>();
  for (const prog of progressRows) {
    const pathName = prog["Path Name"];
    if (pathName) {
      const initials = pathwayInitials(pathName);
      if (!initialsToPathway.has(initials)) initialsToPathway.set(initials, pathName);
    }
  }

  // ── Build detail lookup: "userName|||pathName|||level" → incomplete lessons
  // A level that is already approved in progress.csv is not needed — the rule
  // is enforced by only querying the *next* (non-approved) level.
  type DetailKey = string;
  const incompleteByKey = new Map<DetailKey, string[]>();

  for (const row of detailRows) {
    if (row["Complete"] !== "No") continue;
    if (isOverviewLesson(row["Lesson"])) continue;

    const key = `${row["User Name"]}|||${row["Path Name"]}|||${row["Level"]}`;
    if (!incompleteByKey.has(key)) incompleteByKey.set(key, []);
    incompleteByKey.get(key)!.push(row["Lesson"]);
  }

  // ── Generate output rows ──────────────────────────────────────────────────
  const outputRows: OutputRow[] = [];
  const processedEmails = new Set<string>();

  for (const prog of progressRows) {
    const email = prog["Email"]?.toLowerCase().trim();
    const firstName = prog["First Name"];
    const lastName = prog["Last Name"];
    const name = `${firstName} ${lastName}`;
    const pathName = prog["Path Name"];

    if (email) processedEmails.add(email);

    const mem = email ? membershipByEmail.get(email) : undefined;

    // Skip unpaid members (still mark their email as processed so they don't
    // re-appear in the membership-only loop either)
    if (mem?.["Status (*)"] === "UnpaidMember") continue;

    // ── Title ──────────────────────────────────────────────────────────────
    let title = "";
    if (mem && /\bDTM\b/.test(mem["Credentials"] ?? "")) {
      title = "DTM";
    } else {
      // Find highest approved level in this pathway row
      for (let n = 5; n >= 1; n--) {
        if (prog[`Level ${n} Approved`] === "true") {
          title = pathwayInitials(pathName) + n;
          break;
        }
      }
      // blank if no level approved yet
    }

    // ── Next level ─────────────────────────────────────────────────────────
    const nextLevel = nextLevelToComplete(prog);

    // ── Next project & remaining count ────────────────────────────────────
    let nextProject = "";
    let remaining = "";

    if (nextLevel !== "Completed") {
      const key = `${name}|||${pathName}|||${nextLevel}`;
      const lessons = incompleteByKey.get(key) ?? [];
      remaining = String(lessons.length);
      nextProject = lessons[0] ?? "";
    }

    outputRows.push({
      name,
      title,
      pathways: pathName,
      nextLevel,
      nextProject,
      remaining,
    });
  }

  // ── Add membership-only users (not in Basecamp) ───────────────────────────
  for (const mem of membershipRows) {
    const email = mem["Email"]?.toLowerCase().trim();
    if (!email || processedEmails.has(email)) continue;
    if (mem["Status (*)"] === "UnpaidMember") continue;

    const name = mem["Name"];
    const cred = mem["Credentials"]?.trim() ?? "";

    let title = "";
    let pathways = "";
    let nextLevel = "";

    if (/\bDTM\b/.test(cred)) {
      title = "DTM";
    } else {
      // Match credentials that are exactly initials+digit, e.g. "PM2", "PI4", "DL5"
      const match = cred.match(/^([A-Za-z]{2,})(\d)$/);
      if (match) {
        const initials = match[1].toUpperCase();
        const level = parseInt(match[2], 10);
        const pathName = initialsToPathway.get(initials);
        if (pathName) {
          title = initials + level;
          pathways = pathName;
          nextLevel = level < 5 ? `Level ${level + 1}` : "Path Completion";
        }
      }
    }

    outputRows.push({
      name,
      title,
      pathways,
      nextLevel,
      nextProject: "",
      remaining: "",
    });
  }

  // ── Write summary CSV ─────────────────────────────────────────────────────
  outputRows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const header = [
    "Name",
    "Title",
    "Pathways",
    "Next Level to Complete",
    "Next Project",
    "Remaining Projects",
  ].join(",");

  const lines = [
    header,
    ...outputRows.map((r) =>
      [
        escapeCsvField(r.name),
        escapeCsvField(r.title),
        escapeCsvField(r.pathways),
        escapeCsvField(r.nextLevel),
        escapeCsvField(r.nextProject),
        escapeCsvField(r.remaining),
      ].join(",")
    ),
  ];

  const outputPath = join(resultsDir, "summary.csv");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(outputPath, lines.join("\n"), "utf-8");

  console.log(
    `\nSummary CSV saved to: ${outputPath} (${outputRows.length} rows)`
  );
}

main();
