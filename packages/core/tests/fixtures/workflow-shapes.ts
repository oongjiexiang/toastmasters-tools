/**
 * Shared minimal typings for parsed GitHub Actions workflow YAML, used by
 * release-workflow.test.ts and ci-workflow.test.ts so a field one of them
 * needs (e.g. `continue-on-error`, `id`, `if`) doesn't get added to only one
 * file and silently drift from the other.
 */

export interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  run?: string;
  // GitHub Actions accepts either a literal boolean or an expression string
  // (e.g. `${{ always() }}`) here — both are truthy in a way a strict
  // `=== true` check would miss for the string case.
  "continue-on-error"?: boolean | string;
}

export interface WorkflowJob {
  "runs-on"?: string;
  steps?: WorkflowStep[];
  "continue-on-error"?: boolean | string;
}
