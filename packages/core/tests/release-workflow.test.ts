import { describe, it, expect } from "vitest";
import { load as loadYaml } from "js-yaml";
import { loadWorkflowFile, type WorkflowStep, type WorkflowJob } from "./fixtures/workflow-shapes";

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
 * The valid, post-Phase-15 shape of release.yml's trigger/build-windows
 * contract, as a plain object rather than a YAML string — mirrors
 * ci-workflow.test.ts's baseWorkflow() idiom. Each negative control below
 * starts from a fresh copy (never a shared reference) and mutates exactly
 * the one thing under test, instead of restating the whole trigger/build
 * block per fixture.
 */
function baseReleaseWorkflow(): ReleaseWorkflow {
  return {
    on: {
      push: {
        tags: ["v[0-9]+.[0-9]+*", "[0-9]+.[0-9]+*"],
        branches: ["main"],
      },
      workflow_dispatch: null,
    },
    jobs: {
      "build-windows": {
        "runs-on": "windows-2022",
        steps: [
          { uses: "actions/setup-python@v5", with: { "python-version": "3.11" } },
          {
            name: "Publish GitHub Release",
            if: "startsWith(github.ref, 'refs/tags/')",
            uses: "softprops/action-gh-release@v2",
          },
          {
            name: "Publish rolling main pre-release",
            if: "github.ref == 'refs/heads/main'",
            uses: "softprops/action-gh-release@v2",
          },
        ],
      },
    },
  };
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

  // Phase 22 added a second, distinctly-purposed step whose `if` also
  // contains "refs/heads/main" (the new-tag Release), so this must also
  // require the `uses` match to land on *a* rolling-shaped publish step
  // rather than accidentally matching the tag-check/tag-push steps that
  // precede it in the file.
  const mainGatedStep = steps.find(
    (step) => step.if?.includes("refs/heads/main") && step.uses === "softprops/action-gh-release@v2",
  );
  expect(mainGatedStep).toBeDefined();
  expect(mainGatedStep?.uses).toBe("softprops/action-gh-release@v2");

  // The two publish steps must actually be different steps, not the same one
  // matched twice by a loose `if` check.
  expect(mainGatedStep).not.toBe(tagGatedStep);
}

describe("release.yml triggers and build job (Phase 15)", () => {
  const workflow = loadWorkflowFile<ReleaseWorkflow>(".github", "workflows", "release.yml");

  it("parses as YAML with an on.push section", () => {
    expect(workflow.on?.push).toBeDefined();
  });

  it("satisfies the full Phase 15 trigger/build/publish contract", () => {
    assertReleaseWorkflowShape(workflow);
  });
});

describe("negative control: broken/old trigger configs are rejected", () => {
  // Proves assertReleaseWorkflowShape can actually fail, and isn't a vacuous
  // pass no matter what release.yml contains. Each fixture below is
  // baseReleaseWorkflow() with exactly one deviation applied.

  // Guards against every "toThrow" below being vacuously true: if
  // baseReleaseWorkflow() itself already failed for an unrelated reason,
  // every negative control would pass regardless of its own mutation.
  it("baseReleaseWorkflow() itself satisfies assertReleaseWorkflowShape with no mutation applied", () => {
    expect(() => assertReleaseWorkflowShape(baseReleaseWorkflow())).not.toThrow();
  });

  it("fails when the push.branches: [main] trigger is missing (pre-Phase-15 shape)", () => {
    const workflow = baseReleaseWorkflow();
    delete workflow.on!.push!.branches;

    expect(() => assertReleaseWorkflowShape(workflow)).toThrow();
  });

  it("fails when runs-on has drifted to windows-latest instead of windows-2022", () => {
    const workflow = baseReleaseWorkflow();
    workflow.jobs!["build-windows"]!["runs-on"] = "windows-latest";

    expect(() => assertReleaseWorkflowShape(workflow)).toThrow();
  });

  it("fails when the rolling main pre-release step is missing entirely", () => {
    const workflow = baseReleaseWorkflow();
    workflow.jobs!["build-windows"]!.steps = workflow.jobs!["build-windows"]!.steps!.filter(
      (step) => step.name !== "Publish rolling main pre-release",
    );

    expect(() => assertReleaseWorkflowShape(workflow)).toThrow();
  });

  it("fails when setup-python is pinned to the wrong version", () => {
    const workflow = baseReleaseWorkflow();
    const setupPythonStep = workflow.jobs!["build-windows"]!.steps!.find(
      (step) => step.uses === "actions/setup-python@v5",
    );
    setupPythonStep!.with = { "python-version": "3.12" };

    expect(() => assertReleaseWorkflowShape(workflow)).toThrow();
  });
});

/**
 * Phase 22 structural invariant: automatic tag + Release on merge to main.
 *
 * `build-windows` gained three new steps between "Upload installer artifact"
 * and the pre-existing tag-triggered "Publish GitHub Release" step: a
 * `check-tag` step that reads the version and checks the remote for an
 * existing `v<version>` tag, a step that creates and pushes that tag when it
 * doesn't exist yet, and a step that publishes the versioned Release for it
 * directly in this same job (a tag pushed with the default GITHUB_TOKEN does
 * not itself re-trigger a workflow run). All three are gated on the same
 * `github.ref == 'refs/heads/main' && github.event_name == 'push'` guard the
 * Phase 15 rolling pre-release step uses, so a `workflow_dispatch` run never
 * auto-tags.
 */
