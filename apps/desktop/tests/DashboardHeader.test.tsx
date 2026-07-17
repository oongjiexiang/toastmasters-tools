// @vitest-environment jsdom
//
// Phase 25 item 1 (see specs/roadmap.md "## Phase 25"): DashboardHeader gained
// a `latestSnapshotAt` prop that drives a data-freshness note next to the
// member count — "Never refreshed" on a fresh install, "Updated N days ago"
// otherwise, switching to an amber treatment once the snapshot is older than
// the fixed 21-day threshold.
//
// `packages/ui` has no test directory of its own (confirmed by discovery);
// its components are exercised directly from the desktop app's test suite,
// same pattern as `LevelAccordion.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardHeader } from "@toastmasters/ui/components/DashboardHeader";

const NOW = new Date("2026-07-17T12:00:00.000Z");

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function renderHeader(latestSnapshotAt: string | null) {
  render(
    <DashboardHeader
      memberCount={38}
      latestSnapshotAt={latestSnapshotAt}
      refreshingProgress={false}
      refreshingMembership={false}
      onRefreshProgress={vi.fn()}
      onRefreshMembership={vi.fn()}
      membershipCsvControl={null}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardHeader — data-freshness note next to the member count (Phase 25 item 1)", () => {
  it("renders the member count alongside a relative 'Updated N days ago' note for a recent snapshot", () => {
    renderHeader(isoDaysAgo(3));

    expect(screen.getByText(/38 members/)).toBeInTheDocument();
    expect(screen.getByText("Updated 3 days ago")).toBeInTheDocument();
  });

  it("renders 'Updated today' for a snapshot captured moments ago", () => {
    renderHeader(isoDaysAgo(0));

    expect(screen.getByText("Updated today")).toBeInTheDocument();
  });

  it("renders 'Never refreshed' — not a blank or invalid date — when there is no snapshot at all", () => {
    renderHeader(null);

    expect(screen.getByText("Never refreshed")).toBeInTheDocument();
    // Negative control: must not render something date-shaped like "Invalid
    // Date" or "NaN days ago" for the null case.
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("renders the amber treatment when the snapshot is older than the 21-day threshold", () => {
    renderHeader(isoDaysAgo(22));

    const note = screen.getByText("Updated 22 days ago");
    expect(note.className).toContain("text-amber-600");
  });

  it("does NOT render the amber treatment exactly at the 21-day threshold (negative control)", () => {
    // The spec's threshold is "older than 21 days" — exactly 21 days must
    // stay in the default (non-amber) treatment. A `days > 21` vs `days >= 21`
    // regression would trip this assertion.
    renderHeader(isoDaysAgo(21));

    const note = screen.getByText("Updated 21 days ago");
    expect(note.className).not.toContain("text-amber-600");
  });

  it("does NOT render the amber treatment for a snapshot well inside the threshold (negative control)", () => {
    renderHeader(isoDaysAgo(10));

    const note = screen.getByText("Updated 10 days ago");
    expect(note.className).not.toContain("text-amber-600");
  });

  it("renders the amber treatment just one day over the threshold", () => {
    renderHeader(isoDaysAgo(22));

    const note = screen.getByText("Updated 22 days ago");
    expect(note.className).toContain("text-amber-600");
    expect(note.className).toContain("dark:text-amber-400");
  });
});
