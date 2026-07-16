import type { AuthStatus } from "../../shared/ipc";

export type AuthStatusLabel = "Logged in" | "Not logged in" | "Basecamp only" | "TI only";

/**
 * Maps a raw {@link AuthStatus} (or its absence, before the first status load
 * completes) into a short label for the DashboardHeader badge. Kept as a pure
 * function — no React, no DOM — so it is unit-testable without jsdom/RTL,
 * neither of which this repo depends on (see apps/desktop's vitest.config.ts,
 * `environment: "node"`).
 */
export function describeAuthStatus(status: AuthStatus | null): AuthStatusLabel {
  if (!status) return "Not logged in";
  if (status.basecamp && status.ti) return "Logged in";
  if (status.basecamp) return "Basecamp only";
  if (status.ti) return "TI only";
  return "Not logged in";
}
