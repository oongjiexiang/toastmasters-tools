// @vitest-environment jsdom
//
// Phase 19 validation items 2 and 4 (see specs/roadmap.md "## Phase 19").
// Covers: whole-row click targets in MemberTable (parent toggles, child
// navigates, chevron double-fire negative control, keyboard activation) and
// the dead-control guard for the overview's expand/collapse-all toggle.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemberTable } from "@toastmasters/ui/components/MemberTable";
import type { MemberSummary, PathwaySummary } from "@toastmasters/core/queries";

function pathway(overrides: Partial<PathwaySummary> = {}): PathwaySummary {
  return {
    pathway: "Motivational Strategies",
    title: "PM1",
    nextLevel: "Level 2",
    remaining: 3,
    status: "in-progress",
    ...overrides,
  };
}

const singlePathwayMember: MemberSummary = {
  email: "single@example.com",
  name: "Single Path",
  title: "PM1",
  pathways: [pathway({ pathway: "Motivational Strategies" })],
};

const multiPathwayMember: MemberSummary = {
  email: "multi@example.com",
  name: "Multi Path",
  title: "DTM",
  pathways: [
    pathway({ pathway: "Dynamic Leadership", title: "DL3" }),
    pathway({ pathway: "Engaging Humor", title: "EH2" }),
  ],
};

