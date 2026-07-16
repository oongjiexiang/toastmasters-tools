# ADR — Next.js + shadcn/ui frontend

> **Superseded — the web app was removed in Phase 14; components now live in `packages/ui`.**
> This document is the historical record of why Next.js + shadcn/ui was chosen for the
> now-deleted `apps/web`. The shadcn/ui component decisions still apply — those components were
> extracted verbatim into `packages/ui` (`@toastmasters/ui`) and are consumed by
> `apps/desktop`'s renderer — but Next.js itself is gone. See `specs/roadmap.md` Phase 14.

| Field | Value |
|---|---|
| Date | 2026-06-23 |
| Status | Accepted (revised: Vite → Next.js) |
| Deciders | Software architect, VPE |
| Phase | 4 (depends on Phase 3 data work) |

## Context

The Phase 2 dashboard renders HTML from string templates in `services/ui.ts`. Phase 3 adds
an all-levels detail view requiring client-side accordion state — not feasible with string
templates. The VPE asked whether the UI "can be shadcn" and also raised Next.js as an
alternative to a separate Vite SPA.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Keep HTML strings + vanilla JS | No new toolchain | Accordion/expand-all state is painful; no component reuse |
| **React + Vite** (prior decision) | SPA, fast HMR | Requires separate `web/` subfolder with its own `package.json` and build; manual proxy between Vite dev server and Node HTTP server |
| **Next.js** (new decision) | Full-stack framework — API routes replace the custom Node HTTP server; one package; one `next dev` command; shadcn first-class target | Slightly heavier framework; `next build` required before `next start` |

## Decision

Adopt **Next.js 15 + React 19 + Tailwind CSS + shadcn/ui**.

Next.js eliminates the `web/` subfolder entirely. Its API Routes replace the hand-rolled
Node HTTP server in `services/ui.ts`. The CLI scripts (`fetch.ts`, `membership.ts`) are
unchanged — they continue to run via `tsx` and write to SQLite, which the Next.js API routes
read directly using `better-sqlite3` in server-side code.

**Why Next.js beats Vite + Node HTTP for this use case:**

| Concern | Vite + Node HTTP | Next.js |
|---|---|---|
| Dev command | Two processes (`tsx ui.ts` + `vite`) | One: `next dev` |
| API layer | Custom Node `http`/express server | Built-in API routes |
| `web/` subfolder | Required (separate `package.json`) | Gone — unified root package |
| shadcn/ui support | Works (Vite path) | First-class (primary target) |
| `better-sqlite3` | Node server only | API routes (server-only) ✓ |
| Build for production | Vite build + keep Node server running | `next build && next start` |

For localhost-only personal tooling this is strictly simpler. DX wins.

**Setup:**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir
# (or scaffold manually to keep existing files)
npx shadcn@latest init
npx shadcn@latest add table badge button accordion
```

## Directory layout after migration

```text
toastmasters-tools/
├── app/                               # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                       # Dashboard — member list
│   ├── members/[email]/page.tsx       # Member detail — all levels
│   └── api/
│       ├── members/route.ts           # GET /api/members
│       ├── members/[email]/route.ts   # GET /api/members/:email
│       ├── diff/route.ts             # GET /api/diff
│       └── membership-file/route.ts  # GET /api/membership-file (download)
├── components/
│   ├── ui/                           # vendored shadcn components (Accordion, Table, Badge…)
│   ├── MemberTable.tsx
│   ├── LevelAccordion.tsx
│   └── ProjectRow.tsx
├── lib/
│   └── api.ts                        # typed client-side fetch wrappers
├── helpers/                          # UNCHANGED: db.ts, pathway.ts, files.ts, csv.ts, api.ts
├── services/                         # REDUCED: fetch.ts, membership.ts  (ui.ts + analyze.ts removed)
├── scripts/                          # REMOVED in Phase 6
├── config.ts   types.ts   index.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json                     # updated: add "paths" → "@/*"
├── vitest.config.ts                  # Phase 5
└── package.json                      # Add next, react, react-dom; update scripts
```

## npm scripts after migration (Phase 4 → 6)

| Script | Command | Phase added |
|---|---|---|
| `npm run dev` | `next dev` | 4 — replaces `npm run ui` |
| `npm run build` | `next build` | 4 |
| `npm start` | `next start` | 4 — production server |
| `npm run fetch` | `tsx services/fetch.ts` | 0 (unchanged) |
| `npm run membership` | `tsx services/membership.ts` | 0 (unchanged) |
| `npm run cli` | `tsx index.ts` | 4 — renamed from `start` |
| `npm test` | `vitest` | 5 |
| `npm run test:coverage` | `vitest run --coverage` | 5 |
| ~~`npm run analyze`~~ | deleted | 6 |
| ~~`npm run diff`~~ | deleted | 6 |
| ~~`npm run validate`~~ | deleted | 6 |
| ~~`npm run ui`~~ | deleted | 4 (replaced by `dev`) |

## API contract

Conventions: plural kebab-case paths; JSON camelCase; response envelope `{ data, error? }`.
All routes are server-only (no auth needed — localhost only).

| Method | Path | Response `data` |
|---|---|---|
| GET | `/api/members` | `MemberSummary[]` — one object per person |
| GET | `/api/members/:email?pathway=<name>` | `MemberDetail` for that member × pathway |
| GET | `/api/diff` | `{ progress: ProgressDiff, membership: MembershipDiff }` |
| GET | `/api/membership-file` | latest `membership-*.csv` as `Content-Disposition: attachment` |

Error envelope: `{ "error": { "code": "NOT_FOUND" | "SNAPSHOT_MISSING" | "SERVER_ERROR", "message": "..." } }`

### Response shapes

```ts
// GET /api/members — one entry per person (not per pathway)
interface PathwaySummary {
  pathway: string;
  title: string;    // title for this specific pathway, e.g. "PM2"
  nextLevel: string;
  remaining: number;
  status: "completed" | "ready" | "close" | "in-progress" | "not-started";
}

