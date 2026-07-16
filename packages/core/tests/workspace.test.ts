import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Phase 10 structural invariants for the npm-workspaces monorepo.
 *
 * These tests protect the *wiring* rather than behaviour: the `exports` map of
 * @toastmasters/core, the public symbols apps/desktop and packages/ui depend on,
 * and the framework-agnosticism of core that Phase 11 (Electron) is predicated on.
 *
 * They live in the core package because core's suite runs first under the root
 * `npm test`, so a broken monorepo layout fails fast before the desktop suite runs.
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

/**
 * Remove `//` line comments and block comments from source, so that import-like
 * text inside comments (e.g. an illustrative `import ... from "@toastmasters/core/x"`
 * in a doc comment) is never mistaken for a real import specifier.
 *
 * String literals are preserved verbatim — a `//` inside a string (a URL, say) is
 * NOT a comment. Real module specifiers essentially never contain `//`, so the
 * import regexes below stay accurate once genuine comments are gone.
 */
function stripComments(src: string): string {
  let out = "";
  type State = "code" | "line" | "block" | "single" | "double" | "template";
  let state: State = "code";

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    switch (state) {
      case "code":
        if (c === "/" && next === "/") { state = "line"; i++; }
        else if (c === "/" && next === "*") { state = "block"; i++; }
        else if (c === "'") { state = "single"; out += c; }
        else if (c === '"') { state = "double"; out += c; }
        else if (c === "`") { state = "template"; out += c; }
        else out += c;
        break;
      case "line":
        // Drop the comment body; keep the newline that ends it so line-based
        // structure (and any real import on the next line) survives.
        if (c === "\n") { state = "code"; out += c; }
        break;
      case "block":
        if (c === "*" && next === "/") { state = "code"; i++; }
        else if (c === "\n") out += c; // preserve line count
        break;
      case "single":
      case "double":
      case "template": {
        out += c;
        const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
        if (c === "\\") { out += next ?? ""; i++; }      // escaped char: copy verbatim
        else if (c === quote) state = "code";            // closing quote
        break;
      }
    }
  }
  return out;
}

/** Extract every module specifier imported/re-exported by a chunk of source text. */
function extractImportSpecifiers(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const specifiers: string[] = [];
  const staticImport = /(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
  const bareImport = /import\s+["']([^"']+)["']/g;
  const dynamicImport = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const re of [staticImport, bareImport, dynamicImport]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      // Capture group 1 is required by every pattern above (it is never
      // optional), so it is always populated when the overall match succeeds;
      // the guard exists only to satisfy noUncheckedIndexedAccess.
      const spec = m[1];
      if (spec) specifiers.push(spec);
    }
  }
  return specifiers;
}

/** Extract every module specifier imported/re-exported by a source file. */
function importSpecifiers(file: string): string[] {
  return extractImportSpecifiers(readFileSync(file, "utf8"));
}

describe("importSpecifiers ignores comments but still sees real imports", () => {
  // The whole guard rests on this: if the scanner read import-like text inside
  // comments, it would raise false positives (a doc comment illustrating a bad
  // import would be flagged); if it stopped seeing real imports, every "no
  // offenders" assertion would pass vacuously. Both directions are pinned here.

  it("does not match an import specifier that appears inside a // line comment", () => {
    const src = `// import x from "@toastmasters/core/undeclared"\nconst y = 1;\n`;
    expect(extractImportSpecifiers(src)).toEqual([]);
  });

  it("does not match an import specifier that appears inside a /* block comment */", () => {
    const src = `/*\n * import x from "@toastmasters/core/undeclared"\n */\nconst y = 1;\n`;
    expect(extractImportSpecifiers(src)).toEqual([]);
  });

  it("still catches a genuine undeclared-subpath import in real code", () => {
    const src = `import { thing } from "@toastmasters/core/undeclared";\n`;
    expect(extractImportSpecifiers(src)).toEqual(["@toastmasters/core/undeclared"]);
  });

  it("distinguishes a commented-out import from a real one on adjacent lines", () => {
    const src =
      `// import old from "@toastmasters/core/gone";\n` +
      `import current from "@toastmasters/core/db";\n`;
    expect(extractImportSpecifiers(src)).toEqual(["@toastmasters/core/db"]);
  });

  it("does not treat a // inside a string literal as the start of a comment", () => {
    const src = `const url = "https://example.com";\nimport x from "@toastmasters/core/db";\n`;
    expect(extractImportSpecifiers(src)).toEqual(["@toastmasters/core/db"]);
  });

  it("matches bare and dynamic imports too, but not their commented-out twins", () => {
    const src =
      `import "@toastmasters/core/db";\n` +
      `// import "@toastmasters/core/gone";\n` +
      `const mod = await import("@toastmasters/core/queries");\n` +
      `/* const dead = await import("@toastmasters/core/dead"); */\n`;
    expect(extractImportSpecifiers(src).sort()).toEqual(
      ["@toastmasters/core/db", "@toastmasters/core/queries"].sort(),
    );
  });
});

