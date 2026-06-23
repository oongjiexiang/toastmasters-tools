# Feature Spec: React Migration + Shadcn UI

## Problem

`services/ui.ts` builds every page by concatenating HTML strings. There is no
component model and no client-side interactivity — any state change needs a
full server round-trip. The All-Levels accordion
(`feature-member-detail-all-levels.md`) needs client-side expand/collapse
state, which this approach can't deliver cleanly. The UI also still carries a
CSV fallback path (`loadFromCsvs`) that duplicates the SQLite logic.

## Goal

Migrate the web UI to a **React single-page app** styled with **shadcn/ui**,
backed by a small **JSON REST API** on the existing Node HTTP server. The
React build output is served as static assets from that same server, so
`npm run ui` still launches one process on `localhost:3000`.

## User Stories

- As VPE, I open `localhost:3000` and get a clean, modern dashboard backed by
  React components instead of raw HTML.
- As VPE, I click a member and the detail page (all levels, accordion) renders
  client-side with no full-page reload.
- As VPE, I can download the latest membership CSV from a button in the UI.
- As the developer, I have a JSON API I can build new views against without
  touching HTML-string rendering.

## Acceptance Criteria

### Backend API

- `GET /api/members` → JSON array of summary rows
  (`name, title, pathway, nextLevel, remaining`, plus an `id` to link to
  detail). One row per member per pathway, matching today's dashboard.
- `GET /api/members/:id/detail` → JSON for one member+pathway: member meta
  plus an ordered list of all levels (1–5 + Path Completion), each with its
  approved flag, `done`/`total` counts, and its projects
  (`name, status, type`). This is the shape the All-Levels view consumes.
- `GET /api/membership.csv` → the latest membership CSV as a file download
  (correct `Content-Disposition` / `Content-Type`).
- SQLite is the **single source of truth**. The CSV-based fallback
  (`loadFromCsvs`) is **dropped**; if the DB has no data, the API returns an
  empty result with a clear message for the UI to render.
- `id` is a stable identifier for a member+pathway pair (e.g. an
  encoded `email|pathName`), so detail links survive between runs.

### Frontend

- React SPA built with a standard toolchain (Vite assumed) and styled with
  **shadcn/ui** (Radix + Tailwind). SA makes the final library call; shadcn
  is the named candidate.
- Views:
  - **Dashboard**: summary table (sortable is a nice-to-have), member names
    link to detail.
  - **Member detail**: all-levels accordion per
    `feature-member-detail-all-levels.md`, including Expand/Collapse All.
  - **Download Membership CSV** button (calls `/api/membership.csv`).
- Data is fetched from the JSON API; no HTML is rendered server-side.

### Serving / build

- React build output (e.g. `dist/`) is served as **static assets** by the
  Node HTTP server. The server also serves the `/api/*` routes.
- `npm run ui` runs the server on `localhost:3000` and serves the built app.
- A dev mode is acceptable where Vite's dev server proxies `/api/*` to the
  Node server — but the production-equivalent (`npm run ui`) must serve the
  built assets from the Node server on a single port.
- A build step is introduced **only for the UI** (`npm run ui:build` or
  similar). The CLI (`tsx`) stays build-free, preserving the tech-stack
  "no build step for the CLI" constraint.

### Non-functional

- Localhost-only. **No auth, no hosting, no CI/CD** for this feature.
- Docker must still launch the UI after the change (per tech-stack constraint).

## Out of Scope

- Authentication, multi-user, or remote hosting.
- Replacing or restyling the CLI output.
- New data/metrics beyond what the API exposes above.
- Real-time updates / websockets — fetch-on-load is sufficient.
- Historical/trend views (future work).

## Open Questions

1. Toolchain: Vite + React + TypeScript assumed. Confirm, or prefer something
   lighter (e.g. esbuild-only, no framework)?
2. Where does the React app live in the repo (`web/`, `ui/`) and where does its
   build output land so the Node server can serve it?
3. shadcn/ui pulls in Tailwind + a `components/` scaffold. Acceptable footprint
   for personal tooling, or prefer a lighter component set (e.g. plain Radix or
   Pico CSS)? SA to decide.
4. Should `/api/members` and the detail endpoint be added **first** (so the
   current HTML UI can keep working against them) and the React frontend land
   second, to de-risk the migration? Recommendation: yes — ship the API, then
   swap the frontend.