describe("MemberTable — whole-row click targets (Phase 19 item 2)", () => {
  it("clicking anywhere on a multi-pathway parent row toggles expansion and does not navigate", () => {
    const onSelectMember = vi.fn();
    render(
      <MemberTable members={[multiPathwayMember]} onSelectMember={onSelectMember} />,
    );

    // Collapsed by default: child rows are not in the DOM yet.
    expect(screen.queryByText("Dynamic Leadership")).not.toBeInTheDocument();

    const parentRow = screen.getByText("Multi Path").closest("tr")!;
    fireEvent.click(parentRow);

    expect(screen.getByText("Dynamic Leadership")).toBeInTheDocument();
    expect(onSelectMember).not.toHaveBeenCalled();
  });

  it("clicking a child (per-pathway) row calls onSelectMember with that exact email+pathway", () => {
    const onSelectMember = vi.fn();
    render(
      <MemberTable members={[multiPathwayMember]} onSelectMember={onSelectMember} />,
    );

    // Expand first.
    fireEvent.click(screen.getByText("Multi Path").closest("tr")!);

    const childRow = screen
      .getByText("Engaging Humor", { selector: "span" })
      .closest("tr")!;
    fireEvent.click(childRow);

    expect(onSelectMember).toHaveBeenCalledTimes(1);
    expect(onSelectMember).toHaveBeenCalledWith("multi@example.com", "Engaging Humor");
  });

  it("clicking the chevron toggles expansion exactly once, not twice (stopPropagation negative control)", () => {
    // If someone removes `e.stopPropagation()` from the chevron's onClick,
    // the click bubbles to the row's own onClick and the row toggles a
    // *second* time — net no-op, so the row would stay collapsed after one
    // click. This test fails against that regression because it asserts the
    // row IS expanded after a single chevron click.
    const onSelectMember = vi.fn();
    render(
      <MemberTable members={[multiPathwayMember]} onSelectMember={onSelectMember} />,
    );

    const chevron = screen.getByRole("button", { name: "Expand" });
    fireEvent.click(chevron);

    expect(screen.getByText("Dynamic Leadership")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });

  it("Enter on a focused single-pathway row fires the same navigation as a click", () => {
    const onSelectMember = vi.fn();
    render(
      <MemberTable members={[singlePathwayMember]} onSelectMember={onSelectMember} />,
    );

    const row = screen.getByText("Single Path").closest("tr")!;
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });

    expect(onSelectMember).toHaveBeenCalledWith(
      "single@example.com",
      "Motivational Strategies",
    );
  });

  it("Space on a focused multi-pathway parent row toggles expansion", () => {
    const onSelectMember = vi.fn();
    render(
      <MemberTable members={[multiPathwayMember]} onSelectMember={onSelectMember} />,
    );

    const parentRow = screen.getByText("Multi Path").closest("tr")!;
    parentRow.focus();
    fireEvent.keyDown(parentRow, { key: " " });

    expect(screen.getByText("Dynamic Leadership")).toBeInTheDocument();
    expect(onSelectMember).not.toHaveBeenCalled();
  });

  it("ExpandCollapseToggle renders above the table and expands/collapses all multi-pathway rows", () => {
    const secondMultiMember: MemberSummary = {
      email: "multi2@example.com",
      name: "Multi Path Two",
      title: "",
      pathways: [
        pathway({ pathway: "Presentation Mastery", title: "PM2" }),
        pathway({ pathway: "Team Collaboration", title: "TC1" }),
      ],
    };
    render(
      <MemberTable
        members={[multiPathwayMember, secondMultiMember]}
        onSelectMember={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Expand all" });
    expect(toggle).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Dynamic Leadership")).toBeInTheDocument();
    expect(screen.getByText("Presentation Mastery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("Dynamic Leadership")).not.toBeInTheDocument();
    expect(screen.queryByText("Presentation Mastery")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
  });
});

describe("MemberTable — dead-control guard (Phase 19 item 4)", () => {
  it("does NOT render the expand/collapse toggle when every member has exactly one pathway", () => {
    render(<MemberTable members={[singlePathwayMember]} onSelectMember={vi.fn()} />);

    expect(screen.queryByText("Expand all")).not.toBeInTheDocument();
    expect(screen.queryByText("Collapse all")).not.toBeInTheDocument();
  });

  it("DOES render the expand/collapse toggle when at least one member has more than one pathway", () => {
    render(
      <MemberTable
        members={[singlePathwayMember, multiPathwayMember]}
        onSelectMember={vi.fn()}
      />,
    );

    expect(screen.getByText("Expand all")).toBeInTheDocument();
  });
});

// Phase 20 validation items 2-5 (see specs/roadmap.md "## Phase 20 — Overview
// page name search"). Covers: basic filter narrowing/clearing, the three
// branches of the no-match message, the filtered-list dead-control guard for
// ExpandCollapseToggle, the clear button's own dead-control guard, the live
// match-count hint, and expand-all's scoping to the currently-visible rows.
describe("MemberTable — search filter (Phase 20 item 2: basic filter behavior)", () => {
  it("narrows rendered rows to the case-insensitive substring match, then restores the full list via the clear button", () => {
    render(
      <MemberTable
        members={[singlePathwayMember, multiPathwayMember]}
        onSelectMember={vi.fn()}
      />,
    );

    expect(screen.getByText("Single Path")).toBeInTheDocument();
    expect(screen.getByText("Multi Path")).toBeInTheDocument();

    const searchInput = screen.getByRole("textbox", {
      name: "Search members by name",
    });
    // Fixture name is "Single Path" (title case); query uses the opposite
    // case to prove the match is case-insensitive, not an accidental exact
    // match on the fixture's own casing.
    fireEvent.change(searchInput, { target: { value: "single" } });

    expect(screen.getByText("Single Path")).toBeInTheDocument();
    expect(screen.queryByText("Multi Path")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.getByText("Single Path")).toBeInTheDocument();
    expect(screen.getByText("Multi Path")).toBeInTheDocument();
  });
});

describe("MemberTable — search filter (Phase 20 item 3: no-match state)", () => {
  it('renders "No members match" with the exact query interpolated when nobody matches', () => {
    render(
      <MemberTable
        members={[singlePathwayMember, multiPathwayMember]}
        onSelectMember={vi.fn()}
      />,
    );

    const searchInput = screen.getByRole("textbox", {
      name: "Search members by name",
    });
    fireEvent.change(searchInput, { target: { value: "zzz-nobody" } });

    expect(
      screen.getByText('No members match "zzz-nobody"'),
    ).toBeInTheDocument();
  });

  it("does NOT render the no-match message when the query is empty", () => {
    render(
      <MemberTable
        members={[singlePathwayMember, multiPathwayMember]}
        onSelectMember={vi.fn()}
      />,
    );

    expect(screen.queryByText(/No members match/)).not.toBeInTheDocument();
  });

  it("does NOT render the no-match message when the query has matches", () => {
    render(
      <MemberTable
        members={[singlePathwayMember, multiPathwayMember]}
        onSelectMember={vi.fn()}
      />,
    );

    const searchInput = screen.getByRole("textbox", {
      name: "Search members by name",
    });
    fireEvent.change(searchInput, { target: { value: "Single" } });

    expect(screen.queryByText(/No members match/)).not.toBeInTheDocument();
  });
});

describe("MemberTable — search filter (Phase 20 item 4: filtered dead-control guard)", () => {
  it("hides ExpandCollapseToggle once a filter excludes the only multi-pathway member", () => {
    render(
      <MemberTable
        members={[singlePathwayMember, multiPathwayMember]}
        onSelectMember={vi.fn()}
      />,
    );

    // Unfiltered: the one multi-pathway member ("Multi Path") keeps the
    // toggle alive, mirroring the Phase 19 "DOES render" case.
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();

    const searchInput = screen.getByRole("textbox", {
      name: "Search members by name",
    });
    // Matches only the single-pathway member; the multi-pathway member is
    // filtered out entirely.
    fireEvent.change(searchInput, { target: { value: "Single Path" } });

    expect(screen.getByText("Single Path")).toBeInTheDocument();
    expect(screen.queryByText("Multi Path")).not.toBeInTheDocument();
    // Regression this catches: if `hasMultiPathway` were still derived from
    // the unfiltered `members` array, this toggle would incorrectly remain
    // visible even though no on-screen row has multiple pathways.
    expect(
      screen.queryByRole("button", { name: "Expand all" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse all" }),
    ).not.toBeInTheDocument();
  });
});

describe("MemberTable — search filter (Phase 20 item 4: clear control's own dead-control guard)", () => {
  it("does not render the clear button until the user has typed a query", () => {
    render(<MemberTable members={[singlePathwayMember]} onSelectMember={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();

    const searchInput = screen.getByRole("textbox", {
      name: "Search members by name",
    });
    fireEvent.change(searchInput, { target: { value: "S" } });

    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });
});

describe("MemberTable — search filter (Phase 20 item 4/5: live match count)", () => {
  it('shows "N of N" with an empty query, "k of N" (k<N) for a partial match, and "0 of N" for zero matches', () => {
    render(
      <MemberTable
        members={[singlePathwayMember, multiPathwayMember]}
        onSelectMember={vi.fn()}
      />,
    );

    expect(screen.getByText("2 of 2 members")).toBeInTheDocument();

    const searchInput = screen.getByRole("textbox", {
      name: "Search members by name",
    });
    fireEvent.change(searchInput, { target: { value: "Single" } });
    expect(screen.getByText("1 of 2 members")).toBeInTheDocument();
    expect(screen.queryByText("2 of 2 members")).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "zzz-nobody" } });
    expect(screen.getByText("0 of 2 members")).toBeInTheDocument();
  });
});

describe("MemberTable — search filter (Phase 20 item 6: expand-all scoped to visible rows)", () => {
  it("expand-all while filtered only expands currently-visible multi-pathway members, leaving a filtered-out multi-pathway member collapsed once the filter clears", () => {
    const alphaMulti: MemberSummary = {
      email: "alpha@example.com",
      name: "Alpha Multi",
      title: "",
      pathways: [
        pathway({ pathway: "Alpha Path One" }),
        pathway({ pathway: "Alpha Path Two" }),
      ],
    };
    const betaMulti: MemberSummary = {
      email: "beta@example.com",
      name: "Beta Multi",
      title: "",
      pathways: [
        pathway({ pathway: "Beta Path One" }),
        pathway({ pathway: "Beta Path Two" }),
      ],
    };
    // Deliberately doesn't match the "Multi" query below — used to prove a
    // filtered-out multi-pathway member's email never lands in the
    // "expand all" set computed while the filter was active.
    const deltaMultiHidden: MemberSummary = {
      email: "delta@example.com",
      name: "Delta Extra",
      title: "",
      pathways: [
        pathway({ pathway: "Delta Path One" }),
        pathway({ pathway: "Delta Path Two" }),
      ],
    };

    render(
      <MemberTable
        members={[alphaMulti, betaMulti, deltaMultiHidden]}
        onSelectMember={vi.fn()}
      />,
    );

    const searchInput = screen.getByRole("textbox", {
      name: "Search members by name",
    });
    fireEvent.change(searchInput, { target: { value: "Multi" } });

    // Only Alpha and Beta are visible; Delta is filtered out.
    expect(screen.getByText("Alpha Multi")).toBeInTheDocument();
    expect(screen.getByText("Beta Multi")).toBeInTheDocument();
    expect(screen.queryByText("Delta Extra")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));

    // The two visible multi-pathway members are expanded.
    expect(screen.getByText("Alpha Path Two")).toBeInTheDocument();
    expect(screen.getByText("Beta Path Two")).toBeInTheDocument();

    // Clear the filter to bring Delta back into view.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    const deltaRow = screen.getByText("Delta Extra").closest("tr")!;
    // Regression this catches: if `multiPathwayEmails` were computed from
    // the unfiltered `members` array instead of `filteredMembers`, clicking
    // "Expand all" while the filter hid Delta would still add Delta's email
    // to `expandedRows`, so it would render pre-expanded here even though
    // its row was never visible (or clickable) at expand time.
    expect(within(deltaRow).getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(screen.queryByText("Delta Path Two")).not.toBeInTheDocument();
  });
});
