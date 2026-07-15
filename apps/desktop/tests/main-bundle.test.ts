import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { createRequire, isBuiltin } from "module";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE IMPORT-ORDER GUARD (Phase 11's highest-stakes invariant)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `packages/core/paths.ts` freezes DATA_DIR, and `helpers/db.ts` freezes
 * DEFAULT_DB_PATH, into module-level consts at *import* time, reading
 * `process.env.TOASTMASTERS_DATA_DIR`. `config.ts` does the same for
 * SESSION_ID / TI_COOKIE. ESM imports are hoisted and evaluated before any
 * function body runs.
 *
 * So if the Electron main process ever reaches core at module-evaluation time —
 * a static `import` anywhere in main's import graph — core evaluates BEFORE
 * `app.getPath('userData')` can set TOASTMASTERS_DATA_DIR. In the packaged app
 * there is no workspace package.json above the asar, so core's repo-root walk
 * falls through and the database resolves to a junk path inside the asar, and
 * the scrapers see empty credentials.
 *
 * The catastrophic property of that bug is that it is INVISIBLE to every other
 * test: unit tests import core directly and set env themselves, so they stay
 * green while the shipped .exe silently writes its database nowhere useful.
 *
 * This test therefore asserts the invariant on the EMITTED BUNDLE, not the
 * source: the bundler — not the author's intent — is what decides evaluation
 * order. It rebuilds `out/` first, so it can never pass by reading a stale
 * artifact, then *evaluates* out/main/index.js in a sandbox with a recording
 * `require`, exactly as Electron would, and asserts that nothing outside
 * {electron, node builtins} was pulled in before `app.whenReady()` resolves.
 *
 * A source-level check is kept alongside it as a second, cheaper line of defence.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = resolve(__dirname, "..");
const MAIN_BUNDLE = join(DESKTOP_DIR, "out", "main", "index.js");
const PRELOAD_BUNDLE = join(DESKTOP_DIR, "out", "preload", "index.js");
const MAIN_SRC = join(DESKTOP_DIR, "src", "main");

/** Anything matching this reaches @toastmasters/core (directly or via a chunk). */
const CORE_ISH = /@toastmasters|better-sqlite3|csv-parse|chunks?\//;

/** What main is allowed to pull in at module-evaluation time. */
function isAllowedAtEvalTime(specifier: string): boolean {
  return specifier === "electron" || isBuiltin(specifier);
}

interface EvalTrace {
  required: string[];
  evaluated: boolean;
}

/**
 * Evaluates a CommonJS bundle the way Electron's main process would, recording
 * every `require()` that happens during module evaluation. `app.whenReady()`
 * never resolves, so nothing scheduled behind it (i.e. `loadCore()`) can run —
 * anything recorded here happened at evaluation time, which is precisely the
 * window in which core must not be touched.
 */
function evaluateBundle(bundlePath: string): EvalTrace {
  const code = readFileSync(bundlePath, "utf8");
  const required: string[] = [];
  const realRequire = createRequire(bundlePath);
  const userData = mkdtempSync(join(tmpdir(), "tm-desktop-eval-"));

  const noop = () => undefined;
  const electronStub = {
    app: {
      setName: noop,
      getPath: () => userData,
      // Never resolves: keeps whenReady().then(...) — and loadCore() with it —
      // permanently unscheduled.
      whenReady: () => new Promise<void>(() => {}),
      on: noop,
      quit: noop,
    },
    ipcMain: { handle: noop },
    contextBridge: { exposeInMainWorld: noop },
    ipcRenderer: { invoke: noop },
    dialog: { showSaveDialog: noop },
    shell: { openPath: noop, openExternal: noop },
    Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({}) },
    BrowserWindow: class {
      webContents = { setWindowOpenHandler: noop };
      once = noop;
      loadURL = noop;
      loadFile = noop;
      static getAllWindows = () => [];
    },
  };

  /** A stub that tolerates any property access, so evaluation continues even if
   *  the bundle pulls in something forbidden — we want the assertion to report
   *  it, not a crash to mask it. */
  const tolerant: unknown = new Proxy(() => tolerant, {
    get: () => tolerant,
    apply: () => tolerant,
    construct: () => Object.create(null),
  });

  const recordingRequire = (specifier: string): unknown => {
    required.push(specifier);
    if (specifier === "electron") return electronStub;
    if (isBuiltin(specifier)) return realRequire(specifier);
    return tolerant;
  };

  const module = { exports: {} as Record<string, unknown> };
  const wrapper = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    code,
  );
  wrapper(
    module.exports,
    recordingRequire,
    module,
    bundlePath,
    dirname(bundlePath),
  );

  return { required, evaluated: true };
}

