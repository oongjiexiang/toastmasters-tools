/**
 * Out-of-process probe for core's filesystem anchors.
 *
 * Spawned by tests/paths.test.ts with an explicit `cwd` (packages/core,
 * apps/desktop, or an unrelated directory). It imports core exactly as the CLI
 * and the desktop app do, then prints the resolved anchors as JSON on stdout.
 *
 * A subprocess is the only honest way to observe cwd-dependence: REPO_ROOT,
 * DATA_DIR and DEFAULT_DB_PATH are module-load-time constants, and vitest itself
 * always runs with cwd at the workspace root, so an in-process test could never
 * fail on the bug this guards against.
 *
 * READ-ONLY: importing these modules resolves paths but never opens or creates a
 * database, a directory, or any file.
 */

import { readFileSync } from "fs";
import { DATA_DIR, ENV_FILE, REPO_ROOT } from "../../paths";
import { RESULTS_DIR } from "../../config";
import { DEFAULT_DB_PATH } from "../../helpers/db";

/** Key names declared in the .env file core claims to load. Values are never read or printed. */
function declaredEnvKeys(): string[] {
  let contents: string;
  try {
    contents = readFileSync(ENV_FILE, "utf-8");
  } catch {
    return [];
  }
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
    .filter((key) => key.length > 0);
}

const declared = declaredEnvKeys();

process.stdout.write(
  JSON.stringify({
    cwd: process.cwd(),
    REPO_ROOT,
    ENV_FILE,
    DATA_DIR,
    RESULTS_DIR,
    DEFAULT_DB_PATH,
    declaredEnvKeys: declared,
    loadedEnvKeys: declared.filter((key) => key in process.env),
  }),
);
