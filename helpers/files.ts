import { readdirSync } from "fs";
import { join } from "path";

/**
 * Returns the path to the most recent membership-YYYY-MM-DD.csv file in dir.
 */
export function findLatestMembershipFile(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => /^membership-\d{4}-\d{2}-\d{2}\.csv$/.test(f))
    .sort() // lexicographic sort works fine for YYYY-MM-DD
    .reverse();

  if (files.length === 0) {
    throw new Error(`No membership-YYYY-MM-DD.csv file found in: ${dir}`);
  }

  return join(dir, files[0]);
}
