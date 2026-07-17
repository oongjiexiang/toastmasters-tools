import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { load as loadYaml } from "js-yaml";

/**
 * Phase 27 structural invariant for the CI workflow.
 *
 * `.github/workflows/ci.yml`'s `test` job gained a "Typecheck workspaces"
 * step (`npm run typecheck --workspaces`) after the existing `npm ci` /
 * `npm test` steps. `npm test`'s vitest transpiles each file in isolation
 * and does not perform a project-wide `tsc --noEmit`, so a workspace can be
 * green under `npm test` and still fail a real typecheck — exactly the
 * Phase 23 `packages/ui` regression (a hoisted `typescript@6.x` failing
 * `tsc --noEmit` with TS5101), which slipped past validation until an
 * out-of-band typecheck run caught it. This test pins the fix down so it
 * can't be silently dropped from CI later.
 *
 * The step must live inside the SAME `test` job as the existing test step,
 * not a separate new job: branch protection only requires the `test` status
 * context (CONTRIBUTING.md), so a typecheck step added as its own job would
 * not actually be enforced without an out-of-band branch-protection change.
 *
 * No `--if-present`: that flag silently skips any workspace lacking a
 * `typecheck` script, which reintroduces the exact "green but unchecked"
 * failure mode this phase closes for a future workspace that forgets one.
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
const LOCKFILE_PATH = join(REPO_ROOT, "package-lock.json");

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

const TYPECHECK_RUN = "npm run typecheck --workspaces";

function stepRuns(step: WorkflowStep, command: string): boolean {
  return step.run?.trim().includes(command) ?? false;
}

/**
 * The contract. Applied to the real workflow file (must hold) and, by the
 * negative-control tests below, to deliberately broken fixture strings
 * (must NOT hold) — proving these assertions aren't vacuously true.
 */
