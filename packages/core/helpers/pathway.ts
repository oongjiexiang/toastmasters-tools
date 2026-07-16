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

export const STANDARD_LEVELS = ["Level 1", "Level 2", "Level 3", "Level 4", "Level 5"] as const;

/**
 * Returns true when the given level is considered completed/approved for this
 * progress row.
 *
 * For Level 1–5: the "Level N Approved" column must equal "true".
 * For "Path Completion": Completed >= Total (and Total > 0).
 */
export function isLevelDone(prog: Record<string, string>, level: string): boolean {
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

export function nextLevelFromFlags(p: {
  level1: boolean;
  level2: boolean;
  level3: boolean;
  level4: boolean;
  level5: boolean;
  pathDone: boolean;
}): string {
  if (!p.level1) return "Level 1";
  if (!p.level2) return "Level 2";
  if (!p.level3) return "Level 3";
  if (!p.level4) return "Level 4";
  if (!p.level5) return "Level 5";
  if (!p.pathDone) return "Path Completion";
  return "Completed";
}

export function titleFromFlags(
  p: { level1: boolean; level2: boolean; level3: boolean; level4: boolean; level5: boolean },
  pathName: string,
  credentials: string,
): string {
  if (/\bDTM\b/.test(credentials)) return "DTM";
  const init = pathwayInitials(pathName);
  if (p.level5) return init + "5";
  if (p.level4) return init + "4";
  if (p.level3) return init + "3";
  if (p.level2) return init + "2";
  if (p.level1) return init + "1";
  return "";
}
