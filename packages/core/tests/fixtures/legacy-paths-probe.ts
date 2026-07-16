/**
 * NEGATIVE CONTROL — do not "fix" this file.
 *
 * Reproduces the pre-fix (Phase 10) resolution that the regression suite exists to
 * reject: every anchor derived from `process.cwd()`, with a *relative* RESULTS_DIR.
 * Under npm workspaces the cwd is the workspace directory, so this yields
 * <repo>/packages/core/results/db.sqlite for the CLI and <repo>/apps/desktop/
 * results/db.sqlite for the desktop app — two different databases, and neither
 * is the user's.
 *
 * tests/paths.test.ts feeds this probe's output through the *same* assertion helper
 * used for the real implementation and requires it to throw. If someone ever
 * weakens those assertions into something that cannot fail, the negative control
 * test goes red and says so.
 *
 * Prints the same JSON shape as paths-probe.ts. Resolves strings only; creates nothing.
 */

import { resolve } from "path";

// The exact expressions that shipped before packages/core/paths.ts existed:
//   config.ts:   export const RESULTS_DIR = "results";
//   helpers/db.ts: const DEFAULT_DB_PATH = resolve(process.cwd(), "results", "db.sqlite");
const RESULTS_DIR = "results";
const REPO_ROOT = process.cwd();
const ENV_FILE = resolve(process.cwd(), ".env");
const DATA_DIR = resolve(process.cwd(), RESULTS_DIR);
const DEFAULT_DB_PATH = resolve(process.cwd(), RESULTS_DIR, "db.sqlite");

process.stdout.write(
  JSON.stringify({
    cwd: process.cwd(),
    REPO_ROOT,
    ENV_FILE,
    DATA_DIR,
    RESULTS_DIR,
    DEFAULT_DB_PATH,
    declaredEnvKeys: [],
    loadedEnvKeys: [],
  }),
);
