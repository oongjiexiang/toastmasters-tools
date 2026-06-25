# Roadmap

Phases are ordered so each one delivers usable value on its own. A phase should be
completable in a single sitting. Each phase lists a concrete validation criterion.

> **Sequencing note (load-bearing):** per-project lesson detail currently lives **only**
> in `details.csv`. SQLite stores level approval flags, not individual projects. So the
> "all levels" detail view (Phase 3) first migrates per-project data into SQLite. Only
> after that is the CSV layer safe to remove (Phase 6). Do not reorder these.

---

## Phase 0 — Done (baseline)

- [x] Fetch Basecamp progress for all members (`progress.csv`, `details.csv`)
- [x] Download TI membership roster (`membership-YYYY-MM-DD.csv`)
- [x] Generate unified summary (`summary.csv`)
- [x] Interactive CLI launcher (`npm start`)
- [x] Docker support

**Validation:** `npm run analyze` produces a `summary.csv` whose row count matches paid
members in the membership CSV; spot-checking 2–3 known members confirms title and next project.

---

## Phase 1 — Done (SQLite persistence)

- [x] Add `better-sqlite3`; snapshot progress + membership rows on each run
- [x] `npm run diff` compares the two most recent snapshots

**Validation:** Run `fetch` + `membership` twice; `npm run diff` prints a non-empty change
list reflecting a known difference between snapshots.

---

## Phase 2 — Done (Local web UI)

- [x] Local HTTP server (`npm run ui`) serving a dashboard on `localhost:3000`
- [x] Table view: members with pathway, title, projects remaining in next level
- [x] Detail view: every project in the member's **next** level (done vs. outstanding)
- [x] Reads from SQLite; falls back to latest CSVs

**Validation:** Open `localhost:3000`, click a known member, confirm the next-level project
list matches `details.csv`.

---

## Phase 3 — Member detail across ALL levels

_Today the detail page only shows the next level. The VPE needs the full picture._

- [x] **Persist per-project detail in SQLite** (`project_snapshots` table) on each `fetch`
      run — this is the prerequisite that unblocks Phase 6
- [x] Detail view lists **every** project across Levels 1–5 + Path Completion, grouped by
      level in expand/collapse accordions (default: expanded)
- [x] Expand all / Collapse all controls
- [x] Per-level completion badge (e.g. "3 / 4" or "Complete")

**Validation:** Open a member who has completed Level 1 but not Level 3. The detail page
shows all six level groups; Level 1 is badged complete, Level 3 lists its outstanding
projects, and the figures match `details.csv` for that member.

---

## Phase 4 — Next.js + shadcn/ui migration

_See `architecture-react.md` (ADR) for the full decision, API contract, and migration steps._

- [x] Install Next.js 15 + React 19 + Tailwind + shadcn/ui into the existing root package
      (no separate `web/` subfolder — unified codebase)
- [x] Add Next.js API routes (`app/api/…`) — replaces the hand-rolled Node HTTP server
- [x] Rebuild dashboard + all-levels detail view (Phase 3) as React components using shadcn/ui
- [x] `npm run dev` (`next dev`) serves both the UI and API on `localhost:3000`
- [x] Old HTML string server (`services/ui.ts`) removed once React UI reaches parity

**Validation:** `npm run dev` serves the React dashboard on `localhost:3000`; every Phase 2/3
view works; API routes read directly from SQLite; no CSV reads in the request path.

---

## Phase 5 — Testing infrastructure

_Establish the framework and baseline coverage. Partially complete (unit tests written; npm install pending)._

- [x] Add **vitest** + `@vitest/coverage-v8` to `package.json`; `npm test`, `npm run test:watch`, `npm run test:coverage`
- [x] 122 unit tests for `helpers/pathway.ts` (71) and `helpers/db.ts` (40) + API route smoke tests (11) — all passing
- [x] `vitest.config.ts` committed (includes `@/` alias for API route mocking)
- [x] Run `npm install` to sync `package-lock.json` with the new vitest devDependencies
- [x] Add coverage for Next.js API route mappers
- [x] Coverage target: 100% lines on `helpers/pathway.ts`, smoke coverage on each API route (76–90%)

**Validation:** `npm test` passes with no failures; `npm run test:coverage` reports ≥90% line
coverage on `helpers/pathway.ts` and `helpers/db.ts`.

---

## Phase 6 — CSV cleanup

_The dashboard is now authoritative. The CSV workarounds predate it. Requires Phase 3's
`project_snapshots` table (per-project detail must already live in SQLite)._

- [x] Delete `results/details.csv`, `results/progress.csv`, `results/summary.csv` and stop
      writing them from `fetch`
- [x] **Keep** `membership-YYYY-MM-DD.csv` (downloadable from the UI)
- [x] Remove `services/analyze.ts`, `services/diff.ts`, and `scripts/validate-phase1.ts`
- [x] Prune npm scripts: removed `analyze`, `diff`, `validate`. Keep `fetch`,
      `membership`, `cli`, `dev`, `build`, `start` (Next.js), `test`

**Validation:** Fresh clone → `npm run fetch && npm run ui` produces a fully working
dashboard (including all-levels detail and diff) with no `details.csv`/`progress.csv`/
`summary.csv` on disk and no code referencing them.

---

## Phase 7 — In-browser data refresh

_Today fetching requires running CLI commands before opening the dashboard. This phase lets the VPE trigger a data refresh directly from the web UI._

- [ ] Add a **Refresh** button (or split "Fetch progress" / "Fetch membership" buttons) to the dashboard
- [ ] Each button calls a Next.js API route (`POST /api/refresh/progress`, `POST /api/refresh/membership`) that spawns the existing scraper logic server-side
- [ ] Cookies (`BASECAMP_SESSIONID`, TI credentials) remain in `.env`; the API routes read them from `process.env` — no credential input in the browser
- [ ] Show a loading/spinner state while the scrape is in progress and surface any error (e.g. expired cookie) as a toast or inline message
- [ ] On success, invalidate and reload the dashboard data automatically

**Validation:** Open `localhost:3000`, click Refresh, confirm the dashboard updates with fresh data without touching the terminal.

---

## Deferred — Hardened pipeline (was Phase 3, low priority)

_Pain point: cookie expiry silently breaks runs; manual step order is error-prone._

- [ ] `npm run all` runs fetch → membership in sequence, stopping cleanly on first failure
- [ ] Detect expired/invalid cookies at startup with a precise remediation message
- [ ] Warn when `results/` inputs are older than N days

**Validation:** Set an invalid `BASECAMP_SESSIONID` and run `npm run all` — it exits
immediately naming the cookie and refresh steps, with no API calls or file writes.
