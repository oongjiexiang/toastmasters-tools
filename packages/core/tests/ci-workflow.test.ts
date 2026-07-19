import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { loadWorkflowFile, type WorkflowJob } from "./fixtures/workflow-shapes";

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
 * The valid, post-Phase-28 shape of `ci.yml`'s `test` job, as a plain object
 * rather than a YAML string. Every negative-control fixture below starts
 * from a fresh copy of this (never a shared reference — each `it` calls
 * `baseWorkflow()` itself) and mutates exactly the one thing under test, so
 * each test's actual deviation from "valid" is visible in its own body
 * instead of buried in a wall of copy-pasted YAML.
 */
function baseWorkflow(): CiWorkflow {
  return {
    on: {
      push: { branches: ["**"] },
      pull_request: { branches: ["main"] },
    },
    jobs: {
      test: {
        "runs-on": "ubuntu-latest",
        steps: [
          { uses: "actions/checkout@v4" },
          { uses: "actions/setup-node@v4", with: { "node-version": "20", cache: "npm" } },
          { name: "Install dependencies", run: "npm ci" },
          { name: "Typecheck all workspaces", run: "npm run typecheck --workspaces --if-present" },
          { name: "Unit / API / bundle tests", run: "npm test" },
        ],
      },
    },
  };
}

/**
 * The contract. Applied to the real workflow file (must hold) and, by the
 * negative-control tests below, to deliberately broken fixture objects
 * (must NOT hold) — proving these assertions aren't vacuously true.
 */
// A run command whose failure is swallowed via `|| true` / `|| exit 0` lets
// the gate report success even when the underlying command fails — just as
// effective a bypass as `continue-on-error`, so this is checked against the
// command text directly rather than relying on `continue-on-error` alone.
const FAILURE_SWALLOWED_PATTERN = /\|\|\s*(true|exit 0)\b/;

function assertCiWorkflowShape(workflow: CiWorkflow): void {
  const testJob = workflow.jobs?.test;
  expect(testJob).toBeDefined();
  // Deliberately not pinned to "ubuntu-latest": the runner label is not this
  // guard's concern (unlike release.yml's windows-2022, which is pinned for
  // a concrete electron-builder/native-rebuild reason) — a future move to a
  // dated runner (e.g. ubuntu-24.04) shouldn't fail a typecheck-gate guard.
  expect(testJob?.["runs-on"]).toBeTruthy();

  // A job-level continue-on-error would let every step's failure — including
  // typecheck's — pass silently, bypassing every step-level guard below.
  // continue-on-error also accepts an expression string (e.g. `${{ ... }}`),
  // not just a literal boolean, so this checks truthiness rather than
  // `=== true` — a non-empty string would otherwise slip past `.not.toBe(true)`.
  expect(testJob?.["continue-on-error"]).toBeFalsy();

  // The gate only bites if it actually runs on PRs into main; an unasserted
  // trigger is a silent gap a future edit could drop without any assertion
  // here noticing.
  expect(workflow.on?.pull_request?.branches).toContain("main");

  const steps = testJob?.steps ?? [];

  const installStep = steps.find((step) => step.run?.includes("npm ci"));
  expect(installStep).toBeDefined();

  // Phase 28: the typecheck gate must run the workspace-wide typecheck.
  const typecheckStep = steps.find((step) => step.run?.includes("typecheck --workspaces"));
  expect(typecheckStep).toBeDefined();

  // Semantic checks on the invariant ("typecheck runs and its failure isn't
  // swallowed"), not an exact-string pin on the command — a benign flag or
  // formatting change to the command shouldn't break this guard. Truthiness
  // (not `=== true`) for the same expression-string reason as the job-level
  // check above.
  expect(typecheckStep?.run).not.toMatch(FAILURE_SWALLOWED_PATTERN);
  expect(typecheckStep?.["continue-on-error"]).toBeFalsy();
  // A skip-triggering `if:` on the step is just as effective a bypass as
  // continue-on-error — GitHub Actions treats a skipped step as non-failing.
  expect(typecheckStep?.if).toBeUndefined();

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
  const workflow = loadWorkflowFile<CiWorkflow>(".github", "workflows", "ci.yml");

  it("parses as YAML with a test job", () => {
    expect(workflow.jobs?.test).toBeDefined();
  });

  it("satisfies the full Phase 28 install/typecheck/test contract", () => {
    assertCiWorkflowShape(workflow);
  });
});