describe("@toastmasters/core exports map", () => {
  // The literal list below IS the contract. It is deliberately spelled out rather
  // than derived from `corePkg.exports`, so that adding or removing a subpath
  // fails this test until someone changes the contract on purpose.
  //
  // Phase 11 added `./queries` (the member-summary / detail / diff read models,
  // lifted out of the Next.js API routes so the Electron main process can call the
  // same code). That is a real widening of core's public surface, so the list grew
  // from nine entries to ten.
  it("declares the ten public subpaths the workspace depends on", () => {
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
        "./queries",
        "./types",
      ].sort(),
    );
  });

  it.each(EXPORT_SUBPATHS)("subpath %s resolves to a file that exists on disk", (subpath) => {
    const target = corePkg.exports[subpath];
    // subpath is drawn from Object.keys(corePkg.exports), so target is always
    // populated; the guard exists only to satisfy noUncheckedIndexedAccess.
    expect(target).toBeDefined();
    expect(existsSync(resolve(CORE_DIR, target as string))).toBe(true);
  });

  it.each(EXPORT_SUBPATHS)("subpath %s is importable at runtime", async (subpath) => {
    const mod = await import(`@toastmasters/core${subpath.slice(1)}`);
    expect(mod).toBeTypeOf("object");
  });
});

