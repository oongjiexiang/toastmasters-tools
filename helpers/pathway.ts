/**
 * Returns the uppercase initials of a pathway name, ignoring parenthesised
 * suffixes.  e.g. "Dynamic Leadership (Simplified Chinese)" → "DL"
 */
export function pathwayInitials(name: string): string {
  const clean = name.replace(/\s*\([^)]*\)/g, "").trim();
  return clean
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export const STANDARD_LEVELS = [
  "Level 1",
  "Level 2",
  "Level 3",
  "Level 4",
  "Level 5",
] as const;

/**
 * Returns true when the given level is considered completed/approved for this
 * progress row.
 *
 * For Level 1–5: the "Level N Approved" column must equal "true".
 * For "Path Completion": Completed >= Total (and Total > 0).
 */
export function isLevelDone(
  prog: Record<string, string>,
  level: string
): boolean {
  if (level === "Path Completion") {
    const completed = parseInt(prog["Path Completion Completed"] ?? "0", 10);
    const total = parseInt(prog["Path Completion Total"] ?? "0", 10);
    return total > 0 && completed >= total;
  }
  const val = prog[`${level} Approved`];
  return val === "true" || val === "1";
}

/** Returns the first level the member still needs to complete, or "Completed". */
export function nextLevelToComplete(prog: Record<string, string>): string {
  for (const level of STANDARD_LEVELS) {
    if (!isLevelDone(prog, level)) return level;
  }
  if (!isLevelDone(prog, "Path Completion")) return "Path Completion";
  return "Completed";
}

/**
 * Returns true for level-overview lesson entries that are administrative
 * containers rather than actual speech projects:
 *   - "Level N: <description>" header entries
 *   - "Path Introduction" summary entry
 */
export function isOverviewLesson(lesson: string): boolean {
  if (/^Level \d+:/.test(lesson)) return true;
  if (lesson === "Path Introduction") return true;
  return false;
}
