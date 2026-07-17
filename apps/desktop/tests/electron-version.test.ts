import { describe, expect, it } from "vitest";
import { createRequire } from "module";

/**
 * Phase 23 — `electron` was bumped from the EOL `33.4.11` to the current
 * stable `43.1.1` (an exact pin, not a caret range) specifically because
 * Electron only backports Chromium security fixes to currently-supported
 * majors: a pinned-but-EOL major silently stops receiving those fixes even
 * though `npm install` never complains.
 *
 * Every OTHER desktop test that touches `"electron"` mocks it away at the
 * module boundary (`vi.mock("electron", ...)` in auth.test.ts,
 * main-ipc.test.ts, and preload.test.ts) or stubs it entirely
 * (main-bundle.test.ts's `electronStub`), so none of them ever read the
 * real, installed `electron` package — a future dependency change that
 * silently re-pinned `electron` back to an EOL major would sail through the
 * whole suite unnoticed. This test reads the real installed package
 * directly (no mock, no stub) as a negative control against exactly that.
 */
describe("the installed electron dependency stays pinned to a supported major (Phase 23)", () => {
  it("resolves the real, installed electron package to major version 43", () => {
    const require = createRequire(import.meta.url);
    const { version } = require("electron/package.json") as { version: string };

    // Checks the major only (not the exact patch) — a same-major point
    // release bump is fine and shouldn't need this test touched; sliding
    // back to a pre-43 (EOL) major is exactly what must fail here.
    expect(version.split(".")[0]).toBe("43");
  });

  it("matches the exact version pinned in apps/desktop/package.json (no caret/range drift)", () => {
    const require = createRequire(import.meta.url);
    const { version: installedVersion } = require("electron/package.json") as {
      version: string;
    };
    const pkg = require("../package.json") as { devDependencies: Record<string, string> };

    // package.json pins electron to an exact version (no ^ or ~) on purpose —
    // see the roadmap Phase 23 entry — so the declared range IS the version.
    expect(pkg.devDependencies.electron).toBe(installedVersion);
  });
});
