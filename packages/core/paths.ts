/**
 * Filesystem anchors for @toastmasters/core.
 *
 * Every path core touches (.env, the SQLite database, the membership CSVs) is
 * resolved from a *stable anchor*, never from `process.cwd()`. Under npm
 * workspaces the cwd is the workspace directory, not the repo root:
 *
 *   npm run fetch  -w @toastmasters/core  ->  cwd = <repo>/packages/core
 *   npm run dev    -w @toastmasters/web   ->  cwd = <repo>/apps/web
 *
 * Anchoring on cwd would give the CLI and the dashboard two different databases.
 *
 * Resolution order:
 *   REPO_ROOT — walk up from this module's own location (import.meta.url) until a
 *               package.json with a `workspaces` field is found. Falls back to
 *               walking up from cwd, then to this package's parent directory.
 *   DATA_DIR  — `TOASTMASTERS_DATA_DIR` if set (the Phase 11 / Electron hook,
 *               where cwd is arbitrary and data lives in app.getPath('userData')),
 *               otherwise <REPO_ROOT>/results.
 *
 * This module is the bootstrap: it loads the .env file as a side effect so that
 * any module importing it (config.ts, helpers/db.ts) observes a populated
 * `process.env`, including a `TOASTMASTERS_DATA_DIR` declared in .env itself.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";

/** True when `dir` holds a package.json declaring npm workspaces (i.e. the monorepo root). */
function isWorkspaceRoot(dir: string): boolean {
  const pkgPath = resolve(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { workspaces?: unknown };
    return pkg.workspaces !== undefined;
  } catch {
    return false;
  }
}

/** Walk up from `startDir` looking for the workspace root. Returns null if none is found. */
function findWorkspaceRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (isWorkspaceRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // hit the filesystem root
    dir = parent;
  }
}

/**
 * Directory of this module. Returns null in exotic bundler contexts where
 * `import.meta.url` is not a file:// URL — callers fall back to cwd.
 */
function thisModuleDir(): string | null {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

function resolveRepoRoot(): string {
  const moduleDir = thisModuleDir();

  // Primary: anchored on this file, so it is correct under any cwd.
  if (moduleDir) {
    const fromModule = findWorkspaceRoot(moduleDir);
    if (fromModule) return fromModule;
  }

  // Fallback: bundled contexts (e.g. Next's .next/server output) where the module
  // location may not sit under the source tree. Both `npm run dev` and `npm run
  // build` run with a cwd inside the repo, so walking up from cwd still lands here.
  const fromCwd = findWorkspaceRoot(process.cwd());
  if (fromCwd) return fromCwd;

  // Last resort: <repo>/packages/core -> <repo>. Better than silently using cwd.
  return moduleDir ? resolve(moduleDir, "..", "..") : process.cwd();
}

export const REPO_ROOT: string = resolveRepoRoot();

/** The single .env file for the whole monorepo. */
export const ENV_FILE: string = resolve(REPO_ROOT, ".env");

/**
 * Loads ENV_FILE into process.env (manual parse — no external dependency).
 * Existing environment variables always win, so a real env var overrides .env.
 */
export function loadEnvFile(envPath: string = ENV_FILE): void {
  let contents: string;
  try {
    contents = readFileSync(envPath, "utf-8");
  } catch {
    return; // .env not present — rely on real environment variables
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Bootstrap: .env must be loaded before DATA_DIR is derived, so that a
// TOASTMASTERS_DATA_DIR declared in .env is honoured.
loadEnvFile();

function resolveDataDir(): string {
  const override = process.env.TOASTMASTERS_DATA_DIR?.trim();
  if (override) {
    // Absolute is the contract (Electron passes app.getPath('userData')); a
    // relative value is resolved against cwd rather than being silently ignored.
    return isAbsolute(override) ? resolve(override) : resolve(process.cwd(), override);
  }
  return resolve(REPO_ROOT, "results");
}

/** Absolute directory holding db.sqlite and the membership-YYYY-MM-DD.csv exports. */
export const DATA_DIR: string = resolveDataDir();