beforeAll(() => {
  // Rebuild from source. Without this the guard could pass against a stale bundle
  // produced by an earlier, correct version of main/index.ts — a silently vacuous
  // test, which is the one thing worse than no test.
  execFileSync("npx", ["electron-vite", "build"], {
    cwd: DESKTOP_DIR,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
});

describe("the emitted main bundle exists", () => {
  it("builds out/main/index.js and out/preload/index.js", () => {
    expect(existsSync(MAIN_BUNDLE)).toBe(true);
    expect(existsSync(PRELOAD_BUNDLE)).toBe(true);
  });
});

describe("main never reaches @toastmasters/core at module-evaluation time", () => {
  it("evaluates the real bundle and records what it required (guards against a vacuous pass)", () => {
    const trace = evaluateBundle(MAIN_BUNDLE);

    // If the bundle never actually ran, every "no core" assertion below would
    // pass for the wrong reason. Prove evaluation really happened.
    expect(trace.evaluated).toBe(true);
    expect(trace.required).toContain("electron");
  });

  it("requires nothing but electron and node builtins before app.whenReady() resolves", () => {
    const { required } = evaluateBundle(MAIN_BUNDLE);
    const forbidden = required.filter((spec) => !isAllowedAtEvalTime(spec));

    expect(forbidden).toEqual([]);
  });

  it("does not require core, better-sqlite3, or a core chunk at module-evaluation time", () => {
    const { required } = evaluateBundle(MAIN_BUNDLE);
    const coreReach = required.filter((spec) => CORE_ISH.test(spec));

    expect(coreReach).toEqual([]);
  });

  it("still reaches core lazily — the deferred chunk really does contain core", () => {
    // The mirror image of the assertions above: proves core is *behind* the lazy
    // boundary rather than absent from the app altogether (which would make the
    // guard trivially satisfiable by deleting the feature).
    const bundle = readFileSync(MAIN_BUNDLE, "utf8");
    const chunkRefs = [...bundle.matchAll(/require\("(\.\/chunks\/[^"]+)"\)/g)].map(
      (m) => m[1],
    );
    expect(chunkRefs.length).toBeGreaterThan(0);

    const chunkDir = join(DESKTOP_DIR, "out", "main", "chunks");
    const chunkSources = readdirSync(chunkDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(chunkDir, f), "utf8"))
      .join("\n");

    expect(chunkSources).toMatch(/better-sqlite3/);
  });

  it("reaches the core chunk only from inside a function body, never at the top level", () => {
    const bundle = readFileSync(MAIN_BUNDLE, "utf8");
    // Top-level requires in a rollup CJS bundle are emitted as `const x = require(...)`
    // at column 0. A lazily-required chunk appears indented, inside loadCore().
    const topLevelRequires = [
      ...bundle.matchAll(/^(?:const|let|var)\s+\w+\s*=\s*require\("([^"]+)"\)/gm),
    ].map((m) => m[1]);

    expect(topLevelRequires.length).toBeGreaterThan(0);
    expect(topLevelRequires.filter((s) => CORE_ISH.test(s))).toEqual([]);
  });
});

describe("the preload bundle stays free of core and native modules", () => {
  it("requires only electron", () => {
    const { required } = evaluateBundle(PRELOAD_BUNDLE);

    expect(required).toContain("electron");
    expect(required.filter((spec) => CORE_ISH.test(spec))).toEqual([]);
  });
});

describe("main's source keeps core behind a dynamic import", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(dir, f));
  }

  it("no file in src/main statically imports @toastmasters/core, except core.ts itself", () => {
    const offenders = sourceFiles(MAIN_SRC)
      .filter((file) => file !== join(MAIN_SRC, "core.ts"))
      .flatMap((file) => {
        const src = readFileSync(file, "utf8");
        // `import ... from "@toastmasters/core/x"` and bare `import "..."`,
        // excluding type-only imports (erased at build time).
        const statics = [
          ...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm),
          ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
        ].map((m) => m[1]);
        return statics
          .filter((spec) => spec.startsWith("@toastmasters/core") || spec === "./core")
          .map((spec) => `${file} -> ${spec}`);
      });

    expect(offenders).toEqual([]);
  });

  it("index.ts reaches core through a dynamic import (guards the check above from passing vacuously)", () => {
    const src = readFileSync(join(MAIN_SRC, "index.ts"), "utf8");
    expect(src).toMatch(/import\(\s*["']\.\/core["']\s*\)/);
  });

  it("index.ts sets TOASTMASTERS_DATA_DIR from Electron's userData before any core access", () => {
    const src = readFileSync(join(MAIN_SRC, "index.ts"), "utf8");
    const setEnvAt = src.indexOf("process.env.TOASTMASTERS_DATA_DIR");
    const dynamicImportAt = src.search(/import\(\s*["']\.\/core["']\s*\)/);

    expect(setEnvAt).toBeGreaterThan(-1);
    expect(setEnvAt).toBeLessThan(dynamicImportAt);
    expect(src).toMatch(/app\.getPath\(\s*["']userData["']\s*\)/);
  });
});
