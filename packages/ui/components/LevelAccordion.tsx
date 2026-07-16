"use client";

import { useState } from "react";
import { CircleCheck, Flag, CircleDot, Circle } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ExpandCollapseToggle } from "@/components/ExpandCollapseToggle";
import { ProjectRow } from "@/components/ProjectRow";
import type { LevelGroup } from "@toastmasters/core/queries";

type LevelStatus = "approved" | "ready" | "in-progress" | "not-started";

function levelStatus(g: LevelGroup): LevelStatus {
  if (g.approved) return "approved";
  if (g.projectsTotal > 0 && g.projectsDone === g.projectsTotal) return "ready";
  if (g.projectsDone > 0) return "in-progress";
  return "not-started";
}

function StatusBadge({ status }: { status: LevelStatus }) {
  switch (status) {
    case "approved":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 gap-1">
          <CircleCheck size={12} />
          Approved
        </Badge>
      );
    case "ready":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 gap-1">
          <Flag size={12} />
          Ready to approve
        </Badge>
      );
    case "in-progress":
      return (
        <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 gap-1">
          <CircleDot size={12} />
          In progress
        </Badge>
      );
    case "not-started":
      return (
        <Badge className="bg-muted text-muted-foreground gap-1">
          <Circle size={12} />
          Not started
        </Badge>
      );
  }
}

interface LevelAccordionProps {
  levels: LevelGroup[];
}

export function LevelAccordion({ levels }: LevelAccordionProps) {
  const allIds = levels.map((l) => l.level);
  const [openItems, setOpenItems] = useState<string[]>(allIds);
  const anyOpen = openItems.length > 0;

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <ExpandCollapseToggle
          expanded={anyOpen}
          onToggle={() => setOpenItems(anyOpen ? [] : allIds)}
        />
      </div>
      <Accordion value={openItems} onValueChange={setOpenItems} multiple>
        {levels.map((level) => {
          const status = levelStatus(level);
          return (
            <AccordionItem key={level.level} value={level.level}>
              <AccordionTrigger>
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{level.level}</span>
                  <StatusBadge status={status} />
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground text-sm">
                    {level.projectsDone}/{level.projectsTotal} complete
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {level.projects.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-2 px-1">
                    No project data for this level. Run{" "}
                    <code className="bg-muted px-1 rounded text-xs">
                      npm run fetch
                    </code>{" "}
                    to refresh.
                  </p>
                ) : (
                  <div className="divide-y">
                    {level.projects.map((project, i) => (
                      <ProjectRow
                        key={i}
                        lesson={project.lesson}
                        complete={project.complete}
                        type={project.type}
                      />
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