describe("@toastmasters/core public symbols", () => {
  it("db exposes the snapshot writers and queries the API routes call", async () => {
    const db = await import("@toastmasters/core/db");

    // Consumed by apps/desktop's IPC handlers (see specs/tech-stack.md; formerly
    // by apps/web/app/api/{members,members/[email],diff}/route.ts before Phase 14)
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
  it("paths exposes the filesystem anchors Electron depends on", async () => {
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
        // String#split always returns a non-empty array, so [0] is always a
        // string; the `?? spec` fallback exists only to satisfy
        // noUncheckedIndexedAccess.
        .filter((spec) => FORBIDDEN_PACKAGES.includes(spec.split("/")[0] ?? spec))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no core source file reaches into a UI package's app/, components/ or lib/", () => {
    const uiReach = /(^|\/)(app|components|lib)\//;
    const offenders = coreSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => spec.startsWith("@/") || uiReach.test(spec))
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
    const offenders = deps.filter((d) => FORBIDDEN_PACKAGES.includes(d.split("/")[0] ?? d));
    expect(offenders).toEqual([]);
  });
});

describe("packages/ui stays desktop-agnostic (Phase 21 module-boundaries guard)", () => {
  // Mirrors "core stays framework-agnostic" above: packages/ui must be
  // consumable by any future consumer (not just apps/desktop), so it must
  // never import electron or reach into apps/desktop directly. This test
  // lives in core's suite (not a packages/ui test of its own) because
  // packages/ui ships no test runner/config of its own (Phase 14) and core's
  // suite is the one that already runs first under the root `npm test`.
  const UI_DIR = resolve(REPO_ROOT, "packages", "ui");
  const uiGuardedSources = [
    ...collectSourceFiles(join(UI_DIR, "components")),
    ...collectSourceFiles(join(UI_DIR, "lib")),
  ];

  it("finds packages/ui source files to scan", () => {
    expect(uiGuardedSources.length).toBeGreaterThan(0);
  });

  // Guards against a vacuous pass, same reasoning as the core equivalent above.
  it("extracts real import specifiers from packages/ui sources", () => {
    const allSpecs = uiGuardedSources.flatMap(importSpecifiers);
    expect(allSpecs).toContain("react");
    expect(allSpecs).toContain("@toastmasters/core/queries");
  });

  it("no packages/ui source file imports electron", () => {
    const offenders = uiGuardedSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => spec === "electron" || spec.startsWith("electron/"))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no packages/ui source file reaches into apps/desktop", () => {
    const desktopReach = /(^|\/)apps\/desktop(\/|$)/;
    const offenders = uiGuardedSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => desktopReach.test(spec))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("packages/ui's package.json declares no electron dependency", () => {
    const raw = JSON.parse(readFileSync(join(UI_DIR, "package.json"), "utf8"));
    const deps = Object.keys({
      ...(raw.dependencies ?? {}),
      ...(raw.devDependencies ?? {}),
    });
    expect(deps).not.toContain("electron");
  });
});

describe("negative control: the packages/ui boundary guard fails closed", () => {
  // Proves the guard above can actually fail, not just that it happens to
  // pass against a codebase that is already clean — the same discipline
  // paths.test.ts applies to the cwd-anchoring fix. This fixture is scanned
  // as plain text; it is never compiled, executed, or imported by anything.
  const OFFENDER_FIXTURE = join(__dirname, "fixtures", "ui-boundary-offender.tsx");

  it("the fixture actually contains an electron import and an apps/desktop reach-in", () => {
    // Sanity check on the fixture itself, so a typo in the fixture can't make
    // the two assertions below pass vacuously.
    const specs = importSpecifiers(OFFENDER_FIXTURE);
    expect(specs).toContain("electron");
    expect(specs.some((s) => /(^|\/)apps\/desktop(\/|$)/.test(s))).toBe(true);
  });

  it("the electron-import check flags the fixture", () => {
    const offenders = importSpecifiers(OFFENDER_FIXTURE).filter(
      (spec) => spec === "electron" || spec.startsWith("electron/"),
    );
    expect(offenders).not.toEqual([]);
  });

  it("the apps/desktop reach-in check flags the fixture", () => {
    const desktopReach = /(^|\/)apps\/desktop(\/|$)/;
    const offenders = importSpecifiers(OFFENDER_FIXTURE).filter((spec) => desktopReach.test(spec));
    expect(offenders).not.toEqual([]);
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

  // Guards against a vacuous pass, as above: prove the scanner sees the workspace
  // sources' real imports (including the core subpaths that replaced the dead aliases).
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

  // Widened in Phase 11: apps/desktop is now a second consumer of core, and it
  // must respect the same `exports` contract (no deep relative reach into
  // packages/core/helpers/*). Phase 14 removed apps/web (its "web" case would
  // have collected an empty file list and passed vacuously — see the "Guards
  // against a vacuous pass" comments elsewhere in this file) and added
  // packages/ui as a second, non-`apps/` consumer, held to the same contract
  // by the dedicated case below it.
  it.each(["desktop"])(
    "every %s import of core goes through a declared @toastmasters/core subpath",
    (appName) => {
      const appSources = collectSourceFiles(join(REPO_ROOT, "apps", appName), [
        "out",
        "release",
      ]);
      const declared = new Set(
        EXPORT_SUBPATHS.map((s) => `@toastmasters/core${s.slice(1)}`),
      );

      const offenders = appSources.flatMap((file) =>
        importSpecifiers(file)
          .filter((spec) => spec.startsWith("@toastmasters/core"))
          .filter((spec) => !declared.has(spec))
          .map((spec) => `${file} -> ${spec}`),
      );
      expect(offenders).toEqual([]);
    },
  );

  it("finds the desktop app's core imports (guards the scan above from passing vacuously)", () => {
    const desktopSources = collectSourceFiles(join(REPO_ROOT, "apps", "desktop"), [
      "out",
      "release",
    ]);
    const specs = desktopSources.flatMap(importSpecifiers);
    expect(specs).toContain("@toastmasters/core/queries");
    expect(specs).toContain("@toastmasters/core/db");
  });

  // packages/ui imports core's view-model types (DiffResult, MemberSummary,
  // PathwaySummary, LevelGroup) from @toastmasters/core/queries, so it must
  // respect the same declared-subpath contract as apps/desktop.
  it("every ui import of core goes through a declared @toastmasters/core subpath", () => {
    const uiSources = collectSourceFiles(join(REPO_ROOT, "packages", "ui"));
    const declared = new Set(
      EXPORT_SUBPATHS.map((s) => `@toastmasters/core${s.slice(1)}`),
    );

    const offenders = uiSources.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => spec.startsWith("@toastmasters/core"))
        .filter((spec) => !declared.has(spec))
        .map((spec) => `${file} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("finds packages/ui's core imports (guards the scan above from passing vacuously)", () => {
    const uiSources = collectSourceFiles(join(REPO_ROOT, "packages", "ui"));
    const specs = uiSources.flatMap(importSpecifiers);
    expect(specs).toContain("@toastmasters/core/queries");
  });
});
