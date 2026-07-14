import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Phase 10 structural invariants for the npm-workspaces monorepo.
 *
 * These tests protect the *wiring* rather than behaviour: the `exports` map of
 * @toastmasters/core, the public symbols the web API routes depend on, and the
 * framework-agnosticism of core that Phase 11 (Electron) is predicated on.
 *
 * They live in the core package because core's suite runs first under the root
 * `npm test`, so a broken monorepo layout fails fast before the web suite runs.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(CORE_DIR, "../..");

interface CorePackageJson {
  name: string;
  exports: Record<string, string>;
}

const corePkg: CorePackageJson = JSON.parse(
  readFileSync(join(CORE_DIR, "package.json"), "utf8"),
);

const EXPORT_SUBPATHS = Object.keys(corePkg.exports);

/** Recursively collect .ts/.tsx files under `dir`, skipping node_modules and build output. */
function collectSourceFiles(dir: string, skipDirs: string[] = []): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".next", "dist", "coverage", ...skipDirs].includes(entry)) {
        continue;
      }
      out.push(...collectSourceFiles(full, skipDirs));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Extract every module specifier imported/re-exported by a source file. */
function importSpecifiers(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const staticImport = /(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
  const bareImport = /import\s+["']([^"']+)["']/g;
  const dynamicImport = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const re of [staticImport, bareImport, dynamicImport]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specifiers.push(m[1]);
  }
  return specifiers;
}

describe("@toastmasters/core exports map", () => {
  it("declares the nine public subpaths the workspace depends on", () => {
    expect(EXPORT_SUBPATHS.sort()).toEqual(
      [
        "./api",
        "./config",
        "./db",
        "./fetch",
        "./files",
        "./membership",
        "./paths",
        "./pathway",
        "./types",
      ].sort(),
    );
  });

  it.each(EXPORT_SUBPATHS)("subpath %s resolves to a file that exists on disk", (subpath) => {
    const target = corePkg.exports[subpath];
    expect(existsSync(resolve(CORE_DIR, target))).toBe(true);
  });

  it.each(EXPORT_SUBPATHS)("subpath %s is importable at runtime", async (subpath) => {
    const mod = await import(`@toastmasters/core${subpath.slice(1)}`);
    expect(mod).toBeTypeOf("object");
  });
});

describe("@toastmasters/core public symbols", () => {
  it("db exposes the snapshot writers and queries the API routes call", async () => {
    const db = await import("@toastmasters/core/db");

    // Consumed by apps/web/app/api/{members,members/[email],diff}/route.ts
    expect(db.getLatestProgress).toBeTypeOf("function");
    expect(db.getLatestMembership).toBeTypeOf("function");
    expect(db.getLatestProjects).toBeTypeOf("function");
    expect(db.getProgressDiff).toBeTypeOf("function");
    expect(db.getMembershipDiff).toBeTypeOf("function");

    // Consumed by core's own services/{fetch,membership}.ts
    expect(db.snapshotProgress).toBeTypeOf("function");
    expect(db.snapshotProjects).toBeTypeOf("function");
    expect(db.snapshotMembership).toBeTypeOf("function");
  });

  it("pathway exposes the level helpers and the standard level list", async () => {
    const pathway = await import("@toastmasters/core/pathway");

    expect(pathway.nextLevelFromFlags).toBeTypeOf("function");
    expect(pathway.titleFromFlags).toBeTypeOf("function");
    expect(pathway.isOverviewLesson).toBeTypeOf("function");
    expect(pathway.STANDARD_LEVELS).toEqual([
      "Level 1",
      "Level 2",
      "Level 3",
      "Level 4",
      "Level 5",
    ]);
  });

  it("files exposes findLatestMembershipFile", async () => {
    const files = await import("@toastmasters/core/files");
    expect(files.findLatestMembershipFile).toBeTypeOf("function");
  });

  it("config exposes RESULTS_DIR", async () => {
    const config = await import("@toastmasters/core/config");
    expect(config.RESULTS_DIR).toBeTypeOf("string");
  });

  // ./paths is public API, not an implementation detail: Phase 11's Electron main
  // process reads DATA_DIR and points it at app.getPath('userData').
  it("paths exposes the filesystem anchors Electron and the web app depend on", async () => {
    const paths = await import("@toastmasters/core/paths");

    expect(paths.REPO_ROOT).toBeTypeOf("string");
    expect(paths.ENV_FILE).toBeTypeOf("string");
    expect(paths.DATA_DIR).toBeTypeOf("string");
    expect(paths.loadEnvFile).toBeTypeOf("function");
  });

  it("fetch and membership services each expose a main entrypoint", async () => {
    const fetchSvc = await import("@toastmasters/core/fetch");
    const membershipSvc = await import("@toastmasters/core/membership");

    expect(fetchSvc.main).toBeTypeOf("function");
    expect(membershipSvc.main).toBeTypeOf("function");
  });
});

