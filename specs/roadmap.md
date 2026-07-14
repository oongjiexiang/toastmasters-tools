# Roadmap

Phases are ordered so each one delivers usable value on its own. A phase should be
completable in a single sitting. Each phase lists a concrete validation criterion.

> **Agent workflow:** implement the phase → run its **Validation** steps → if they all pass,
> report what was done and ask the user to commit. Do **not** commit without explicit instruction.

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

**Validation (historical):** Superseded by Phases 4–6; the CSV pipeline and `summary.csv`
no longer exist. No re-validation needed.

---

## Phase 1 — Done (SQLite persistence)

- [x] Add `better-sqlite3`; snapshot progress + membership rows on each run
- [x] `npm run diff` compares the two most recent snapshots

**Validation (historical):** `npm run diff` was removed in Phase 6. Current equivalent is
`GET /api/diff`. No re-validation needed.

---

## Phase 2 — Done (Local web UI)

- [x] Local HTTP server (`npm run ui`) serving a dashboard on `localhost:3000`
- [x] Table view: members with pathway, title, projects remaining in next level
- [x] Detail view: every project in the member's **next** level (done vs. outstanding)
- [x] Reads from SQLite; falls back to latest CSVs

**Validation (historical):** The hand-rolled Node server (`services/ui.ts`) was removed in
Phase 4 and replaced by Next.js. No re-validation needed.

---

## Phase 3 — Done (Member detail across ALL levels)

_Today the detail page only shows the next level. The VPE needs the full picture._

- [x] **Persist per-project detail in SQLite** (`project_snapshots` table) on each `fetch`
      run — this is the prerequisite that unblocks Phase 6
- [x] Detail view lists **every** project across Levels 1–5 + Path Completion, grouped by
      level in expand/collapse accordions (default: expanded)
- [x] Expand all / Collapse all controls
- [x] Per-level completion badge (e.g. "3 / 4" or "Complete")

**Validation:**
1. `grep "project_snapshots" helpers/db.ts` — table definition and `snapshotProjects` writer present
2. `npm test` passes
3. With dev server running: `curl -s "http://localhost:3000/api/members/<email>?pathway=<path>" | grep -c '"level"'` — returns 6 (one per level group)

---

## Phase 4 — Done (Next.js + shadcn/ui migration)

_See `architecture-react.md` (ADR) for the full decision, API contract, and migration steps._

- [x] Install Next.js 15 + React 19 + Tailwind + shadcn/ui into the existing root package
      (no separate `web/` subfolder — unified codebase)
- [x] Add Next.js API routes (`app/api/…`) — replaces the hand-rolled Node HTTP server
- [x] Rebuild dashboard + all-levels detail view (Phase 3) as React components using shadcn/ui
- [x] `npm run dev` (`next dev`) serves both the UI and API on `localhost:3000`
- [x] Old HTML string server (`services/ui.ts`) removed once React UI reaches parity

**Validation:**
1. `npm run build` exits 0 with no TypeScript errors
2. `test ! -f services/ui.ts` — old server removed
3. Files exist: `app/api/members/route.ts`, `app/api/members/[email]/route.ts`, `app/api/diff/route.ts`
4. `npm test` passes

---

## Phase 5 — Done (Testing infrastructure)

_Establish the framework and baseline coverage._

- [x] Add **vitest** + `@vitest/coverage-v8` to `package.json`; `npm test`, `npm run test:watch`, `npm run test:coverage`
- [x] 122 unit tests for `helpers/pathway.ts` (71) and `helpers/db.ts` (40) + API route smoke tests (11) — all passing
- [x] `vitest.config.ts` committed (includes `@/` alias for API route mocking)
- [x] Run `npm install` to sync `package-lock.json` with the new vitest devDependencies
- [x] Add coverage for Next.js API route mappers
- [x] Coverage target: 100% lines on `helpers/pathway.ts`, smoke coverage on each API route (76–90%)

**Validation:**
1. `npm test` exits 0 with no failures
2. `npm run test:coverage` reports ≥90% line coverage on `helpers/pathway.ts` and `helpers/db.ts`

---

## Phase 6 — Done (CSV cleanup)

_The dashboard is now authoritative. The CSV workarounds predate it._

- [x] Delete `results/details.csv`, `results/progress.csv`, `results/summary.csv` and stop
      writing them from `fetch`