interface MemberSummary {
  email: string;
  name: string;
  title: string;               // highest title across all pathways (DTM takes precedence)
  pathways: PathwaySummary[];  // one entry per enrolled pathway; always at least 1
}

interface LevelGroup {
  level: string;                        // "Level 1" … "Level 5" | "Path Completion"
  approved: boolean;
  projectsDone: number; projectsTotal: number;
  projects: { lesson: string; complete: boolean; type: "Core" | "Elective" }[];
}

interface MemberDetail {
  email: string; name: string; pathway: string; title: string;
  levels: LevelGroup[];                 // L1–L5 + Path Completion, in order
}
```

`ProgressDiff` and `MembershipDiff` are the existing types from `helpers/db.ts` — returned as-is.

## How SQLite maps to the API

| API field | Source |
|---|---|
| `title` | `progress_snapshots.level_1..5` + `membership_snapshots.credentials` (DTM check) |
| `nextLevel` | first `false` among `level_1..5`, then `path_done`, via `nextLevelFromFlags` |
| `remaining` / `LevelGroup.projects` | **`project_snapshots`** (new table, Phase 3) |
| `LevelGroup.approved` | `progress_snapshots.level_N` / `path_done` |
| `/api/diff` | `getProgressDiff()` + `getMembershipDiff()` (unchanged) |

**New `project_snapshots` table (Phase 3 prerequisite).** Per-project detail lives only in
`details.csv` today. SQLite must store it before the detail API or CSV removal is safe.

```sql
CREATE TABLE project_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT    NOT NULL,
  email       TEXT    NOT NULL,
  path_name   TEXT    NOT NULL,
  level       TEXT    NOT NULL,   -- "Level 1" … "Path Completion"
  lesson      TEXT    NOT NULL,
  complete    INTEGER NOT NULL,   -- 0/1
  type        TEXT    NOT NULL    -- "Core" | "Elective"
);
```

`fetch.ts` already builds this data in memory (`detailEntries`). Phase 3 adds a
`snapshotProjects()` writer alongside the existing `snapshotProgress()`.

## Migration strategy — incremental, not big-bang

1. **Phase 3:** add `project_snapshots` + writer; keep the HTML server working; switch the
   detail view to read from SQLite (validates the data path).
2. **Phase 4a:** install Next.js alongside the existing Node server; scaffold `app/` and
   API routes; the old `npm run ui` still works in parallel.
3. **Phase 4b:** build React pages against the live `/api/*` routes; verify view parity.
4. **Phase 4c:** `npm run dev` is now `next dev`; remove `services/ui.ts` HTML render code.
5. **Phase 6:** delete CSV-writing paths, `analyze.ts`, `scripts/` once SQLite is authoritative.

## `"type": "module"` compatibility note

The existing package has `"type": "module"`. Next.js 15 supports ESM. Keep the flag; in
`next.config.ts` set `experimental: { esmExternals: true }` if native modules like
`better-sqlite3` require it. API routes import `helpers/db.ts` directly — `better-sqlite3`
is server-only, which is correct in App Router (API routes never ship to the browser).

## Consequences

- **Positive:** unified package, one dev command, accessible shadcn components, SQLite becomes
  the sole source of truth, no proxy or multi-process dev setup.
- **Negative / risks:** `next build` is required before `next start` in production (not needed
  for `next dev`); per-project data must be re-snapshotted after `fetch` before the detail
  view is correct — document this in the README.
- **Neutral:** CLI and `fetch`/`membership` flows unchanged; Docker updated to run
  `next build && next start` instead of the old Node server.