describe("core stays framework-agnostic (Phase 11 Electron precondition)", () => {
  const coreSources = collectSourceFiles(CORE_DIR, ["tests"]).filter(
    (f) => !/\.config\.ts$/.test(f),
  );

  const FORBIDDEN_PACKAGES = [
    "next",
    "react",
    "react-dom",
    "next-themes",
    "sonner",
    "lucide-react",
  ];

  it("finds core source files to scan", () => {
    expect(coreSources.length).toBeGreaterThan(0);
  });

  // Guards against a vacuous pass: if the specifier extractor silently returned
  // nothing, every "no offenders" assertion below would pass for the wrong reason.
  it("extracts real import specifiers from core sources", () => {
    const allSpecs = coreSources.flatMap(importSpecifiers);
    expect(allSpecs).toContain("better-sqlite3");
    expect(allSpecs).toContain("../config");
  });

  it.each([
    ["next", /^next(\/|$)/],
    ["react", /^react(-dom)?(\/|$)/],
  ])("no core source file imports from %s", (_label, pattern) => {
    const offenders = coreSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => pattern.test(spec))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no core source file imports any web-only UI package", () => {
    const offenders = coreSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => FORBIDDEN_PACKAGES.includes(spec.split("/")[0]))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no core source file reaches into the web app's app/, components/ or lib/", () => {
    const webReach = /(^|\/)(app|components|lib)\//;
    const offenders = coreSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => spec.startsWith("@/") || webReach.test(spec))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("core's package.json declares no framework dependencies", () => {
    const raw = JSON.parse(readFileSync(join(CORE_DIR, "package.json"), "utf8"));
    const deps = Object.keys({
      ...(raw.dependencies ?? {}),
      ...(raw.devDependencies ?? {}),
    });
    const offenders = deps.filter((d) => FORBIDDEN_PACKAGES.includes(d.split("/")[0]));
    expect(offenders).toEqual([]);
  });
});

describe("dead pre-monorepo aliases are gone", () => {
  const allSources = [
    ...collectSourceFiles(join(REPO_ROOT, "packages")),
    ...collectSourceFiles(join(REPO_ROOT, "apps")),
  ];

  it("finds workspace source files to scan", () => {
    expect(allSources.length).toBeGreaterThan(0);
  });

  // Guards against a vacuous pass, as above: prove the scanner sees the web app's
  // real imports (including the core subpaths that replaced the dead aliases).
  it("extracts real import specifiers from workspace sources", () => {
    const allSpecs = allSources.flatMap(importSpecifiers);
    expect(allSpecs).toContain("@toastmasters/core/db");
    expect(allSpecs).toContain("react");
  });

  it.each(["@/helpers/", "@/config", "@/services/", "@/types"])(
    "no source file imports the dead alias %s",
    (deadAlias) => {
      const offenders = allSources.flatMap((file) =>
        importSpecifiers(file)
          .filter((spec) => spec === deadAlias || spec.startsWith(deadAlias))
          .map((spec) => `${file} -> ${spec}`),
      );
      expect(offenders).toEqual([]);
    },
  );

  it("every web import of core goes through a declared @toastmasters/core subpath", () => {
    const webSources = collectSourceFiles(join(REPO_ROOT, "apps", "web"));
    const declared = new Set(
      EXPORT_SUBPATHS.map((s) => `@toastmasters/core${s.slice(1)}`),
    );

    const offenders = webSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => spec.startsWith("@toastmasters/core"))
        .filter((spec) => !declared.has(spec))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
