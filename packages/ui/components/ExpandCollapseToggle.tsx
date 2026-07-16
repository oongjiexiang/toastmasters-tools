"use client";

import { Button } from "@/components/ui/button";

interface ExpandCollapseToggleProps {
  /** Whether the controlled set is currently (at least partly) expanded. */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * A single button that flips between "Expand all" and "Collapse all" based on
 * the caller's current expansion state, rather than two separate buttons
 * (Phase 19, item 3). Shared between `LevelAccordion` (the detail page's
 * per-level accordion) and `MemberTable` (the overview's per-member
 * multi-pathway rows) so the toggle label/logic isn't duplicated.
 */
export function ExpandCollapseToggle({
  expanded,
  onToggle,
}: ExpandCollapseToggleProps) {
  return (
    <Button variant="outline" size="sm" onClick={onToggle}>
      {expanded ? "Collapse all" : "Expand all"}
    </Button>
  );
}