- [x] **Keep** `membership-YYYY-MM-DD.csv` (downloadable from the UI)
- [x] Remove `services/analyze.ts`, `services/diff.ts`, and `scripts/validate-phase1.ts`
- [x] Prune npm scripts: removed `analyze`, `diff`, `validate`. Keep `fetch`,
      `membership`, `cli`, `dev`, `build`, `start` (Next.js), `test`

**Validation:**
1. `grep -rE "details\.csv|progress\.csv|summary\.csv" services/ helpers/ app/ lib/` — no matches
2. `grep -E '"analyze"|"diff"|"validate"' package.json` — no matches (scripts removed)
3. `npm run build` exits 0

---

## Phase 7 — Done (Parallel detail fetching)

_`npm run fetch` fetches lesson detail for each member one at a time. Running detail fetches
concurrently cuts Step 2 wall time from O(N) to O(N/concurrency)._

- [x] Replace the sequential `for` loop in `services/fetch.ts` Step 2 with a **concurrency-limited** parallel runner (default concurrency: 5)
- [x] Implement the limiter inline (no new dependency needed — a simple semaphore/chunk loop suffices)
- [x] Preserve per-member progress logging (e.g. `[3/20] Alice Smith — Engaging Humor`)
- [x] Error handling stays per-member: one failed detail fetch logs a warning and continues; it does not abort the run
- [x] Concurrency cap is a constant at the top of `services/fetch.ts` (e.g. `const DETAIL_CONCURRENCY = 5`) so it can be tuned without touching logic

**Validation:**
1. `grep "DETAIL_CONCURRENCY" services/fetch.ts` — constant defined and set to a number
2. `grep "Promise.allSettled" services/fetch.ts` — parallel runner is present
3. `npm test` passes

---

## Phase 8 — Done (In-browser data refresh)

_Fetching previously required running CLI commands. This phase lets the VPE trigger a refresh
directly from the web UI._

- [x] Split "Refresh Progress" / "Refresh Membership" buttons always visible in the dashboard header
- [x] Each button calls a Next.js API route (`POST /api/refresh/progress`, `POST /api/refresh/membership`) that runs the existing scraper logic server-side
- [x] Cookies (`BASECAMP_SESSIONID`, TI credentials) remain in `.env`; the API routes read them from `process.env` — no credential input in the browser
- [x] Loading spinner on the active button; both buttons disabled while a refresh is in progress
- [x] Sonner toast: loading → success / error (first line of error message shown)
- [x] On success, dashboard data reloads automatically

**Validation:**
1. `npm run build` exits 0 — no TypeScript errors
2. Files exist: `app/api/refresh/progress/route.ts`, `app/api/refresh/membership/route.ts`
3. `grep -E "refreshProgress|refreshMembership" lib/api.ts` — both functions exported
4. `grep "Refresh Progress" app/page.tsx` — button label present in source
5. With dev server running:
   - `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/refresh/progress` — `500` (missing cookie), not `404`
   - `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/refresh/membership` — `500`, not `404`

> **Note:** Steps 1–5 validate code structure and API routing only. Visual UI behaviour
> (button visible on load, spinner state, toast text) requires the Playwright E2E tests
> added in Phase 9.

---

## Phase 9 — Done (E2E testing with Playwright)

_Steps 1–5 of Phase 8's validation confirm the code exists and the routes respond, but they
cannot verify that the button is visible, the spinner renders on click, or the toast fires.
This phase adds Playwright so that UI behaviour can be validated by the agent without manual
browser inspection._

- [x] Install `@playwright/test`; add `test:e2e` script to `package.json`
- [x] Add `playwright.config.ts` at the project root with `webServer` pointing at `next dev`
      and `testDir: './tests/e2e'`
- [x] Write `tests/e2e/dashboard.spec.ts`:
  - Both "Refresh Progress" and "Refresh Membership" buttons visible on every page state
  - Clicking "Refresh Progress" shows loading toast and disables both buttons
  - A Sonner loading toast is visible while the request is in progress
  - When cookies are missing/invalid, an error toast appears with the first line of the error
  - On success, the toast updates to success and the member data reloads
- [x] API responses mocked via `page.route()` — tests run without real Basecamp credentials

**Validation:**
1. `npx playwright install chromium` exits 0
2. `npx playwright test --reporter=list` exits 0 — 6 tests pass covering button visibility,
   loading toast, disabled state, error toast, and data reload after success

