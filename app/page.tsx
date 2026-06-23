"use client";

import { useEffect, useState } from "react";
import { getMembers, type MemberSummary } from "@/lib/api";
import { MemberTable } from "@/components/MemberTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMembers()
      .then(setMembers)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error)
    return (
      <main className="max-w-[960px] mx-auto py-8 px-4">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive">{error}</p>
            <p className="text-muted-foreground text-sm mt-2">
              Run <code>npm run fetch</code> and <code>npm run membership</code>{" "}
              first, then refresh.
            </p>
          </CardContent>
        </Card>
      </main>
    );

  if (!members)
    return (
      <main className="max-w-[960px] mx-auto py-8 px-4">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </main>
    );

  if (members.length === 0)
    return (
      <main className="max-w-[960px] mx-auto py-8 px-4">
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Run{" "}
              <code className="text-sm bg-muted px-1 rounded">npm run fetch</code>{" "}
              then{" "}
              <code className="text-sm bg-muted px-1 rounded">
                npm run membership
              </code>
              , then refresh.
            </p>
          </CardContent>
        </Card>
      </main>
    );

  return (
    <main className="max-w-[960px] mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Toastmasters Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {members.length} members
        </p>
      </div>
      <MemberTable members={members} />
    </main>
  );
}