describe("negative control: the pre-Phase-28 shape is rejected", () => {
  // Proves assertCiWorkflowShape can actually fail, and isn't a vacuous
  // pass no matter what ci.yml contains. Each fixture below is baseWorkflow()
  // with exactly one deviation applied, so the deviation under test is the
  // only thing to read in each `it` body.

  // Guards against every "toThrow" below being vacuously true: if
  // baseWorkflow() itself already failed assertCiWorkflowShape for some
  // unrelated reason, every negative control would pass regardless of
  // whether its own specific mutation was the actual cause.
  it("baseWorkflow() itself satisfies assertCiWorkflowShape with no mutation applied", () => {
    expect(() => assertCiWorkflowShape(baseWorkflow())).not.toThrow();
  });

  it("fails when the typecheck step is missing entirely (pre-Phase-28 shape)", () => {
    const workflow = baseWorkflow();
    workflow.jobs!.test!.steps = workflow.jobs!.test!.steps!.filter(
      (step) => !step.run?.includes("typecheck"),
    );

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when the typecheck step exists but runs after npm test (wrong order)", () => {
    const workflow = baseWorkflow();
    const steps = workflow.jobs!.test!.steps!;
    const typecheckIndex = steps.findIndex((step) => step.run?.includes("typecheck"));
    const [typecheckStep] = steps.splice(typecheckIndex, 1);
    steps.push(typecheckStep!);

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when runs-on is missing entirely (no runner means the job can't run at all)", () => {
    const workflow = baseWorkflow();
    delete workflow.jobs!.test!["runs-on"];

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when the typecheck step is marked continue-on-error (gate is neutered)", () => {
    const workflow = baseWorkflow();
    const typecheckStep = workflow.jobs!.test!.steps!.find((step) => step.run?.includes("typecheck"));
    typecheckStep!["continue-on-error"] = true;

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when continue-on-error is an expression string rather than a literal `true` (still neuters the gate)", () => {
    const workflow = baseWorkflow();
    const typecheckStep = workflow.jobs!.test!.steps!.find((step) => step.run?.includes("typecheck"));
    typecheckStep!["continue-on-error"] = "${{ always() }}";

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when the typecheck step's failure is swallowed (e.g. `|| true`)", () => {
    const workflow = baseWorkflow();
    const typecheckStep = workflow.jobs!.test!.steps!.find((step) => step.run?.includes("typecheck"));
    typecheckStep!.run += " || true";

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when the pull_request trigger no longer targets main (gate stops running on PRs)", () => {
    const workflow = baseWorkflow();
    delete workflow.on!.pull_request;

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when the test job is marked continue-on-error at the job level (every step's failure is swallowed)", () => {
    const workflow = baseWorkflow();
    workflow.jobs!.test!["continue-on-error"] = true;

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });

  it("fails when the typecheck step has a skip-triggering `if` (step can be silently skipped)", () => {
    const workflow = baseWorkflow();
    const typecheckStep = workflow.jobs!.test!.steps!.find((step) => step.run?.includes("typecheck"));
    typecheckStep!.if = "false";

    expect(() => assertCiWorkflowShape(workflow)).toThrow();
  });
});

/**
 * Phase 28 review finding: `--if-present` makes `npm run typecheck
 * --workspaces --if-present` silently skip any workspace whose package.json
 * has no `typecheck` script, rather than failing. `assertCiWorkflowShape`
 * above can only see that the *command* is invoked — it has no visibility
 * into whether every workspace still defines the script that command
 * depends on. If a future workspace ever drops that script, the gate would
 * pass vacuously for it: the exact silent-regression shape (Phase 23) this
 * whole guard exists to prevent, just one level down. This closes that hole
 * directly against the real package.json files.
 */
const WORKSPACES_WITH_TYPECHECK = [
  { name: "@toastmasters/core", dir: join(REPO_ROOT, "packages", "core") },
  { name: "@toastmasters/ui", dir: join(REPO_ROOT, "packages", "ui") },
  { name: "@toastmasters/desktop", dir: join(REPO_ROOT, "apps", "desktop") },
];

function assertHasTypecheckScript(pkg: { scripts?: Record<string, string> }): void {
  expect(pkg.scripts?.typecheck).toBeTruthy();
}

describe("every --if-present typecheck target still defines a typecheck script", () => {
  it.each(WORKSPACES_WITH_TYPECHECK)("$name's package.json declares scripts.typecheck", ({ dir }) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    assertHasTypecheckScript(pkg);
  });
});

describe("negative control: a workspace package.json missing scripts.typecheck is rejected", () => {
  it("fails when scripts.typecheck is absent (the exact --if-present silent-skip hole)", () => {
    const brokenPkg = { name: "@toastmasters/example", scripts: { build: "tsc" } };

    expect(() => assertHasTypecheckScript(brokenPkg)).toThrow();
  });

  it("fails when the package.json has no scripts section at all", () => {
    const brokenPkg: { scripts?: Record<string, string> } = {};

    expect(() => assertHasTypecheckScript(brokenPkg)).toThrow();
  });
});
