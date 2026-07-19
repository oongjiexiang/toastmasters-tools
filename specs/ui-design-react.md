# UI Design Spec — React Dashboard (Phase 4)

> **Superseded — the web app was removed in Phase 14; components now live in `packages/ui`.**
> This design spec described the Phase 4 `apps/web` dashboard. The layout and component
> design it documents are unchanged — the same components now render inside the
> `apps/desktop` Electron renderer, sourced from `packages/ui` (`@toastmasters/ui`) instead of
> `apps/web/components`. See `specs/roadmap.md` Phase 14.

Design spec for re-implementing the Phase 2 dashboard in React + shadcn/ui. One user
(the club VPE), runs locally, light mode only, laptop only. Handoff target: a developer.

- **Tool used:** Markdown / ASCII wireframes (Figma not used for this internal tool).
- **Source of truth for data shapes:** `architecture-react.md` (API shapes) and
  [`types.ts`](../packages/core/types.ts). This spec references those — it does not redefine them.
- **Component library:** [shadcn/ui](https://ui.shadcn.com) (Radix primitives + Tailwind).

> **Paths note:** file paths here reflect the post–Phase 10 monorepo layout — shared logic in
> `packages/core/`, the Next.js app in `apps/web/`. The design itself is unchanged.

---

## 0. The problem this redesign fixes

The Phase 2 UI only shows the **next** level to complete (`nextLevelToComplete`,
[`helpers/pathway.ts`](../packages/core/helpers/pathway.ts)). When a member has data for Levels 4 and 5
already in Basecamp, those levels are **invisible** to the VPE. The detail view must show
**all** levels for a member's pathway, not just the next one.

### Critical data distinction (drives the whole status system)

The data model separates two things the original prompt collapsed into one:

| Concept | Source | Meaning |
|---|---|---|
| **Approved** | `Level N Approved == true` (`isLevelDone`) | VPE clicked "approve" in Basecamp. Official. |
| **Projects done** | per-lesson `Complete == Yes` — from the `project_snapshots` table (originally `details.csv`, retired in Phase 6) | Member finished the speech projects. |

These can disagree. A member can have **all projects done but the level not yet approved** —
that member is _waiting on the VPE_ and is the single most actionable row in the tool. The
status system below makes that state first-class. (See §4.)

> ⚠️ **UX Risk — hidden action items**: If "all projects done, not approved" looks identical
> to "approved", the VPE never learns which members are waiting on _them_. Impact: members stall
> on the VPE's own backlog. Mitigation: a distinct **"Ready to approve"** status, surfaced in
> both screens.

---

## 1. Layout sketches

### Screen 1 — Member List Dashboard

Default sort: name A→Z (matches current `localeCompare` sort in `loadFromDb`). One **header
summary** strip, then the table. Search is V1-optional (shown greyed in sketch).

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Toastmasters Dashboard                                                                │
│  Source: SQLite (latest snapshot) · 38 members · Updated 2026-06-23 09:14             │
│                                                                                        │
│  [ 🔍 Search name…            ]   [ Pathway ▾ ]  [ Status ▾ ]      (filters = V1 opt.) │
│                                                                                        │
│  ┌──────────────────┬────────┬─────────────────────────┬───────────────┬───────────┐ │
│  │ NAME             │ TITLE  │ PATHWAY                  │ NEXT LEVEL    │ REMAINING │ │
│  ├──────────────────┼────────┼─────────────────────────┼───────────────┼───────────┤ │
│  │ Ankitha R.       │ [PM3]  │ Presentation Mastery     │ Level 4       │     3     │ │
│  │ Ben Tan        ⌄ │ [DL2]  │ 2 pathways               │ Level 3       │    ● 1    │ │ ← close
│  │   └ (expanded sub-rows when chevron clicked — see below)                          │ │
│  │ Carmen Lee       │ [DTM]  │ Persuasive Influence     │ — Completed — │  ✓ Done   │ │ ← completed
│  │ Devi N.          │  —     │ Dynamic Leadership       │ Level 1       │     4     │ │ ← not started
│  │ Ethan Wong       │ [PI2]  │ Persuasive Influence     │ Level 3       │ ⚑ Ready   │ │ ← ready-to-approve
│  └──────────────────┴────────┴─────────────────────────┴───────────────┴───────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Multi-pathway member, expanded (chevron toggled):**

```text
│ Ben Tan        ⌃ │ [DL2]  │ 2 pathways               │ —             │           │
│   ├ Dynamic Leadership      [DL2]   Next: Level 3     │ ● 1 remaining → details    │
│   └ Visionary Communication [VC1]   Next: Level 2     │   4 remaining → details    │
```

#### Decision: multiple pathways → **one summary row that expands to sub-rows** (not N flat rows)

| Option | Verdict |
|---|---|
| N flat rows (one per pathway) | ✗ Name repeats, breaks "scan the member roster" mental model, inflates row count, ambiguous which TITLE/sort key wins. |
| **1 row + expandable sub-rows** | ✓ One row per _person_ (the VPE's unit of thought). Title badge shows the member's highest title across paths. Sub-rows reveal per-pathway next level only when needed. |

- Members with **one** pathway: no chevron, no sub-row — the row _is_ the pathway.
- Members with **2+** pathways: chevron in the NAME cell; TITLE = highest title across all
  paths; PATHWAY cell reads `N pathways`; NEXT LEVEL / REMAINING cells are blank on the
  parent and live on each sub-row.
- Clicking a **single-pathway** row (anywhere outside the chevron) → Screen 2 for that pathway.
- Clicking a **sub-row** "details" → Screen 2 for that specific pathway.

### Screen 2 — Member Detail (All Levels)

Accordion of **all** levels for one (member × pathway). Default: **all expanded** (user
requested). Header carries the per-level controls and a path-wide progress meter.

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ← Back to dashboard                                                                   │
│                                                                                        │
│  Ankitha R.  [PM3]                                                                     │
│  Presentation Mastery · Path progress: 2 of 5 levels approved                          │
│                                                                                        │
│                                          [ Expand all ]  [ Collapse all ]              │
│                                                                                        │
│  ⌄ Level 1   ● Approved              3 / 3 complete ──────────────────────────────────│
│      ✓ Ice Breaker                                                Speech · 2025-02-11  │
│      ✓ Writing a Speech with Purpose                              Speech · 2025-03-04  │
│      ✓ Evaluation and Feedback                       (elective)   Speech · 2025-04-01  │
│                                                                                        │
│  ⌄ Level 2   ● Approved              4 / 4 complete ──────────────────────────────────│
│      ✓ … (4 projects, all done)                                                        │
│                                                                                        │
│  ⌄ Level 3   ⚑ Ready to approve      4 / 4 complete ──────────────────────────────────│
│      ✓ Understanding Your Communication Style                    Speech · 2026-05-20  │
│      ✓ … (all projects done — awaiting VPE approval in Basecamp)                       │
│                                                                                        │
│  ⌄ Level 4   ◐ In progress           2 / 4 complete ──────────────────────────────────│
│      ✓ Understanding Conflict Resolution                         Speech · 2026-06-02  │
│      ✓ Successful Collaboration                                  Speech · 2026-06-16  │
│      ✗ Reaching Consensus                                                  Pending     │
│      ✗ Project of choice                             (elective)            Pending     │
│                                                                                        │
│  ⌄ Level 5   ○ Not started           0 / 3 complete ──────────────────────────────────│
│      ✗ … (3 projects, all pending)                                                     │
│                                                                                        │
│  ⌄ Path Completion   ○ Not started   0 / 1 complete ─────────────────────────────────│
│      ✗ Path Completion                                                     Pending     │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Notes wired to real data:

- The **right-aligned `done / total`** count comes from the `project_snapshots` table for that
  level (excluding `isOverviewLesson` entries — keep that filter). This is the `projectsDone` /
  `projectsTotal` in `LevelGroup` from `architecture-react.md`.
- **Speech title + date** come from `project_snapshots` (populated from Basecamp detail API via
  `packages/core/services/fetch.ts`). Show `Speech · <date>` when present; omit when there's no
  speech.
- `(elective)` tag when `Type == Elective`.
- The **status pill** per level is the level's status (§4), independent of the count.

---

## 2. Component inventory (shadcn/ui)

| UI element | shadcn/ui component | Notes |
|---|---|---|
| Page shell / header card | `Card`, `CardHeader`, `CardContent` | Summary strip on Screen 1. |
| Member roster table | `Table` (`TableHeader`/`Row`/`Cell`) | Sticky header; dense row padding. |
| Expandable multi-pathway row | `Collapsible` inside the row, or `Table` + manual row state | Chevron = `ChevronRight`/`ChevronDown` (lucide). |
| Title / status badges | `Badge` (with `variant`) | Map variants to §4 colours via Tailwind classes. |
| Search box | `Input` | V1-optional; client-side filter only. |
| Pathway / Status filters | `Select` or `DropdownMenu` | V1-optional. |
| All-levels accordion | `Accordion` (`type="multiple"`) | `multiple` so several stay open; default `defaultValue` = all level ids. |
| Expand all / Collapse all | `Button` (`variant="outline"`, `size="sm"`) | Controls the accordion's open set (see §6). |
| Per-level progress count | plain text + `Badge` | `done / total`. |
| Path progress meter | `Progress` (optional) or text | "2 of 5 levels approved". |
| Project rows | plain list / `div` rows | Not a `Table` — single column with right-aligned meta. |
| Back link | `Button` (`variant="link"`) or `<a>` | Routes to Screen 1. |
| Empty / error states | `Card` + muted text | See §7. |
| Loading | `Skeleton` | Table-row and accordion skeletons. |
| Toast (refresh / errors) | `Sonner` (shadcn toast) | Optional; for async refresh feedback. |

Icons (lucide-react, ships with shadcn): `CircleCheck` (approved), `Flag` (ready),
`CircleDot`/`LoaderCircle` (in progress), `Circle` (not started), `Check`/`X` (project rows),
`ChevronDown`/`ChevronRight`, `Trophy` or `PartyPopper` (path completed).

---

## 3. Routing & data

| Route | Screen | API call |
|---|---|---|
| `/` | Member List | `GET /api/members` → `MemberSummary[]` |
| `/members/[email]?pathway=<name>` | Member Detail | `GET /api/members/:email?pathway=<name>` → `MemberDetail` |

**`MemberSummary`** (from `architecture-react.md`) already carries the `pathways[]` sub-array
and the per-pathway `status` field needed for both screens. No client-side derivation — `status`
is computed server-side in the API route. The React layer only renders.

```ts
// From architecture-react.md — repeated here for readability
interface MemberSummary {
  email: string; name: string; title: string;
  pathways: { pathway, title, nextLevel, remaining,
              status: "completed"|"ready"|"close"|"in-progress"|"not-started" }[];
}
```

Keep all business logic (title derivation, status computation) in
[`helpers/pathway.ts`](../packages/core/helpers/pathway.ts) so it is reusable and testable.

---

## 4. Colour & status system

Semantic colour only. Palette reuses the hues from the Phase 2 server-rendered UI
(`services/ui.ts`, removed in Phase 4) so the redesign is visually continuous (green `#16a34a`,
amber, red `#991b1b`, blue title `#1e40af`, grey).

### Level status (Screen 2 pills, and the row-level rollup on Screen 1)

| Status | Icon | Colour | Badge text | Rule |
|---|---|---|---|---|
| **Approved** | ● `CircleCheck` | Green | `Approved` | `Level N Approved == true` (`isLevelDone`). |
| **Ready to approve** | ⚑ `Flag` | Amber (solid) | `Ready to approve` | All projects `Complete == Yes` **but** level not approved. **Action item for the VPE.** |
| **In progress** | ◐ `CircleDot` | Amber (soft) | `In progress` | Some but not all projects done; not approved. |
| **Not started** | ○ `Circle` | Grey | `Not started` | Zero projects done; not approved. |
| **Path completed** | 🏆 `Trophy` | Green (celebrate) | `Completed` | `nextLevelToComplete == "Completed"`. Whole path done. |

### Project status (Screen 2 individual project rows)

| State | Icon | Colour | Meta |
|---|---|---|---|
| Done | ✓ `Check` | Green | `Speech · <date>` if a speech exists |
| Pending | ✗ `X` | Red / muted | `Pending` |
| Elective tag | — | Grey, secondary | `(elective)` appended to title when `Type == Elective` |

### Member row highlights (Screen 1 REMAINING cell)

| Condition | Treatment |
|---|---|
| Path completed | Green `✓ Completed` text + `Trophy`; **name not a link's "go fix" target** but still clickable to view history. |
| Ready to approve (next level's projects all done) | Amber `⚑ Ready` pill — highest-priority highlight. |
| **Close** (1 project remaining) | `● 1` with an amber dot — "almost there". |
| 2+ remaining | Plain number. |
| Not started (0 done in Level 1) | Plain number; no special highlight (not urgent, just early). |

> **Title badge** (`[PM3]`, `[DTM]`) stays blue (`b-title`, `#1e40af` on `#dbeafe`) — it's an
> identity badge, deliberately _not_ part of the status colour scale so it never competes with
> green/amber status signals.

### Contrast note (WCAG 2.2 AA, SC 1.4.3 / 1.4.11)

This is internal single-user tooling, but the existing token pairs already meet AA: green
`#166534` on `#dcfce7`, red `#991b1b` on `#fee2e2`, blue `#1e40af` on `#dbeafe` all exceed
4.5:1. **Do not encode status by colour alone** (SC 1.4.1): every status keeps its icon **and**
text label, so the amber "Ready" vs "In progress" pair is distinguishable without colour.

---

## 5. Typography

Formalizes classes already in production use across `packages/ui/components/**` and
`apps/desktop/src/renderer/**` — this is documentation of what shipped, not a redesign. Added
2026-07-17 after a ui-ux-designer review; product-manager-aligned as doc-only (no code change).
Updated 2026-07-18 for Phase 29 (dashboard typography refresh): the font stack and heading
letter-spacing below reflect that phase's shipped change, not the original 2026-07-17 baseline.

**Font family.** `packages/ui/globals.css`'s `--font-sans` sets an explicit, offline-safe stack:
`"Segoe UI Variable", -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif` —
Windows 11's newer, more geometric system font first (this app's primary platform), then macOS's
native system font, falling back to Tailwind/shadcn's generic sans-serif stack. Every entry is
OS-native and reachable on a real machine — no font file is bundled or self-hosted, and no entry
(e.g. a non-bundled webfont like Inter) is left in the stack where it could never actually resolve,
per a PR #16 review finding. This matters for this offline Electron app with no CDN access at
runtime.
`html { @apply font-sans antialiased; }` also applies `antialiased` for crisper rendering at this
app's small (12–14px) body sizes. `font-mono` (default system mono stack) is reserved for
machine-ish content only: title badges (`[PM3]`, `[DTM]`) and the refresh console's log output —
never for prose.

**Type roles:**

| Role | Tailwind class | ~px | Weight | Used in |
|---|---|---|---|---|
| Page title (H1) | `text-2xl font-semibold tracking-tight` | 24 | 600 | `DashboardHeader`, `MemberDetailView` header |
| Section / card title | `text-base font-medium tracking-tight` | 16 | 500 | shadcn `CardTitle` (`leading-snug`) |
| Body / table text | `text-sm` | 14 | 400 | table cells, card descriptions, error/empty-state copy |
| Emphasis label | `text-sm font-medium` | 14 | 500 | table header cells, level-accordion labels, `DiffSection` section labels |
| Secondary / muted | `text-sm` + `text-muted-foreground` | 14 | 400 | subtext, descriptions |
| Small label / badge | `text-xs` (badges add `font-medium`) | 12 | 400/500 | badges, elective tags, `xs` button size, console header label |
| Monospace / code | `font-mono text-xs`–`text-sm` | 12–14 | 400 | title badges, console log lines |

Line-height is a Tailwind default throughout, plus `leading-snug` on card titles. Letter-spacing is
also a Tailwind default everywhere **except** the two heading roles above: `tracking-tight`
(Phase 29, 2026-07-18) tightens the Page title (H1) and Section/card title roles only — body text,
table cells, and badges are untouched, since tight tracking only reads well at the larger/heavier
weights headings use.

> **Exception: `CardTitle`'s `size="sm"` variant does not use tight tracking.** shadcn's `CardTitle`
> drops to `text-sm` (body-text size) via `group-data-[size=sm]/card:text-sm` when its parent `Card`
> is rendered `size="sm"` — at that size it's reading as body text, not a heading, so it resets to
> `tracking-normal` via a matching `group-data-[size=sm]/card:tracking-normal` override, keeping the
> "tight tracking only at heading weights" rule intact rather than letting it leak into body-size
> text. Caught in PR #16's review before any call site used `size="sm"`, so this was a latent-only
> inconsistency, never a visible regression.

> **Badge size is component-baked, not a per-use knob.** shadcn's `Badge` base variant
> (`packages/ui/components/ui/badge.tsx`) already hardcodes `text-xs font-medium` — every badge
> renders at that size regardless of what callers pass. `MemberTable.tsx`'s `TitleBadge` adds a
> redundant explicit `text-xs`; `MemberDetailView.tsx`'s badge omits it and renders identically.
> This was checked as a candidate fix during the 2026-07-17 review and found to be a false
> positive — both already match. Do not "fix" the redundant class into a divergence.

> **Extending the scale.** Seven roles is enough for this app's surface area (one dashboard, one
> detail view, one console). Before adding an eighth, check whether an existing role already
> fits — a new size/weight combination should only be introduced for a genuinely new kind of
> content, not to fine-tune an existing one's visual weight.

---

## 6. Interaction spec

### Screen 1 — Member List

- **Row click target:** entire row is clickable for single-pathway members → navigates to
  `/members/:email?pathway=<name>` (§3). Use `cursor: pointer` + hover background (`#f7f7f7`,
  matches current).
- **Chevron (multi-pathway only):** click toggles sub-rows _without_ navigating. Chevron has its
  own hit area (≥ 24×24 px, SC 2.5.8); clicking it must `stopPropagation` so it doesn't also fire
  the row navigation.
- **Sub-row "details" link:** navigates to that pathway's detail.
- **Completed members:** still clickable (VPE may want to review history) but show `✓ Completed`
  instead of a remaining count.
- **Keyboard:** rows reachable via `Tab`; `Enter` activates navigation; chevron is a separate
  focusable `button` with `aria-expanded`. Visible focus ring (SC 2.4.7).
- **Sort (V1):** default name A→Z. Optional: click column headers to sort (V1-optional).
- **Search/filter (V1-optional):** client-side, case-insensitive name contains; pathway and
  status `Select`. Filtering empties → zero-result state (§7).

### Screen 2 — Member Detail

- **Accordion type:** `multiple` (independent sections; several open at once).
- **Default open set:** **all** sections (`defaultValue = [all level ids]`). User requirement.
- **Expand all / Collapse all:** two buttons set the controlled `value` to `[all ids]` or `[]`.
  Because the accordion is controlled, these stay in sync with manual toggling.
- **Section header is the toggle:** full-width header click toggles; chevron rotates
  (`ChevronDown` ↔ `ChevronRight`). The _only_ animation in the app is this open/close
  (Radix's height transition) — honour `prefers-reduced-motion` (SC 2.3.3) by disabling it.
- **Per-section header content:** `<chevron> Level N  <status pill>  …………  done / total`.
- **No per-project interaction:** project rows are read-only (this tool reads Basecamp; it does
  not write back). Do not render them as buttons/checkboxes — they're status, not controls.
- **Back:** `← Back to dashboard` returns to `/` and should restore scroll/expanded state if
  cheap (nice-to-have, not V1).
- **Keyboard:** accordion headers are buttons with `aria-expanded` / `aria-controls`; arrow-key
  navigation comes free from Radix. Logical tab order top→bottom.

---

## 7. Empty, loading & error states

All states reuse the muted-card pattern; copy mirrors the current server messages so behaviour
is unchanged.

| State | When | What shows |
|---|---|---|
| **No data at all** | No SQLite snapshot (`rows.length === 0`) — the CSV fallback was retired in Phase 6 | Card: **"No data yet."** Body: "Run `npm run fetch` then `npm run membership`, then refresh."  No empty table chrome. |
| **Loading (initial)** | Fetching the roster | `Skeleton` rows (≈8) under a real table header; header summary shows a skeleton line. |
| **Zero results (filter)** | Search/filter matches nothing | Keep table header + filters; body row: **"No members match this filter."** + `Clear filters` button. Distinct from "no data". |
| **Detail: no project data** | `project_snapshots` has no rows for this member×pathway×level | Per-level: muted line **"No project data for this level. Run `npm run fetch` to refresh."** Keep the section header + status pill (status may still be known from the approved flag). |
| **Member/pathway not found** | Bad route params | Card: **"Member not found."** + `← Back to dashboard`. (Mirrors current 404.) |
| **Refresh/load error** | Read of DB/CSV throws | `Sonner` toast **"Couldn't load data"** + inline card with the error and a `Retry` button. Use a live region (`role="status"`, SC 4.1.3) so the toast is announced. |
| **Stale data hint (nice-to-have)** | Snapshot older than N days | Amber inline note in the header strip: `Data is N days old — consider re-running fetch.` |

---

## 8. Responsive & scope guardrails

- **Laptop-only**, light-only, one user — per project constraints. No mobile breakpoints, no
  dark mode, no theming. A single max-width container (~`960px`, matching current `max-width`)
  centred.
- **Long content:** long pathway names and speech titles truncate with `text-overflow: ellipsis`
  and a `title` tooltip; never wrap the table into a jagged multi-line mess. Member names wrap
  before they truncate (names matter more than fit).
- **Density:** keep the current dense rhythm (`~0.4rem 0.75rem` cell padding, `0.875rem` font).
  This is a data tool — comfortable density beats whitespace.

---

## 9. Developer handoff checklist

- [ ] Extend `SummaryRow` with `status` + `pathways[]` (§3); derive in
      `packages/core/helpers/pathway.ts`, not in React.
- [ ] Detail API route (`apps/web/app/api/members/[email]/route.ts`) returns **all** levels
      (`STANDARD_LEVELS` + `Path Completion`) with per-level `{ approved, projectsDone,
      projectsTotal, projects[] }`, projects carrying `{ lesson, complete, type }`.
      Source: `project_snapshots` table. Keep the `isOverviewLesson` filter.
- [ ] Compute **"Ready to approve"** = all projects done AND `Level N Approved != true`.
- [ ] Accordion: `type="multiple"`, controlled `value`, default = all ids; Expand/Collapse set it.
- [ ] Status rendered with **icon + text + colour** (never colour alone).
- [ ] Chevron hit area ≥ 24×24 px; `stopPropagation` vs row navigation.
- [ ] `prefers-reduced-motion` disables the accordion height animation.
- [ ] All empty/loading/error states from §7 implemented.

---

## 10. Acceptance criteria (testable)

1. A member with Level 4 + Level 5 data shows **all six sections** (L1–L5 + Path Completion) in
   detail — none hidden. (Fixes the core bug.)
2. A member whose next level has every project done but no approval flag shows **"Ready to
   approve"** (amber ⚑) in both the roster REMAINING cell and the level pill.
3. A multi-pathway member appears as **one roster row**; expanding reveals one sub-row per
   pathway, each linking to its own detail view.
4. A completed-path member shows **"Completed" + Trophy**, green, and is still clickable.
5. "Collapse all" then "Expand all" returns every section to open; manual toggles stay in sync.
6. Every status is distinguishable with colour disabled (icon + label present).
7. Empty (no data), zero-result (filtered), and error states each render their §7 copy and never
   show a bare empty table.
