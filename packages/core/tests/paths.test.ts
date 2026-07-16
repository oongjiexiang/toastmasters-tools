import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Phase 10 regression: core's filesystem anchors must not depend on process.cwd().
 *
 * npm workspace scripts run with the *workspace* directory as cwd:
 *   npm run fetch -w @toastmasters/core     ->  cwd = <repo>/packages/core
 *   npm run desktop:dev -w @toastmasters/desktop  ->  cwd = <repo>/apps/desktop
 *
 * Before packages/core/paths.ts, `.env` and `results/db.sqlite` were resolved
 * against cwd, so the CLI and the desktop app read and wrote *different* SQLite
 * files and the user's real <repo>/results/db.sqlite was orphaned.
 *
 * These checks run OUT OF PROCESS on purpose. REPO_ROOT / DATA_DIR /
 * DEFAULT_DB_PATH are module-load-time constants and vitest always runs with cwd
 * at the workspace root, so an in-process test cannot observe cwd-dependence and
 * would pass vacuously no matter how the paths were resolved. Each case therefore
 * spawns tsx with an explicit cwd and inspects what core actually resolved.
 *
 * Everything here is read-only: the probes resolve paths, they never open a
 * database or create a directory. No test points at the real db.sqlite in write mode.
 *
 * Phase 14 removed apps/web (the Next.js dashboard); apps/desktop is the
 * remaining second workspace whose scripts run with cwd = its own directory,
 * so it stands in as the non-core anchor for these checks.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(CORE_DIR, "..", "..");
const DESKTOP_DIR = resolve(REPO_ROOT, "apps", "desktop");

