// @vitest-environment jsdom
//
// Phase 19 validation item 3 (see specs/roadmap.md "## Phase 19"):
// LevelAccordion's separate "Expand all"/"Collapse all" button pair (Phase 3)
// was replaced with a single button that flips label with state. Default
// render must stay all-expanded — that is Phase 3's documented behaviour and
// must not regress silently.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LevelAccordion } from "@toastmasters/ui/components/LevelAccordion";
import type { LevelGroup } from "@toastmasters/core/queries";

const levels: LevelGroup[] = [
  {
    level: "Level 1",
    approved: true,
    projectsDone: 2,
    projectsTotal: 2,
    projects: [{ lesson: "Ice Breaker", complete: true, type: "Core" }],
  },
  {
    level: "Level 2",
    approved: false,
    projectsDone: 1,
    projectsTotal: 3,
    projects: [{ lesson: "Evaluation", complete: true, type: "Core" }],
  },
];

describe("LevelAccordion — single expand/collapse-all toggle (Phase 19 item 3)", () => {
  it("renders all-expanded by default (Phase 3 behaviour must not regress)", () => {
    render(<LevelAccordion levels={levels} />);

    // Every level's project content is visible without any interaction.
    expect(screen.getByText("Ice Breaker")).toBeVisible();
    expect(screen.getByText("Evaluation")).toBeVisible();
  });

  it("renders exactly one toggle button, not two", () => {
    render(<LevelAccordion levels={levels} />);

    const toggles = screen.getAllByRole("button", {
      name: /^(Expand all|Collapse all)$/,
    });
    expect(toggles).toHaveLength(1);
  });

  it("clicking the toggle when all are open switches its label to 'Expand all' and collapses everything", () => {
    render(<LevelAccordion levels={levels} />);

    const toggle = screen.getByRole("button", { name: "Collapse all" });
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
    expect(screen.queryByText("Ice Breaker")).not.toBeInTheDocument();
    expect(screen.queryByText("Evaluation")).not.toBeInTheDocument();
  });

  it("clicking again switches the label back to 'Collapse all' and re-expands everything", () => {
    render(<LevelAccordion levels={levels} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();
    expect(screen.getByText("Ice Breaker")).toBeVisible();
    expect(screen.getByText("Evaluation")).toBeVisible();
  });
});