function assertPhase22TagAutomationShape(workflow: ReleaseWorkflow): void {
  const buildJob = workflow.jobs?.["build-windows"];
  const steps = buildJob?.steps ?? [];

  const checkTagStep = steps.find((step) => step.id === "check-tag");
  expect(checkTagStep).toBeDefined();
  expect(checkTagStep?.if).toContain("refs/heads/main");
  expect(checkTagStep?.if).toContain("github.event_name == 'push'");
  expect(checkTagStep?.run).toContain("git ls-remote --tags origin");
  expect(checkTagStep?.run).toContain("package.json");

  const createTagStep = steps.find((step) =>
    step.if?.includes("steps.check-tag.outputs.new_tag == 'true'") && step.run?.includes("git tag"),
  );
  expect(createTagStep).toBeDefined();
  expect(createTagStep?.if).toContain("refs/heads/main");
  // Same guard as check-tag: a manual workflow_dispatch run from main also
  // reports github.ref == 'refs/heads/main', so relying on check-tag's output
  // alone is not enough defense-in-depth — this step's own `if` must
  // independently require the push event too (mirrors how Phase 15's rolling
  // pre-release step guards against workflow_dispatch false-triggering).
  expect(createTagStep?.if).toContain("github.event_name == 'push'");
  expect(createTagStep?.run).toContain("git push origin");

  const publishNewTagStep = steps.find(
    (step) =>
      step.if?.includes("steps.check-tag.outputs.new_tag == 'true'") &&
      step.uses === "softprops/action-gh-release@v2",
  );
  expect(publishNewTagStep).toBeDefined();
  expect(publishNewTagStep?.if).toContain("refs/heads/main");
  // Same reasoning as createTagStep above: this step also publishes a real,
  // non-prerelease GitHub Release, so its own guard must not rely solely on
  // check-tag's output having run correctly.
  expect(publishNewTagStep?.if).toContain("github.event_name == 'push'");
  expect(publishNewTagStep?.with?.generate_release_notes).toBe(true);
  expect(String(publishNewTagStep?.with?.tag_name ?? "")).toContain("check-tag.outputs.version");

  // Distinct from both the tag-push-triggered Release step and the rolling
  // main pre-release step — not the same step matched twice by a loose check.
  const tagPushStep = steps.find((step) =>
    step.if?.includes("startsWith(github.ref, 'refs/tags/')"),
  );
  expect(publishNewTagStep).not.toBe(tagPushStep);

  const rollingStep = steps.find(
    (step) =>
      step.if?.includes("refs/heads/main") &&
      step.uses === "softprops/action-gh-release@v2" &&
      step !== publishNewTagStep,
  );
  expect(rollingStep).toBeDefined();
  expect(publishNewTagStep).not.toBe(rollingStep);
}

describe("release.yml auto-tags and auto-releases on merge to main (Phase 22)", () => {
  const workflow = loadWorkflowFile<ReleaseWorkflow>(".github", "workflows", "release.yml");

  it("satisfies the full Phase 22 tag-check/create/publish contract", () => {
    assertPhase22TagAutomationShape(workflow);
  });
});

describe("negative control: the pre-Phase-22 shape is rejected", () => {
  it("fails when the tag-check/create/publish steps are missing entirely", () => {
    const preP22 = loadYaml(`
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
      - name: Upload installer artifact
        uses: actions/upload-artifact@v4
      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
      - name: Publish rolling main pre-release
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        uses: softprops/action-gh-release@v2
`) as ReleaseWorkflow;

    expect(() => assertPhase22TagAutomationShape(preP22)).toThrow();
  });

  it("fails when create-tag/publish-new-tag steps are present but their OWN guard drops the event_name half (weakened-guard regression)", () => {
    // All three Phase 22 steps exist, and check-tag's own guard is correct —
    // but createTagStep and publishNewTagStep rely ONLY on
    // `steps.check-tag.outputs.new_tag == 'true'` plus `refs/heads/main`,
    // dropping their own `github.event_name == 'push'` check. This is exactly
    // the kind of subtle regression Phase 15's guard tests exist to catch for
    // the rolling pre-release step (a workflow_dispatch run from main also
    // reports github.ref == 'refs/heads/main'), so the same defense-in-depth
    // is required here, independent of whatever check-tag's own guard did.
    const weakenedGuard = loadYaml(`
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
      - name: Upload installer artifact
        uses: actions/upload-artifact@v4
      - name: Check for an existing version tag
        id: check-tag
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: |
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          git ls-remote --tags origin "refs/tags/v$VERSION"
      - name: Create and push the version tag
        if: |
          github.ref == 'refs/heads/main' &&
          steps.check-tag.outputs.new_tag == 'true'
        run: |
          git tag -a "v-steps.check-tag.outputs.version" -m "Release"
          git push origin "v-steps.check-tag.outputs.version"
      - name: Publish GitHub Release for the new tag
        if: |
          github.ref == 'refs/heads/main' &&
          steps.check-tag.outputs.new_tag == 'true'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: "v-steps.check-tag.outputs.version"
          generate_release_notes: true
      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
      - name: Publish rolling main pre-release
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        uses: softprops/action-gh-release@v2
`) as ReleaseWorkflow;

    expect(() => assertPhase22TagAutomationShape(weakenedGuard)).toThrow();
  });
});
