"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getMembers,
  refreshProgress,
  refreshMembership,
  type MemberSummary,
} from "@/lib/api";
import { MemberTable } from "@/components/MemberTable";
import { DiffSection } from "@/components/DiffSection";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Download, Loader2, RefreshCw } from "lucide-react";

export default function DashboardPage() {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshingProgress, setRefreshingProgress] = useState(false);
  const [refreshingMembership, setRefreshingMembership] = useState(false);

  useEffect(() => {
    getMembers()
      .then(setMembers)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function handleRefreshProgress() {
    setRefreshingProgress(true);
    const id = toast.loading("Fetching progress from Basecamp...");
    try {
      await refreshProgress();
      toast.success("Progress refreshed", { id });
      setError(null);
      setMembers(await getMembers());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message.split("\n")[0] : "Refresh failed",
        { id },
      );
    } finally {
      setRefreshingProgress(false);
    }
  }

  async function handleRefreshMembership() {
    setRefreshingMembership(true);
    const id = toast.loading("Downloading membership from TI...");
    try {
      await refreshMembership();
      toast.success("Membership refreshed", { id });
      setError(null);
      setMembers(await getMembers());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message.split("\n")[0] : "Refresh failed",
        { id },
      );
    } finally {
      setRefreshingMembership(false);
    }
  }

  const isRefreshing = refreshingProgress || refreshingMembership;

  function renderBody() {
    if (error)
      return (
        <Card>
          <CardHeader>
            <CardTitle>Error loading data</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      );

    if (!members)
      return (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      );

    if (members.length === 0)
      return (
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Use the refresh buttons above to fetch data.
            </p>
          </CardContent>
        </Card>
      );

    return (
      <>
        <MemberTable members={members} />
        <div className="mt-6">
          <DiffSection />
        </div>
      </>
    );
  }

  return (
    <main className="max-w-[960px] mx-auto py-8 px-4">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Toastmasters Dashboard</h1>
          {members !== null && (
            <p className="text-muted-foreground text-sm mt-1">
              {members.length} members
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshProgress}
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
            onClick={handleRefreshMembership}
            disabled={isRefreshing}
          >
            {refreshingMembership ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh Membership
          </Button>
          <a
            href="/api/membership-file"
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download className="h-4 w-4" />
            Membership CSV
          </a>
        </div>
      </div>
      {renderBody()}
    </main>
  );
}
