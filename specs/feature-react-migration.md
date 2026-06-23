# Feature Spec: Next.js + shadcn/ui Migration

## Problem

`services/ui.ts` builds every page by concatenating HTML strings. There is no component model
and no client-side interactivity — any state change needs a full server round-trip. The
All-Levels accordion (`feature-member-detail-all-levels.md`) needs client-side expand/collapse
state, which this approach cannot deliver cleanly. The UI also carries a CSV fallback path
(`loadFromCsvs`) that duplicates the SQLite logic and will become dead code once SQLite is
the sole source of truth.

## Goal

Migrate the web UI to **Next.js 15** (App Router, React 19) styled with **shadcn/ui**, backed
by Next.js API routes that read directly from SQLite. One `npm run dev` command replaces the
current `npm run ui`. No separate frontend package or build proxy is needed.

## User Stories

- As VPE, I open `localhost:3000` and get a clean, modern dashboard.
- As VPE, I click a member and the detail page (all levels, accordion) renders client-side
  with no full-page reload.
- As VPE, I can download the latest membership CSV from a button in the UI.
- As the developer, I have a JSON REST API I can build new views against without touching
  HTML-string rendering.

## Acceptance Criteria

### Backend — Next.js API routes

| Method | Path | Response |
|---|---|---|
| GET | `/api/members` | `MemberSummary[]` — one object per person, with `pathways[]` sub-array |
| GET | `/api/members/:email?pathway=<name>` | `MemberDetail` for that member × pathway |
| GET | `/api/diff` | `{ progress: ProgressDiff, membership: MembershipDiff }` |
| GET | `/api/membership-file` | latest `membership-*.csv` as `Content-Disposition: attachment` |

SQLite is the **single source of truth**. The CSV-based fallback (`loadFromCsvs`) is removed.
If the DB has no snapshot yet, the API returns a `503` with `{ error: { code: "SNAPSHOT_MISSING" } }`
and the UI renders an actionable empty state.

For the full response shapes and error envelope, see `architecture-react.md`.

### Frontend — React pages (Next.js App Router)

- **`/` (Dashboard):** member roster table — one row per person, sub-rows for multi-pathway
  members (see `ui-design-react.md §1`). Member name links to the detail view.
- **`/members/[email]?pathway=<name>` (Detail):** all-levels accordion per
  `feature-member-detail-all-levels.md`, including Expand/Collapse All.
- **Download button:** calls `/api/membership-file` — browser triggers a file download.
- All data is fetched from the JSON API; no HTML is rendered server-side on the React pages
  (pages are client components that call the API routes).

### Serving

- `npm run dev` → `next dev` — development server on `localhost:3000`, HMR, no proxy needed.
- `npm run build` → `next build` — production build.
- `npm start` → `next start` — production server.
- The CLI scripts (`npm run fetch`, `npm run membership`) are unchanged.
- `npm run cli` → `tsx index.ts` — renamed from the old `npm start` (CLI menu launcher).

### Cleanup on completion

- `services/ui.ts` is deleted (all routing moves to Next.js API routes + pages).
- The CSV fallback (`loadFromCsvs`) is deleted.
- `npm run ui` script is removed from `package.json`.
- Docker is updated to run `next build && next start` instead of `tsx services/ui.ts`.

### Non-functional

- Localhost-only. No auth, no hosting, no CDN.
- Docker must still launch the UI after this change.
- The CLI (`tsx`) stays build-free — the build step is for Next.js only.

## Out of Scope

- Authentication, multi-user, or remote hosting.
- Replacing or restyling the CLI output.
- New data or metrics beyond what the API exposes above.
- Real-time updates / websockets.
- Historical/trend views (future work).

## Resolved Decisions

| Question | Decision |
|---|---|
| Framework | **Next.js 15** (not Vite; no separate `web/` subfolder). See `architecture-react.md`. |
| Component library | **shadcn/ui** (Radix + Tailwind). CLI copies source into `components/ui/`. |
| Repo structure | Everything in the root package — no monorepo, no subfolder with its own `package.json`. |
| Migration strategy | Incremental: add API routes first (HTML server still works), then build React pages, then remove HTML server. |