---

## Phase 10 — Next up (Monorepo restructure: extract shared core)

_The desktop app (Phase 11) must reuse the existing SQLite + scraping + pathway logic without
copy-paste. This phase carves that logic into a shared package so both the Next.js web app and
the Electron desktop app import one source of truth. It ships no user-facing change on its own —
its value is unblocking Phase 11 cleanly._

- [ ] Convert the repo to **npm workspaces**: root `package.json` gains a `workspaces` array
- [ ] Create `packages/core/` and move the framework-agnostic logic into it:
      `helpers/db.ts`, `helpers/pathway.ts`, `services/fetch.ts`, `services/membership.ts`,
      and their types. These must not import anything Next.js- or Electron-specific.
- [ ] Move the existing Next.js app under `apps/web/`; it imports core via `@toastmasters/core`
- [ ] All existing scripts (`fetch`, `membership`, `cli`, `dev`, `build`, `test`, `test:e2e`)
      continue to work from the root via workspace delegation
- [ ] Vitest + Playwright configs updated for the new paths; no test is deleted

**Validation:**
1. `grep '"workspaces"' package.json` — workspaces array present
2. `test -f packages/core/package.json` and `test -d apps/web` — new layout exists
3. `npm run build` exits 0 from the root
4. `npm test` passes (all Phase 5 unit tests green against the moved core)
5. `npx playwright test --reporter=list` exits 0 (Phase 9 E2E still green)

---

## Phase 11 — Next up (Electron desktop app / `.exe`)

_The VPE does not want to install Docker or run a Node dev server. This phase delivers a
double-clickable Windows `.exe` that bundles Node.js, the scrapers, SQLite, and the dashboard
into one native app — no terminal, no `npm run dev`._

**Stack (see `tech-stack.md` Layer 7):** Electron + `electron-vite` + React, packaged with
`electron-builder`. The Electron **main** process runs `@toastmasters/core` (SQLite + scrapers)
directly; the **renderer** reuses the existing React components, talking to main over IPC
instead of `fetch("/api/…")`.

- [ ] Create `apps/desktop/` (Electron main + preload + renderer) importing `@toastmasters/core`
- [ ] Main process exposes the current API surface over IPC: list members, member detail,
      diff, refresh progress, refresh membership, download membership CSV
- [ ] Preload script bridges IPC to the renderer via a typed `contextBridge` API (no `nodeIntegration`)
- [ ] Renderer reuses `MemberTable`, `LevelAccordion`, and the refresh-button header from the web app
- [ ] Credentials (`BASECAMP_SESSIONID`, TI login) read from a local `.env` / userData config file —
      never entered in a scraped page. SQLite DB lives in Electron `app.getPath('userData')`
- [ ] `npm run desktop:dev` runs the app with hot reload; `npm run desktop:build` produces a
      Windows installer `.exe` via `electron-builder` (NSIS target)
- [ ] **Write a user guide** — `apps/desktop/USER_GUIDE.md`, aimed at the VPE (non-technical):
      how to install the `.exe`, where to paste the Basecamp cookie / TI credentials the first
      time, how to hit Refresh, and how to read the dashboard. Keep it simple, intuitive, and
      concise — screenshots or short numbered steps, no jargon.

**Validation:**
1. `test -d apps/desktop` and `grep '"electron"' apps/desktop/package.json` — app scaffolded
2. `grep -E '"desktop:dev"|"desktop:build"' package.json` — both scripts present
3. `npm run desktop:build` produces a `.exe` under `apps/desktop/dist/` (or `release/`)
4. `test -f apps/desktop/USER_GUIDE.md` — end-user guide exists
5. Launching the built app shows the member table; clicking "Refresh Progress" with a valid
   cookie repopulates data (manual check — document the result)

---

## Deferred — Hardened pipeline (low priority)

_Pain point: cookie expiry silently breaks runs; manual step order is error-prone._

- [ ] `npm run all` runs fetch → membership in sequence, stopping cleanly on first failure
- [ ] Detect expired/invalid cookies at startup with a precise remediation message
- [ ] Warn when `results/` inputs are older than N days

**Validation:**
1. `grep '"all"' package.json` — `npm run all` script exists
2. With `BASECAMP_SESSIONID=invalid npm run fetch` — exits non-zero within seconds and prints a message naming the cookie and the remediation steps; no SQLite writes occur
3. `npm test` passes
