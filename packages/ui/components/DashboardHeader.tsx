"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardHeaderProps {
  /** null while the member list is still loading. */
  memberCount: number | null;
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
}

export function DashboardHeader({
  memberCount,
  refreshingProgress,
  refreshingMembership,
  onRefreshProgress,
  onRefreshMembership,
  membershipCsvControl,
  authControl,
}: DashboardHeaderProps) {
  const isRefreshing = refreshingProgress || refreshingMembership;

  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold">Toastmasters Dashboard</h1>
        {memberCount !== null && (
          <p className="text-muted-foreground text-sm mt-1">
            {memberCount} members
          </p>
        )}
      </div>
      <div className="flex gap-2 flex-wrap justify-end">
        {authControl}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshProgress}
          disabled={isRefreshing}
        >
          {refreshingProgress ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Progress
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshMembership}
          disabled={isRefreshing}
        >
          {refreshingMembership ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Membership
        </Button>
        {membershipCsvControl}
      </div>
    </div>
  );
}
