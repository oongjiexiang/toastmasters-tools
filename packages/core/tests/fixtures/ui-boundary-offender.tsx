/**
 * Deliberately broken fixture for the "packages/ui stays desktop-agnostic"
 * negative control in packages/core/tests/workspace.test.ts (Phase 21).
 *
 * This file is never imported by real code and lives outside packages/ui on
 * purpose — it exists solely to prove the module-boundary guard actually
 * fails closed on an offending import, rather than passing only because the
 * current packages/ui source tree happens to be clean. Do not import this
 * file from anywhere; it is scanned as text by workspace.test.ts, never
 * compiled or executed.
 */
import { app } from "electron";
import { openLoginWindow } from "../../../apps/desktop/src/main/auth";

export function offender() {
  return { app, openLoginWindow };
}
