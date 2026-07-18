import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { load as loadYaml } from "js-yaml";

/**
 * Phase 28 structural invariant for the CI workflow.
 *
 * `.github/workflows/ci.yml`'s `test` job gained a "Typecheck all
 * workspaces" step running `npm run typecheck --workspaces --if-present`,
 * so a `tsc` error in any workspace fails the PR check instead of a green
 * `npm test` masking it (the exact Phase 23 failure mode: `packages/ui`
 * silently inherited a hoisted `typescript@6.x` and failed `tsc --noEmit`
 * without `npm test` noticing). This test pins that shape down in CI,
 * mirroring the pattern established by release-workflow.test.ts.
 *
 * This lives in packages/core/tests alongside workspace.test.ts,
 * paths.test.ts, and release-workflow.test.ts, the existing home for
 * repo-wide structural/workflow invariant tests.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const CI_WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");

interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  "runs-on"?: string;
  steps?: WorkflowStep[];
}

interface CiWorkflow {
  on?: {
    push?: {
      branches?: string[];
    };
    pull_request?: {
      branches?: string[];
    };
  };
  jobs?: Record<string, WorkflowJob>;
}

/**
 * The contract. Applied to the real workflow file (must hold) and, by the
 * negative-control tests below, to deliberately broken fixture strings
 * (must NOT hold) — proving these assertions aren't vacuously true.
 */
function assertCiWorkflowShape(workflow: CiWorkflow): void {
  const testJob = workflow.jobs?.test;
  expect(testJob).toBeDefined();
  expect(testJob?.["runs-on"]).toBe("ubuntu-latest");

  const steps = testJob?.steps ?? [];

  const installStep = steps.find((step) => step.run?.includes("npm ci"));
  expect(installStep).toBeDefined();

  // Phase 28: the typecheck gate must run the workspace-wide typecheck.
  const typecheckStep = steps.find((step) => step.run?.includes("typecheck --workspaces"));
  expect(typecheckStep).toBeDefined();

  // A step whose `run` text merely *contains* "typecheck --workspaces"
  // inside a larger command isn't good enough to prove the gate actually
  // gates: `npm run typecheck --workspaces --if-present || true` would
  // still match the loose substring check above yet always exit 0, and
  // `continue-on-error: true` would let a real tsc failure through without
  // failing the job either way. Pin the exact command and confirm the
  // step's failure isn't being ignored, so neither can silently neuter the
  // gate this phase exists to add.
  expect(typecheckStep?.run?.trim()).toBe("npm run typecheck --workspaces --if-present");
  expect(typecheckStep?.["continue-on-error"]).not.toBe(true);

  const testStep = steps.find((step) => step.run?.includes("npm test") && step !== typecheckStep);
  expect(testStep).toBeDefined();

  // Ordering: install -> typecheck -> test, so a type error fails fast
  // before the slower test suite runs, and typecheck never runs before
  // dependencies are installed.
  const installIndex = steps.indexOf(installStep!);
  const typecheckIndex = steps.indexOf(typecheckStep!);
  const testIndex = steps.indexOf(testStep!);

  expect(installIndex).toBeGreaterThanOrEqual(0);
  expect(typecheckIndex).toBeGreaterThan(installIndex);
  expect(testIndex).toBeGreaterThan(typecheckIndex);

  // These must be three distinct steps, not the same step matched twice by
  // a loose check.
  expect(installStep).not.toBe(typecheckStep);
  expect(typecheckStep).not.toBe(testStep);
}

describe("ci.yml test job (Phase 28 typecheck gate)", () => {
  const raw = readFileSync(CI_WORKFLOW_PATH, "utf8");
  const workflow = loadYaml(raw) as CiWorkflow;

  it("parses as YAML with a test job", () => {
    expect(workflow.jobs?.test).toBeDefined();
  });

  it("satisfies the full Phase 28 install/typecheck/test contract", () => {
    assertCiWorkflowShape(workflow);
  });
});

describe("negative control: the pre-Phase-28 shape is rejected", () => {
  // Proves assertCiWorkflowShape can actually fail, and isn't a vacuous
  // pass no matter what ci.yml contains. This fixture reproduces the exact
  // pre-Phase-28 ci.yml (as it existed before the typecheck step was
  // added): npm ci followed directly by npm test, with no typecheck step
  // in between.

  it("fails when the typecheck step is missing entirely (pre-Phase-28 shape)", () => {
    const preP28 = loadYaml(`
on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Unit / API / bundle tests
        run: npm test
`) as CiWorkflow;

    expect(() => assertCiWorkflowShape(preP28)).toThrow();
  });

  it("fails when the typecheck step exists but runs after npm test (wrong order)", () => {
    const wrongOrder = loadYaml(`
on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Unit / API / bundle tests
        run: npm test
      - name: Typecheck all workspaces
        run: npm run typecheck --workspaces --if-present
`) as CiWorkflow;

    expect(() => assertCiWorkflowShape(wrongOrder)).toThrow();
  });

  it("fails when runs-on has drifted to ubuntu-22.04 instead of ubuntu-latest", () => {
    const wrongRunner = loadYaml(`
on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Typecheck all workspaces
        run: npm run typecheck --workspaces --if-present
      - name: Unit / API / bundle tests
        run: npm test
`) as CiWorkflow;

    expect(() => assertCiWorkflowShape(wrongRunner)).toThrow();
  });

  it("fails when the typecheck step is marked continue-on-error (gate is neutered)", () => {
    const neutered = loadYaml(`
on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Typecheck all workspaces
        continue-on-error: true
        run: npm run typecheck --workspaces --if-present
      - name: Unit / API / bundle tests
        run: npm test
`) as CiWorkflow;

    expect(() => assertCiWorkflowShape(neutered)).toThrow();
  });

  it("fails when the typecheck step's failure is swallowed (e.g. `|| true`)", () => {
    const swallowed = loadYaml(`
on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Typecheck all workspaces
        run: npm run typecheck --workspaces --if-present || true
      - name: Unit / API / bundle tests
        run: npm test
`) as CiWorkflow;

    expect(() => assertCiWorkflowShape(swallowed)).toThrow();
  });
});
