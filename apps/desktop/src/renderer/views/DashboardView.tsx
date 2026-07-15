import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { MemberTable } from "@/components/MemberTable";
import { DiffSection } from "@/components/DiffSection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  downloadMembershipCsv,
  getDiff,
  getMembers,
  refreshMembership,
  refreshProgress,
  type MemberSummary,
} from "../lib/api";

interface DashboardViewProps {
  onSelectMember: (email: string, pathway: string) => void;
}

export function DashboardView({ onSelectMember }: DashboardViewProps) {
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

  async function handleDownloadCsv() {
    try {
      const savedTo = await downloadMembershipCsv();
      if (savedTo) toast.success(`Saved to ${savedTo}`);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message.split("\n")[0] : "Download failed",
      );
    }
  }

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
        <MemberTable members={members} onSelectMember={onSelectMember} />
        <div className="mt-6">
          <DiffSection loadDiff={getDiff} />
        </div>
      </>
    );
  }

  return (
    <main className="max-w-[960px] mx-auto py-8 px-4">
      <DashboardHeader
        memberCount={members?.length ?? null}
        refreshingProgress={refreshingProgress}
        refreshingMembership={refreshingMembership}
        onRefreshProgress={handleRefreshProgress}
        onRefreshMembership={handleRefreshMembership}
        membershipCsvControl={
          <Button variant="outline" size="sm" onClick={handleDownloadCsv}>
            <Download className="h-4 w-4" />
            Membership CSV
          </Button>
        }
      />
      {renderBody()}
    </main>
  );
}
