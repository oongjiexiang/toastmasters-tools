"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Trophy, Flag, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ExpandCollapseToggle } from "@/components/ExpandCollapseToggle";
import type { MemberSummary, PathwaySummary } from "@toastmasters/core/queries";

function TitleBadge({ title }: { title: string }) {
  if (!title) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 font-mono text-xs">
      {title}
    </Badge>
  );
}

function RemainingCell({ pw }: { pw: PathwaySummary }) {
  if (pw.status === "completed") {
    return (
      <span className="text-green-700 dark:text-green-400 flex items-center gap-1">
        <Trophy size={14} />
        Completed
      </span>
    );
  }
  if (pw.status === "ready") {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 gap-1">
        <Flag size={12} />
        Ready
      </Badge>
    );
  }
  if (pw.status === "close") {
    return <span className="text-amber-600 dark:text-amber-400">● {pw.remaining}</span>;
  }
  return <span>{pw.remaining > 0 ? pw.remaining : "—"}</span>;
}

/** Fires `action` on Enter/Space, matching native `<button>` activation
 *  semantics for the whole-row click targets (rows are not real buttons). */
function handleActivateKeyDown(e: React.KeyboardEvent, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

interface MemberTableProps {
  members: MemberSummary[];
  /**
   * Navigation is injected rather than performed here: the old web app (removed
   * in Phase 14) pushed a route; the Electron renderer (Phase 11) swaps its own
   * view state instead. Calling `useRouter()` in this component would bind it
   * to `next/navigation`, which does not exist in the desktop app's plain Vite
   * renderer.
   */
  onSelectMember: (email: string, pathway: string) => void;
}

export function MemberTable({ members, onSelectMember }: MemberTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  function toggleExpand(email: string) {
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

  const trimmedQuery = query.trim();
  const filteredMembers = trimmedQuery
    ? members.filter((m) =>
        m.name.toLowerCase().includes(trimmedQuery.toLowerCase()),
      )
    : members;

  // Expand-all and the dead-control guard operate on the filtered list, not
  // the full one: a member hidden by the search has no visible row to
  // expand, and their extra pathways shouldn't keep the toggle alive.
  const multiPathwayEmails = filteredMembers
    .filter((m) => m.pathways.length > 1)
    .map((m) => m.email);
  const hasMultiPathway = multiPathwayEmails.length > 0;
  const anyExpanded = expandedRows.size > 0;

  function toggleExpandAll() {
    setExpandedRows(anyExpanded ? new Set() : new Set(multiPathwayEmails));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full max-w-xs">
          <Input
            type="text"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search members by name"
            className={query ? "pr-7" : undefined}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted cursor-pointer text-muted-foreground"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {filteredMembers.length} of {members.length} members
        </span>
        {hasMultiPathway && (
          <ExpandCollapseToggle expanded={anyExpanded} onToggle={toggleExpandAll} />
        )}
      </div>
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
          {filteredMembers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground py-6"
              >
                No members match &quot;{trimmedQuery}&quot;
              </TableCell>
            </TableRow>
          ) : (
            filteredMembers.map((m) => {
              const isSingle = m.pathways.length === 1;
              const isExpanded = expandedRows.has(m.email);

              if (isSingle) {
                const pw = m.pathways[0];
                return (
                  <TableRow
                    key={m.email}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onSelectMember(m.email, pw.pathway)}
                    onKeyDown={(e) =>
                      handleActivateKeyDown(e, () => onSelectMember(m.email, pw.pathway))
                    }
                    tabIndex={0}
                    role="button"
                  >
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>
                      {m.title ? (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                          {m.title}
                        </Badge>
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
                <TableRow
                  key={m.email}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleExpand(m.email)}
                  onKeyDown={(e) => handleActivateKeyDown(e, () => toggleExpand(m.email))}
                  tabIndex={0}
                  role="button"
                  aria-expanded={isExpanded}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          // The chevron sits inside the now-clickable row; stop
                          // the click from bubbling up so the row's own onClick
                          // (the same toggle) doesn't also fire — otherwise a
                          // single chevron click would toggle twice.
                          e.stopPropagation();
                          toggleExpand(m.email);
                        }}
                        className="p-0.5 hover:bg-muted rounded cursor-pointer"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                        tabIndex={-1}
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
                    <TableRow
                      key={`${m.email}-${pw.pathway}`}
                      className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                      onClick={() => onSelectMember(m.email, pw.pathway)}
                      onKeyDown={(e) =>
                        handleActivateKeyDown(e, () => onSelectMember(m.email, pw.pathway))
                      }
                      tabIndex={0}
                      role="button"
                    >
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
                        <RemainingCell pw={pw} />
                      </TableCell>
                    </TableRow>,
                  );
                });
              }

              return rows;
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
