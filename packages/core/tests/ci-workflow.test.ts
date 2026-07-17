import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { load as loadYaml } from "js-yaml";

/**
 * Phase 27 structural invariant for the CI workflow.
 *
 * `.github/workflows/ci.yml`'s `test` job gained a "Typecheck workspaces"
 * step (`npm run typecheck --workspaces --if-present`) after the existing
 * `npm ci` / `npm test` steps. `npm test`'s vitest transpiles each file in
 * isolation and does not perform a project-wide `tsc --noEmit`, so a
 * workspace can be green under `npm test` and still fail a real typecheck —
 * exactly the Phase 23 `packages/ui` regression (a hoisted `typescript@6.x`
 * failing `tsc --noEmit` with TS5101), which slipped past validation until
 * an out-of-band typecheck run caught it. This test pins the fix down so it
 * can't be silently dropped from CI later.
 *
 * The step must live inside the SAME `test` job as the existing test step,
 * not a separate new job: branch protection only requires the `test` status
 * context (CONTRIBUTING.md), so a typecheck step added as its own job would
 * not actually be enforced without an out-of-band branch-protection change.
 *
 * This lives in packages/core/tests alongside workspace.test.ts,
 * paths.test.ts, and release-workflow.test.ts, the existing home for
 * repo-wide structural/workflow invariant tests. Mirrors
 * release-workflow.test.ts's pattern: js-yaml load the real file, assert its
 * shape via a small assert function, then negative-control that same
 * function against hand-written broken/old YAML fixtures to prove the
 * assertions can actually fail.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const CI_WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");

interface WorkflowStep {
  id?: string;
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

interface CiWorkflow {
  on?: {
    push?: { branches?: string[] };
    pull_request?: { branches?: string[] };
  };
  jobs?: Record<string, WorkflowJob>;
}

const TYPECHECK_RUN = "npm run typecheck --workspaces --if-present";

/**
 * The contract. Applied to the real workflow file (must hold) and, by the
 * negative-control tests below, to deliberately broken fixture strings
 * (must NOT hold) — proving these assertions aren't vacuously true.
 */
function assertCiTypecheckGateShape(workflow: CiWorkflow): void {
  // Exactly the `test` job — no sibling job was introduced to carry the
  // typecheck step (that would silently break branch-protection coverage
  // since only `test` is a required status context).
  expect(Object.keys(workflow.jobs ?? {})).toEqual(["test"]);

  const testJob = workflow.jobs?.test;
  expect(testJob).toBeDefined();

  const steps = testJob?.steps ?? [];

  const installIndex = steps.findIndex((step) => step.run?.includes("npm ci"));
  expect(installIndex).toBeGreaterThanOrEqual(0);

  const testStepIndex = steps.findIndex((step) => step.run === "npm test");
  expect(testStepIndex).toBeGreaterThan(installIndex);

  const typecheckStepIndex = steps.findIndex((step) => step.run === TYPECHECK_RUN);
  expect(typecheckStepIndex).toBeGreaterThanOrEqual(0);

  // Order matters: typecheck must run after dependencies are installed, or
  // it fails every time regardless of whether the code actually typechecks.
  expect(typecheckStepIndex).toBeGreaterThan(installIndex);
}

describe("ci.yml runs a typecheck gate in the test job (Phase 27)", () => {
  const raw = readFileSync(CI_WORKFLOW_PATH, "utf8");
  const workflow = loadYaml(raw) as CiWorkflow;

  it("parses as valid YAML with a jobs section", () => {
    expect(workflow.jobs).toBeDefined();
  });

  it("satisfies the full Phase 27 typecheck-gate contract", () => {
    assertCiTypecheckGateShape(workflow);
  });
});

describe("negative control: broken/old ci.yml shapes are rejected", () => {
  // Proves assertCiTypecheckGateShape can actually fail, and isn't a vacuous
  // pass no matter what ci.yml contains.

  it("fails when the typecheck step is missing entirely (pre-Phase-27 shape)", () => {
    const preP27 = loadYaml(`
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

    expect(() => assertCiTypecheckGateShape(preP27)).toThrow();
  });

  it("fails when the typecheck step lives in a separate job from test (breaks branch-protection coverage)", () => {
    const separateJob = loadYaml(`
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
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Typecheck workspaces
        run: npm run typecheck --workspaces --if-present
`) as CiWorkflow;

    expect(() => assertCiTypecheckGateShape(separateJob)).toThrow();
  });

  it("fails when the typecheck step comes before npm ci (would fail every run regardless of code)", () => {
    const beforeInstall = loadYaml(`
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
      - name: Typecheck workspaces
        run: npm run typecheck --workspaces --if-present
      - name: Install dependencies
        run: npm ci
      - name: Unit / API / bundle tests
        run: npm test
`) as CiWorkflow;

    expect(() => assertCiTypecheckGateShape(beforeInstall)).toThrow();
  });
});
