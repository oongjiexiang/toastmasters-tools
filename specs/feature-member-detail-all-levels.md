# Feature Spec: Member Detail — All Levels View

## Problem

The member detail page (`/member`) only renders projects for the member's
**next** level to complete. Levels the member has already finished — and any
later levels that already have project data in `progress_snapshots`
(e.g. Ankitha's Level 4 and Level 5) — are never shown.

As VPE I cannot see a member's full pathway picture in one place. To check
whether a completed level was actually approved, or which electives a member
chose at an earlier level, I have to fall back to raw CSVs.

## Goal

On the member detail page, show **all** levels for the selected member +
pathway (Levels 1–5 and Path Completion), grouped per level in collapsible
sections, so the full progress story is visible on one screen.

## User Stories

- As VPE, when I click a member's name on the dashboard, I see every level
  (1–5 + Path Completion) for that member's pathway, not just the next one.
- As VPE, I can collapse a level I don't care about and expand the one I do,
  so a member with 20+ projects stays scannable.
- As VPE, I can read each level's completion status and approval state from
  the section header without expanding it.
- As VPE, I can collapse or expand every level at once with a single button.

## Acceptance Criteria

- Detail page is reached by clicking a member's **name** on the dashboard
  (unchanged entry point).
- Page renders **one section per level**: Level 1, Level 2, Level 3, Level 4,
  Level 5, Path Completion — in that order. Levels with no project data for
  the member render as an empty/zero-project section (not omitted), so a gap
  in data is visible rather than silently hidden.
- Each level is a **collapsible accordion section**. Multiple sections may be
  open at once (independent toggles, not single-open).
- **Default state: all sections expanded.**
- **"Expand All"** and **"Collapse All"** buttons sit at the top of the page,
  above the first section.
- Each **section header** shows:
  - Level name (e.g. "Level 4")
  - Completion status as `X/Y complete` (X = done projects, Y = total
    non-overview projects in that level)
  - **Approved badge** when the level is approved. Source of truth is the
    `level_N` flag in the latest `progress_snapshots` row (1 = approved).
    Path Completion uses the `path_done` flag.
- Within an expanded section, each **project row** shows:
  - Project name (lesson)
  - Status badge: **Done** or **Pending**
  - **Elective** marker when the project's type is Elective
- Overview lessons remain excluded (consistent with `isOverviewLesson`).
- A "Back to dashboard" link remains at the top.

## Data Notes

- Completion status (`X/Y`) per level comes from the **`project_snapshots`** table
  (introduced in Phase 3), filtered by member + pathway + level, excluding overview lessons
  via `isOverviewLesson`. This table is the SQLite replacement for `details.csv`.
- The **Approved** badge is distinct from `X/Y complete`: a level can read
  `4/4 complete` but only show the Approved badge if its `level_N` flag is 1 in
  `progress_snapshots`. Surface both independently — do not infer approval from project counts.
- The `project_snapshots` table is a **Phase 3 prerequisite**: `fetch.ts` must persist
  per-project data to SQLite before this feature can read from it.

## Out of Scope

- Editing project or approval status from the UI (read-only).
- Cross-pathway view (a member on two pathways still gets one detail page per
  pathway, as today).
- Historical/over-time progress within the detail page.
- Visual redesign beyond the accordion (covered by the React migration spec).

## Open Questions

1. The current accordion needs client-side toggle state, which the
   string-concatenation renderer in `services/ui.ts` cannot do cleanly. Should
   this feature land on the current server-rendered UI (e.g. `<details>`
   elements for zero-JS collapse) **or** wait for the React migration? See
   `feature-react-migration.md`. Recommendation: build it as part of the React
   migration to avoid throwaway work.
2. For levels with **no** project data at all, show an empty section or a
   "no data" placeholder inside it? (Default assumption: placeholder inside.)
3. Should the Path Completion section list its sub-requirements, or just show
   the approved/not-approved state? (Default assumption: state only.)
