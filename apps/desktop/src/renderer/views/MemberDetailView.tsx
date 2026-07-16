import { useEffect, useState } from "react";
import { LevelAccordion } from "@/components/LevelAccordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getMember, type MemberDetail } from "../lib/api";

interface MemberDetailViewProps {
  email: string;
  pathway: string;
  onBack: () => void;
}

export function MemberDetailView({ email, pathway, onBack }: MemberDetailViewProps) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pathway) {
      setError("No pathway specified.");
      return;
    }
    getMember(email, pathway)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [email, pathway]);

  const backButton = (
    <Button variant="link" className="mb-4 px-0" onClick={onBack}>
      ← Back to dashboard
    </Button>
  );

  if (error)
    return (
      <main className="max-w-[960px] mx-auto py-8 px-4">
        {backButton}
        <Card>
          <CardHeader>
            <CardTitle>Member not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </main>
    );

  if (!detail)
    return (
      <main className="max-w-[960px] mx-auto py-8 px-4">
        {backButton}
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </main>
    );

  const approvedCount = detail.levels.filter((l) => l.approved).length;

  return (
    <main className="max-w-[960px] mx-auto py-8 px-4">
      {backButton}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-semibold">{detail.name}</h1>
          {detail.title && (
            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 font-mono">
              {detail.title}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          {detail.pathway} · Path progress: {approvedCount} of{" "}
          {detail.levels.filter((l) => l.level !== "Path Completion").length} levels approved
        </p>
      </div>
      <LevelAccordion levels={detail.levels} />
    </main>
  );
}
