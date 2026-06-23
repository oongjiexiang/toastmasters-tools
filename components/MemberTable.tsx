"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown, Trophy, Flag } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { MemberSummary, PathwaySummary } from "@/lib/api";

function TitleBadge({ title }: { title: string }) {
  if (!title) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge className="bg-blue-100 text-blue-800 font-mono text-xs">
      {title}
    </Badge>
  );
}

function RemainingCell({ pw }: { pw: PathwaySummary }) {
  if (pw.status === "completed") {
    return (
      <span className="text-green-700 flex items-center gap-1">
        <Trophy size={14} />
        Completed
      </span>
    );
  }
  if (pw.status === "ready") {
    return (
      <Badge className="bg-amber-100 text-amber-800 gap-1">
        <Flag size={12} />
        Ready
      </Badge>
    );
  }
  if (pw.status === "close") {
    return <span className="text-amber-600">● {pw.remaining}</span>;
  }
  return <span>{pw.remaining > 0 ? pw.remaining : "—"}</span>;
}

interface MemberTableProps {
  members: MemberSummary[];
}

export function MemberTable({ members }: MemberTableProps) {
  const router = useRouter();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  function toggleExpand(email: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>NAME</TableHead>
          <TableHead>TITLE</TableHead>
          <TableHead>PATHWAY</TableHead>
          <TableHead>NEXT LEVEL</TableHead>
          <TableHead>REMAINING</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => {
          const isSingle = m.pathways.length === 1;
          const isExpanded = expandedRows.has(m.email);

          if (isSingle) {
            const pw = m.pathways[0];
            return (
              <TableRow
                key={m.email}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() =>
                  router.push(
                    `/members/${encodeURIComponent(m.email)}?pathway=${encodeURIComponent(pw.pathway)}`,
                  )
                }
              >
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell>
                  {m.title ? (
                    <Badge className="bg-blue-100 text-blue-800">{m.title}</Badge>
                  ) : (
                    <span />
                  )}
                </TableCell>
                <TableCell>
                  <span className="truncate max-w-[200px] block">{pw.pathway}</span>
                </TableCell>
                <TableCell>{pw.nextLevel}</TableCell>
                <TableCell>
                  <RemainingCell pw={pw} />
                </TableCell>
              </TableRow>
            );
          }

          // Multi-pathway member
          const rows: React.ReactNode[] = [];

          rows.push(
            <TableRow key={m.email}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => toggleExpand(m.email, e)}
                    className="p-0.5 hover:bg-muted rounded"
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                  {m.name}
                </div>
              </TableCell>
              <TableCell>
                <TitleBadge title={m.title} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {m.pathways.length} pathways
              </TableCell>
              <TableCell>—</TableCell>
              <TableCell>—</TableCell>
            </TableRow>,
          );

          if (isExpanded) {
            m.pathways.forEach((pw) => {
              rows.push(
                <TableRow key={`${m.email}-${pw.pathway}`} className="bg-muted/30">
                  <TableCell className="pl-8 text-muted-foreground">
                    └ {pw.pathway}
                  </TableCell>
                  <TableCell>
                    <TitleBadge title={pw.title} />
                  </TableCell>
                  <TableCell>
                    <span className="truncate max-w-[200px] block">{pw.pathway}</span>
                  </TableCell>
                  <TableCell>{pw.nextLevel}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <RemainingCell pw={pw} />
                      <button
                        onClick={() =>
                          router.push(
                            `/members/${encodeURIComponent(m.email)}?pathway=${encodeURIComponent(pw.pathway)}`,
                          )
                        }
                        className="text-xs text-blue-600 hover:underline cursor-pointer"
                      >
                        details →
                      </button>
                    </div>
                  </TableCell>
                </TableRow>,
              );
            });
          }

          return rows;
        })}
      </TableBody>
    </Table>
  );
}
