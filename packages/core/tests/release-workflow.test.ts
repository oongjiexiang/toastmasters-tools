import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { load as loadYaml } from "js-yaml";

/**
 * Phase 15 structural invariant for the release workflow.
 *
 * `.github/workflows/release.yml` gained a `push: branches: [main]` trigger
 * (alongside the pre-existing tag trigger) and a second, distinctly-gated
 * publish step so every merge to main gets a rolling pre-release without
 * touching the tag-triggered "real" Release. Phase 13 validated this shape by
 * hand only, which is not durable — this test pins it down in CI.
 *
 * This lives in packages/core/tests alongside workspace.test.ts and
 * paths.test.ts, the existing home for repo-wide structural/workflow
 * invariant tests. Neither of those files touches .github/workflows, so
 * there is no overlapping logic to reconcile here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const RELEASE_WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "release.yml");

interface WorkflowStep {
  name?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  run?: string;
}

interface WorkflowJob {
  "runs-on"?: string;
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  on?: {
    push?: {
      tags?: string[];
      branches?: string[];
    };
    workflow_dispatch?: unknown;
  };
  jobs?: Record<string, WorkflowJob>;
}

/**
 * The contract. Applied to the real workflow file (must hold) and, by the
 * negative-control tests below, to deliberately broken fixture strings
 * (must NOT hold) — proving these assertions aren't vacuously true.
 */
function assertReleaseWorkflowShape(workflow: ReleaseWorkflow): void {
  const push = workflow.on?.push;
  expect(push).toBeDefined();

  // Tag triggers: unchanged since before Phase 15.
  expect(Array.isArray(push?.tags)).toBe(true);
  expect(push?.tags?.length).toBeGreaterThan(0);
  expect(push?.tags).toContain("v[0-9]+.[0-9]+*");
  expect(push?.tags).toContain("[0-9]+.[0-9]+*");

  // Phase 15: push to main also triggers a build.
  expect(Array.isArray(push?.branches)).toBe(true);
  expect(push?.branches).toContain("main");

  // workflow_dispatch must still exist (manual run), even though its value is
  // null/empty in YAML.
  expect(workflow.on).toHaveProperty("workflow_dispatch");

  const buildJob = workflow.jobs?.["build-windows"];
  expect(buildJob).toBeDefined();

  // electron-builder's NSIS target and the better-sqlite3 native rebuild must
  // run on real Windows; windows-2022 is pinned deliberately (not "latest").
  expect(buildJob?.["runs-on"]).toBe("windows-2022");

  const steps = buildJob?.steps ?? [];

  const setupPythonStep = steps.find((step) => step.uses === "actions/setup-python@v5");
  expect(setupPythonStep).toBeDefined();
  expect(setupPythonStep?.with?.["python-version"]).toBe("3.11");

  // The two publish steps must be gated on distinct, non-overlapping refs so
  // a tag push and a main push each produce exactly the release they should.
  const tagGatedStep = steps.find((step) => step.if?.includes("startsWith(github.ref, 'refs/tags/')"));
  expect(tagGatedStep).toBeDefined();
  expect(tagGatedStep?.uses).toBe("softprops/action-gh-release@v2");

  const mainGatedStep = steps.find((step) => step.if?.includes("refs/heads/main"));
  expect(mainGatedStep).toBeDefined();
  expect(mainGatedStep?.uses).toBe("softprops/action-gh-release@v2");

  // The two publish steps must actually be different steps, not the same one
  // matched twice by a loose `if` check.
  expect(mainGatedStep).not.toBe(tagGatedStep);
}

describe("release.yml triggers and build job (Phase 15)", () => {
  const raw = readFileSync(RELEASE_WORKFLOW_PATH, "utf8");
  const workflow = loadYaml(raw) as ReleaseWorkflow;

  it("parses as YAML with an on.push section", () => {
    expect(workflow.on?.push).toBeDefined();
  });

  it("satisfies the full Phase 15 trigger/build/publish contract", () => {
    assertReleaseWorkflowShape(workflow);
  });
});

describe("negative control: broken/old trigger configs are rejected", () => {
  // Proves assertReleaseWorkflowShape can actually fail, and isn't a vacuous
  // pass no matter what release.yml contains.

  it("fails when the push.branches: [main] trigger is missing (pre-Phase-15 shape)", () => {
    const preP15 = loadYaml(`
on:
  push:
    tags:
      - "v[0-9]+.[0-9]+*"
      - "[0-9]+.[0-9]+*"
  workflow_dispatch:
jobs:
  build-windows:
    runs-on: windows-2022
    steps:
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
`) as ReleaseWorkflow;

    expect(() => assertReleaseWorkflowShape(preP15)).toThrow();
  });

  it("fails when runs-on has drifted to windows-latest instead of windows-2022", () => {
    const wrongRunner = loadYaml(`
on:
  push:
    tags:
      - "v[0-9]+.[0-9]+*"
      - "[0-9]+.[0-9]+*"
    branches:
      - main
  workflow_dispatch:
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
      - name: Publish rolling main pre-release
        if: github.ref == 'refs/heads/main'
        uses: softprops/action-gh-release@v2
`) as ReleaseWorkflow;

    expect(() => assertReleaseWorkflowShape(wrongRunner)).toThrow();
  });

  it("fails when the rolling main pre-release step is missing entirely", () => {
    const noMainPublish = loadYaml(`
on:
  push:
    tags:
      - "v[0-9]+.[0-9]+*"
      - "[0-9]+.[0-9]+*"
    branches:
      - main
  workflow_dispatch:
jobs:
  build-windows:
    runs-on: windows-2022
    steps:
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
`) as ReleaseWorkflow;

    expect(() => assertReleaseWorkflowShape(noMainPublish)).toThrow();
  });

  it("fails when setup-python is pinned to the wrong version", () => {
    const wrongPython = loadYaml(`
on:
  push:
    tags:
      - "v[0-9]+.[0-9]+*"
      - "[0-9]+.[0-9]+*"
    branches:
      - main
  workflow_dispatch:
jobs:
  build-windows:
    runs-on: windows-2022
    steps:
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
      - name: Publish rolling main pre-release
        if: github.ref == 'refs/heads/main'
        uses: softprops/action-gh-release@v2
`) as ReleaseWorkflow;

    expect(() => assertReleaseWorkflowShape(wrongPython)).toThrow();
  });
});
