"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { getDiff, type DiffResult } from "@/lib/api";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

function fmtDate(iso: string) {
  return iso.slice(0, 10);
}

export function DiffSection() {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && diff === null && error === null) {
      setLoading(true);
      getDiff()
        .then(setDiff)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }

  const p = diff?.progress;
  const m = diff?.membership;
  const hasChanges =
    (p?.changes.length ?? 0) > 0 ||
    (m?.joined.length ?? 0) > 0 ||
    (m?.left.length ?? 0) > 0 ||
    (m?.statusChanged.length ?? 0) > 0;

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger render={
        <Button variant="outline" size="sm" className="gap-1.5">
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
          What changed?
        </Button>
      } />

      <CollapsibleContent className="mt-4 text-sm space-y-4">
        {loading && <p className="text-muted-foreground">Loading…</p>}

        {error && (
          <p className="text-destructive">
            {error.includes("SNAPSHOT_MISSING")
              ? "Need at least two snapshots — run fetch and membership twice."
              : error}
          </p>
        )}

        {diff && (
          <>
            <p className="text-muted-foreground">
              {fmtDate(p!.older)} → {fmtDate(p!.newer)}
            </p>

            {!hasChanges && (
              <p className="text-muted-foreground">No changes since last snapshot.</p>
            )}

            {p && p.changes.length > 0 && (
              <div>
                <p className="font-medium mb-1">Level advances</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {p.changes.map((c, i) => (
                    <li key={i}>
                      {c.firstName} {c.lastName}{" "}
                      <span className="text-foreground/50">({c.pathName})</span>
                      {" — "}gained {c.gained.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {m && m.joined.length > 0 && (
              <div>
                <p className="font-medium mb-1">Joined / renewed</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {m.joined.map((r, i) => (
                    <li key={i}>{r.name}</li>
                  ))}
                </ul>
              </div>
            )}

            {m && m.left.length > 0 && (
              <div>
                <p className="font-medium mb-1">Left / not in new export</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {m.left.map((r, i) => (
                    <li key={i}>{r.name}</li>
                  ))}
                </ul>
              </div>
            )}

            {m && m.statusChanged.length > 0 && (
              <div>
                <p className="font-medium mb-1">Status changed</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {m.statusChanged.map((r, i) => (
                    <li key={i}>
                      {r.name} — {r.oldStatus} → {r.newStatus}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
