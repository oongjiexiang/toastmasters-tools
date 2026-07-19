/**
 * Shared minimal typings for parsed GitHub Actions workflow YAML, used by
 * release-workflow.test.ts and ci-workflow.test.ts so a field one of them
 * needs (e.g. `continue-on-error`, `id`, `if`) doesn't get added to only one
 * file and silently drift from the other.
 */

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { load as loadYaml } from "js-yaml";

// This file lives at packages/core/tests/fixtures/, four directories below
// the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

/** Read and YAML-parse a real workflow file, addressed relative to the repo root. */
export function loadWorkflowFile<T>(...repoRelativePathSegments: string[]): T {
  const raw = readFileSync(join(REPO_ROOT, ...repoRelativePathSegments), "utf8");
  return loadYaml(raw) as T;
}

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
