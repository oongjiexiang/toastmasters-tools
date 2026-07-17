"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

/** Snapshots older than this (in days) render the freshness note in amber. */
const STALE_THRESHOLD_DAYS = 21;

/**
 * Renders the data-freshness note next to the member count: "Never
 * refreshed" on a fresh install with no snapshot at all, otherwise a
 * day-granularity relative time ("Updated N days ago" / "Updated today").
 * Amber when the snapshot is older than `STALE_THRESHOLD_DAYS`.
 */
function FreshnessNote({ latestSnapshotAt }: { latestSnapshotAt: string | null }) {
  if (latestSnapshotAt === null) {
    return <span>Never refreshed</span>;
  }

  const capturedAt = new Date(latestSnapshotAt);
  if (isNaN(capturedAt.getTime())) {
    return <span>Never refreshed</span>;
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.max(0, Math.floor((Date.now() - capturedAt.getTime()) / msPerDay));

  let label: string;
  if (days === 0) label = "Updated today";
  else if (days === 1) label = "Updated 1 day ago";
  else label = `Updated ${days} days ago`;

  const isStale = days > STALE_THRESHOLD_DAYS;

  return (
    <span className={isStale ? "text-amber-600 dark:text-amber-400" : undefined}>{label}</span>
  );
}

interface DashboardHeaderProps {
  /** null while the member list is still loading. */
  memberCount: number | null;
  /**
   * The most recent snapshot's timestamp (ISO 8601), or `null` when no
   * snapshot has ever been captured. Drives the "Updated N days ago" /
   * "Never refreshed" note next to the member count (Phase 25, item 1).
   */
  latestSnapshotAt: string | null;
  refreshingProgress: boolean;
  refreshingMembership: boolean;
  onRefreshProgress: () => void;
  onRefreshMembership: () => void;
  /**
   * Slot for the membership-CSV control: the now-removed web app (Phase 14)
   * rendered a download anchor here; the Electron renderer passes a button that
   * saves the file over IPC. Everything else in the header is identical, so
   * only the differing element is injected.
   */
  membershipCsvControl: React.ReactNode;
  /**
   * Optional slot for an auth control (the Electron "Log in" button). Was
   * undefined for the now-removed web app (Phase 14) — a browser cannot
   * harvest cross-origin cookies, so that build never had anything to inject
   * here. The desktop renderer always supplies it.
   */
  authControl?: React.ReactNode;
  /**
   * Optional slot for the light/dark/system theme toggle (Phase 19, item 6).
   * Mirrors `authControl` above: undefined for any consumer that has no
   * theme control to inject.
   */
  themeControl?: React.ReactNode;
}

export function DashboardHeader({
  memberCount,
  latestSnapshotAt,
  refreshingProgress,
  refreshingMembership,
  onRefreshProgress,
  onRefreshMembership,
  membershipCsvControl,
  authControl,
  themeControl,
}: DashboardHeaderProps) {
  const isRefreshing = refreshingProgress || refreshingMembership;

  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold">Toastmasters Dashboard</h1>
        {memberCount !== null && (
          <p className="text-muted-foreground text-sm mt-1">
            {memberCount} members · <FreshnessNote latestSnapshotAt={latestSnapshotAt} />
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap justify-end">
        {authControl && <div className="flex items-center gap-2">{authControl}</div>}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefreshProgress} disabled={isRefreshing}>
            {refreshingProgress ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh Progress
          </Button>
          <Button variant="outline" size="sm" onClick={onRefreshMembership} disabled={isRefreshing}>
            {refreshingMembership ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh Membership
          </Button>
        </div>
        {(membershipCsvControl || themeControl) && (
          <>
            <Separator className="hidden sm:block" />
            <div className="flex items-center gap-2">
              {membershipCsvControl}
              {themeControl}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