const TSX_CLI = resolve(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PROBE = resolve(__dirname, "fixtures", "paths-probe.ts");
const LEGACY_PROBE = resolve(__dirname, "fixtures", "legacy-paths-probe.ts");

const SPAWN_TIMEOUT_MS = 60_000;

interface ProbeResult {
  cwd: string;
  REPO_ROOT: string;
  ENV_FILE: string;
  DATA_DIR: string;
  RESULTS_DIR: string;
  DEFAULT_DB_PATH: string;
  declaredEnvKeys: string[];
  loadedEnvKeys: string[];
}

/** Windows drive-letter case is not stable across spawn; compare canonically. */
function norm(p: string): string {
  const resolved = resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Run a probe script under tsx with an explicit cwd, and parse its JSON stdout. */
function runProbe(
  script: string,
  cwd: string,
  extraEnv: Record<string, string> = {},
): ProbeResult {
  const result = spawnSync(process.execPath, [TSX_CLI, script], {
    cwd,
    encoding: "utf-8",
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, ...extraEnv },
  });

  if (result.status !== 0) {
    throw new Error(
      `probe failed (cwd=${cwd}, exit=${result.status})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as ProbeResult;
}

/**
 * The contract. Applied to the real implementation (must hold) and, by the
 * negative-control test below, to the pre-fix implementation (must NOT hold).
 */
function assertAnchoredAtRepoRoot(probe: ProbeResult): void {
  expect(isAbsolute(probe.REPO_ROOT)).toBe(true);
  expect(norm(probe.REPO_ROOT)).toBe(norm(REPO_ROOT));

  expect(isAbsolute(probe.ENV_FILE)).toBe(true);
  expect(norm(probe.ENV_FILE)).toBe(norm(join(REPO_ROOT, ".env")));

  expect(isAbsolute(probe.DATA_DIR)).toBe(true);
  expect(norm(probe.DATA_DIR)).toBe(norm(join(REPO_ROOT, "results")));

  // RESULTS_DIR was the relative string "results" before the fix.
  expect(isAbsolute(probe.RESULTS_DIR)).toBe(true);
  expect(norm(probe.RESULTS_DIR)).toBe(norm(probe.DATA_DIR));

  expect(isAbsolute(probe.DEFAULT_DB_PATH)).toBe(true);
  expect(norm(probe.DEFAULT_DB_PATH)).toBe(norm(join(REPO_ROOT, "results", "db.sqlite")));
}

/**
 * Key names declared in the repo-root .env, read here in the test process so the
 * expectation is anchored on the real file rather than on whatever the probe
 * happened to find. (A probe that loaded the wrong .env — or none — reports [],
 * which must not be allowed to satisfy this expectation.) Names only; no values.
 */
function envKeysOf(envFile: string): string[] {
  if (!existsSync(envFile)) return [];
  return readFileSync(envFile, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
    .filter((key) => key.length > 0);
}

const ROOT_ENV_KEYS = envKeysOf(join(REPO_ROOT, ".env"));

const ANCHOR_KEYS = ["REPO_ROOT", "ENV_FILE", "DATA_DIR", "RESULTS_DIR", "DEFAULT_DB_PATH"] as const;

function anchors(probe: ProbeResult): Record<string, string> {
  return Object.fromEntries(ANCHOR_KEYS.map((key) => [key, norm(probe[key])]));
}

describe("core filesystem anchors are independent of process.cwd()", () => {
  it("anchors on the repo root when the CLI runs with cwd = packages/core", () => {
    const probe = runProbe(PROBE, CORE_DIR);

    expect(norm(probe.cwd)).toBe(norm(CORE_DIR));
    assertAnchoredAtRepoRoot(probe);
  }, SPAWN_TIMEOUT_MS);

  it("anchors on the repo root when the desktop app runs with cwd = apps/desktop", () => {
    const probe = runProbe(PROBE, DESKTOP_DIR);

    expect(norm(probe.cwd)).toBe(norm(DESKTOP_DIR));
    assertAnchoredAtRepoRoot(probe);
  }, SPAWN_TIMEOUT_MS);

  it("anchors on the repo root when cwd is outside the repo entirely", () => {
    const outside = mkdtempSync(join(tmpdir(), "tm-cwd-"));
    try {
      const probe = runProbe(PROBE, outside);

      expect(norm(probe.cwd)).not.toBe(norm(REPO_ROOT));
      assertAnchoredAtRepoRoot(probe);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  it("resolves the CLI's and the desktop app's database to one and the same file", () => {
    const fromCore = runProbe(PROBE, CORE_DIR);
    const fromDesktop = runProbe(PROBE, DESKTOP_DIR);

    expect(anchors(fromDesktop)).toEqual(anchors(fromCore));
    expect(norm(fromDesktop.DEFAULT_DB_PATH)).toBe(norm(fromCore.DEFAULT_DB_PATH));
  }, SPAWN_TIMEOUT_MS);

  it("loads the repo-root .env from every cwd, so config is identical for CLI and desktop", () => {
    const fromCore = runProbe(PROBE, CORE_DIR);
    const fromDesktop = runProbe(PROBE, DESKTOP_DIR);

    // Compared against the real <repo>/.env, not against the probe's own view of it:
    // a probe that looked for .env in the wrong directory reports [] and must fail here.
    // Key names only — no values ever leave the subprocess.
    expect(fromCore.loadedEnvKeys).toEqual(ROOT_ENV_KEYS);
    expect(fromDesktop.loadedEnvKeys).toEqual(ROOT_ENV_KEYS);
  }, SPAWN_TIMEOUT_MS);
});

describe("negative control: the pre-fix, cwd-anchored resolution is rejected", () => {
  // Proves this suite can fail. The legacy probe reproduces the exact expressions
  // that shipped before paths.ts, and is fed through the SAME assertion helper.

  it("fails the repo-root contract when the old code runs with cwd = packages/core", () => {
    const legacy = runProbe(LEGACY_PROBE, CORE_DIR);

    expect(() => assertAnchoredAtRepoRoot(legacy)).toThrow();
  }, SPAWN_TIMEOUT_MS);

  it("fails the repo-root contract when the old code runs with cwd = apps/desktop", () => {
    const legacy = runProbe(LEGACY_PROBE, DESKTOP_DIR);

    expect(() => assertAnchoredAtRepoRoot(legacy)).toThrow();
  }, SPAWN_TIMEOUT_MS);

  it("reproduces the two-databases bug the fix eliminates", () => {
    const legacyCore = runProbe(LEGACY_PROBE, CORE_DIR);
    const legacyDesktop = runProbe(LEGACY_PROBE, DESKTOP_DIR);

    // The CLI and the desktop app would have used different SQLite files...
    expect(norm(legacyDesktop.DEFAULT_DB_PATH)).not.toBe(norm(legacyCore.DEFAULT_DB_PATH));
    expect(norm(legacyCore.DEFAULT_DB_PATH)).toBe(
      norm(join(CORE_DIR, "results", "db.sqlite")),
    );
    expect(norm(legacyDesktop.DEFAULT_DB_PATH)).toBe(
      norm(join(DESKTOP_DIR, "results", "db.sqlite")),
    );

    // ...and neither would have been the user's real database.
    const realDb = norm(join(REPO_ROOT, "results", "db.sqlite"));
    expect(norm(legacyCore.DEFAULT_DB_PATH)).not.toBe(realDb);
    expect(norm(legacyDesktop.DEFAULT_DB_PATH)).not.toBe(realDb);
  }, SPAWN_TIMEOUT_MS);

  it("fails the absolute-RESULTS_DIR contract, which the relative 'results' string broke", () => {
    const legacy = runProbe(LEGACY_PROBE, CORE_DIR);

    expect(legacy.RESULTS_DIR).toBe("results");
    expect(isAbsolute(legacy.RESULTS_DIR)).toBe(false);
  }, SPAWN_TIMEOUT_MS);
});

describe("TOASTMASTERS_DATA_DIR override (Phase 11 / Electron hook)", () => {
  // Must be set BEFORE core is imported: DATA_DIR is a module-load-time constant.
  // Hence a subprocess rather than vi.stubEnv.

  it("redirects DATA_DIR and the database to the absolute directory it names", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tm-data-"));
    try {
      const probe = runProbe(PROBE, CORE_DIR, { TOASTMASTERS_DATA_DIR: dataDir });

      expect(norm(probe.DATA_DIR)).toBe(norm(dataDir));
      expect(norm(probe.RESULTS_DIR)).toBe(norm(dataDir));
      expect(norm(probe.DEFAULT_DB_PATH)).toBe(norm(join(dataDir, "db.sqlite")));
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  it("leaves REPO_ROOT and ENV_FILE anchored on the repo root", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tm-data-"));
    try {
      const probe = runProbe(PROBE, DESKTOP_DIR, { TOASTMASTERS_DATA_DIR: dataDir });

      expect(norm(probe.REPO_ROOT)).toBe(norm(REPO_ROOT));
      expect(norm(probe.ENV_FILE)).toBe(norm(join(REPO_ROOT, ".env")));
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  it("gives the CLI and the dashboard the same database when both are pointed at it", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tm-data-"));
    try {
      const fromCore = runProbe(PROBE, CORE_DIR, { TOASTMASTERS_DATA_DIR: dataDir });
      const fromDesktop = runProbe(PROBE, DESKTOP_DIR, { TOASTMASTERS_DATA_DIR: dataDir });

      expect(norm(fromDesktop.DEFAULT_DB_PATH)).toBe(norm(fromCore.DEFAULT_DB_PATH));
      expect(norm(fromCore.DEFAULT_DB_PATH)).toBe(norm(join(dataDir, "db.sqlite")));
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  it("falls back to <repo>/results when the override is unset", () => {
    const probe = runProbe(PROBE, CORE_DIR, { TOASTMASTERS_DATA_DIR: "" });

    expect(norm(probe.DATA_DIR)).toBe(norm(join(REPO_ROOT, "results")));
  }, SPAWN_TIMEOUT_MS);
});
