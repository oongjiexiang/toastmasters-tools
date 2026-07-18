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
  "continue-on-error"?: boolean;
}

export interface WorkflowJob {
  "runs-on"?: string;
  steps?: WorkflowStep[];
}