function assertCiTypecheckGateShape(workflow: CiWorkflow): void {
  const jobs = workflow.jobs ?? {};

  // `test` must exist, but the file is free to gain unrelated sibling jobs
  // later (a coverage upload, a separate non-required lint job) without
  // breaking this guard — the real invariant below is about where the
  // typecheck command does and doesn't live, not the total job count.
  expect(jobs).toHaveProperty("test");

  const testJob = jobs.test;
  const steps = testJob?.steps ?? [];

  const installIndex = steps.findIndex((step) => stepRuns(step, "npm ci"));
  expect(installIndex).toBeGreaterThanOrEqual(0);

  const testStepIndex = steps.findIndex((step) => stepRuns(step, "npm test"));
  expect(testStepIndex).toBeGreaterThan(installIndex);

  const typecheckStepIndex = steps.findIndex((step) => stepRuns(step, TYPECHECK_RUN));
  expect(typecheckStepIndex).toBeGreaterThanOrEqual(0);

  // Order matters: typecheck must run after dependencies are installed, or
  // it fails every time regardless of whether the code actually typechecks.
  expect(typecheckStepIndex).toBeGreaterThan(installIndex);

  // The typecheck command must not live in any OTHER job. Branch protection
  // only requires the `test` status context, so a copy elsewhere would run
  // but never actually gate a merge — the kind of change that looks like a
  // fix (typecheck still "runs somewhere in CI") while quietly un-enforcing
  // the gate this phase exists to add.
  for (const [jobName, job] of Object.entries(jobs)) {
    if (jobName === "test") continue;
    const leaksElsewhere = (job.steps ?? []).some((step) => stepRuns(step, TYPECHECK_RUN));
    expect(leaksElsewhere).toBe(false);
  }
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
        run: npm run typecheck --workspaces
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
        run: npm run typecheck --workspaces
      - name: Install dependencies
        run: npm ci
      - name: Unit / API / bundle tests
        run: npm test
`) as CiWorkflow;

    expect(() => assertCiTypecheckGateShape(beforeInstall)).toThrow();
  });

  it("fails when the typecheck step is correctly in test but ALSO leaks into an unrelated job", () => {
    const leaked = loadYaml(`
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
      - name: Install dependencies
        run: npm ci
      - name: Unit / API / bundle tests
        run: npm test
      - name: Typecheck workspaces
        run: npm run typecheck --workspaces
  coverage-upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: npm ci
      - name: Typecheck workspaces
        run: npm run typecheck --workspaces
`) as CiWorkflow;

    expect(() => assertCiTypecheckGateShape(leaked)).toThrow();
  });
});

describe("a benign unrelated sibling job does not false-fail the guard", () => {
  // Proves the Phase 27 fix to the over-constrained `toEqual(["test"])` check:
  // a job that has nothing to do with typecheck (no matching step at all)
  // must not trip assertCiTypecheckGateShape, since the real invariant is
  // about where the typecheck command lives, not the total job count.
  it("passes when the test job is correct and an unrelated job exists alongside it", () => {
    const withSibling = loadYaml(`
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
      - name: Install dependencies
        run: npm ci
      - name: Unit / API / bundle tests
        run: npm test
      - name: Typecheck workspaces
        run: npm run typecheck --workspaces
  coverage-upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Upload coverage
        run: echo "no typecheck here"
`) as CiWorkflow;

    expect(() => assertCiTypecheckGateShape(withSibling)).not.toThrow();
  });
});

/**
 * Phase 27 dependency-resolution invariant.
 *
 * The CI-shape guard above only proves the `tsc` command runs; it says
 * nothing about which `typescript` actually gets resolved. The bug that
 * motivated this phase (Phase 23) was a hoisted `typescript@6.x` silently
 * breaking `packages/ui`'s typecheck, not a missing CI step — so this
 * guards the other half of the fix: the root `overrides.typescript` entry
 * (package.json) must keep every resolved `typescript` in the installed
 * tree pinned to a `5.x` major, however many workspaces or transitive
 * dependencies request it and whatever range they ask for.
 */

interface LockPackages {
  packages?: Record<string, { version?: string }>;
}

function assertEveryTypescriptResolutionIsV5(lock: LockPackages): void {
  const packages = lock.packages ?? {};
  const typescriptEntries = Object.entries(packages).filter(
    ([path]) => path === "node_modules/typescript" || path.endsWith("/node_modules/typescript"),
  );

  // At least one resolution must exist — an empty match means the filter
  // itself is broken (wrong key shape), not that there's nothing to check.
  expect(typescriptEntries.length).toBeGreaterThan(0);

  for (const [path, entry] of typescriptEntries) {
    expect(entry.version, `${path} has no recorded version`).toBeDefined();
    expect(entry.version?.startsWith("5."), `${path} resolved to ${entry.version}, expected a 5.x major`).toBe(true);
  }
}

describe("package-lock.json resolves every typescript to a 5.x version (Phase 27 pin invariant)", () => {
  const raw = readFileSync(LOCKFILE_PATH, "utf8");
  const lock = JSON.parse(raw) as LockPackages;

  it("the root override keeps the whole tree deduped onto a single 5.x typescript", () => {
    assertEveryTypescriptResolutionIsV5(lock);
  });
});

describe("negative control: a hoisted typescript@6.x is rejected", () => {
  it("fails when any resolved typescript entry is a 6.x major", () => {
    const brokenLock: LockPackages = {
      packages: {
        "": {},
        "node_modules/typescript": { version: "5.9.3" },
        "node_modules/some-nested-dep/node_modules/typescript": { version: "6.0.3" },
      },
    };

    expect(() => assertEveryTypescriptResolutionIsV5(brokenLock)).toThrow();
  });

  it("fails when there are no typescript resolutions at all (filter itself broken)", () => {
    const emptyLock: LockPackages = { packages: { "": {} } };

    expect(() => assertEveryTypescriptResolutionIsV5(emptyLock)).toThrow();
  });
});
