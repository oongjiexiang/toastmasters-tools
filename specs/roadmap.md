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
- [x] Docker support (retired in Phase 10 — see below)

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

## Phase 10 — Done (Monorepo restructure: extract shared core)

_The desktop app (Phase 11) must reuse the existing SQLite + scraping + pathway logic without
copy-paste. This phase carves that logic into a shared package so both the Next.js web app and
the Electron desktop app import one source of truth. It ships no user-facing change on its own —
its value is unblocking Phase 11 cleanly._

- [x] Convert the repo to **npm workspaces**: root `package.json` gains a `workspaces` array
      (`["apps/*", "packages/*"]`)
- [x] Create `packages/core/` (`@toastmasters/core`, private, no build step — runs via `tsx`) and
      move the framework-agnostic logic into it: `config.ts`, `types.ts`,
      `helpers/{db,pathway,api,files}.ts`, `services/{fetch,membership}.ts`, and `index.ts`
      (the interactive CLI). Consumed through package `exports` subpaths — `@toastmasters/core/db`,
      `/pathway`, `/api`, `/files`, `/config`, `/paths`, `/types`, `/fetch`,
      `/membership`. These must not import anything Next.js- or Electron-specific.
- [x] Drop `helpers/csv.ts` (`buildCsv` / `buildDetailCsv`) and the `csv-stringify` dependency.
      Both were orphaned by the Phase 6 CSV cleanup — no importer remained — and the restructure
      had carried them into core mechanically. `csv-parse` stays (`helpers/db.ts` uses it).
- [x] Move the existing Next.js app under `apps/web/` (`@toastmasters/web`); it imports core via
      `@toastmasters/core` and declares `transpilePackages: ["@toastmasters/core"]` in
      `next.config.ts`. Its `@/*` alias now resolves within `apps/web`.
- [x] All existing scripts (`fetch`, `membership`, `cli`, `dev`, `build`, `start`, `test`,
      `test:e2e`) continue to work unchanged from the root via workspace delegation
- [x] Vitest + Playwright configs updated for the new paths; no test is deleted — tests split into
      `packages/core/tests/` (163) and `apps/web/tests/{api,e2e}/` (13 unit + 6 E2E). **176** unit/API
      tests in total.
- [x] `packages/core/tests/workspace.test.ts` guards the structural invariants: the `exports` map,
      the public symbols the web routes call, and that no core source imports `next`/`react`.
      That last invariant is the precondition for Phase 11.
- [x] **Data-path resolution fixed (regression introduced by this restructure).** `results/` and
      `.env` were resolved relative to `process.cwd()`, but workspace scripts run with cwd = the
      workspace directory — so `npm run fetch` would have used `packages/core/results/db.sqlite`
      while `npm run dev` used `apps/web/results/db.sqlite`, splitting the CLI and the dashboard
      across two databases, orphaning the real data at the repo root, and leaving the root `.env`
      unread. Fixed with `packages/core/paths.ts`: `REPO_ROOT` is found by walking up from
      `import.meta.url` (never cwd) to the `package.json` declaring `workspaces`; `ENV_FILE` and
      `DATA_DIR` derive from it, making `RESULTS_DIR` and `DEFAULT_DB_PATH` absolute.
      `TOASTMASTERS_DATA_DIR` (absolute) overrides `DATA_DIR` — the hook Phase 11 uses for
      Electron's `app.getPath('userData')`. Exported as a tenth subpath, `@toastmasters/core/paths`.
      No data migration was needed. Guarded by `packages/core/tests/paths.test.ts`, which spawns
      `tsx` out-of-process with the cwd set to each workspace and asserts every anchor resolves to
      the repo root, plus negative-control tests that fail if the guard is ever weakened.
- [x] **Docker retired** (user-approved): `Dockerfile` and `.dockerignore` deleted. The image had
      been broken since the Phase 4 Next.js migration — it never ran `npm run build`, and
      `npm ci --omit=dev` stripped `tsx`/`typescript`, so neither the CLI nor the dashboard could
      start. It has no CI consumer and is superseded by the Phase 11 `.exe`. Recoverable from git
      history: `git show 2912204:Dockerfile`.

**Validation:**
1. `grep '"workspaces"' package.json` — workspaces array present
2. `test -f packages/core/package.json` and `test -d apps/web` — new layout exists
3. `npm run build` exits 0 from the root
4. `npm test` passes (all Phase 5 unit tests green against the moved core)
5. `npx playwright test --reporter=list` exits 0 (Phase 9 E2E still green)
6. `test ! -f Dockerfile && test ! -f .dockerignore` — Docker removed
7. `test -f packages/core/tests/paths.test.ts` — the out-of-process path regression suite exists
   and runs as part of `npm test` (core's vitest `include` is `tests/**/*.test.ts`)
8. Both workspace cwds resolve the database to the repo root — run from `packages/core` and again
   from `apps/web`:
   `npx tsx -e "import('@toastmasters/core/db').then(m => console.log(m.DEFAULT_DB_PATH))"` —
   prints the same `<repo>/results/db.sqlite` both times

---

## Phase 11 — Done (Electron desktop app / `.exe`)

_The VPE does not want to install Docker or run a Node dev server. This phase delivers a
double-clickable Windows `.exe` that bundles Node.js, the scrapers, SQLite, and the dashboard
into one native app — no terminal, no `npm run dev`._

**Stack (see `tech-stack.md` Layer 7):** Electron + `electron-vite` + React, packaged with
`electron-builder`. The Electron **main** process runs `@toastmasters/core` (SQLite + scrapers)
directly; the **renderer** reuses the existing React components, talking to main over IPC
instead of `fetch("/api/…")`.

**Prerequisite met:** Phase 10 shipped `packages/core` — the file paths below are unchanged, and
`@toastmasters/core` now exists as a real workspace package with a framework-agnostic guarantee
enforced by `packages/core/tests/workspace.test.ts`. `apps/desktop/` is a new sibling of
`apps/web/` under the existing `workspaces: ["apps/*", "packages/*"]` array — no root
restructuring is required.

- [x] Create `apps/desktop/` (Electron main + preload + renderer) importing `@toastmasters/core`
- [x] Main process exposes the current API surface over IPC: list members, member detail,
      diff, refresh progress, refresh membership, download membership CSV
- [x] Preload script bridges IPC to the renderer via a typed `contextBridge` API (no `nodeIntegration`)
- [x] Renderer reuses `MemberTable`, `LevelAccordion`, and the refresh-button header from the web app
- [x] Credentials (`BASECAMP_SESSIONID`, TI login) read from a local `config.env` in Electron's
      userData dir (see `apps/desktop/src/main/credentials.ts`) — never entered in a scraped page.
      SQLite DB lives in Electron `app.getPath('userData')` via the `TOASTMASTERS_DATA_DIR` hook
- [x] `npm run desktop:dev` runs the app with hot reload; `npm run desktop:build` produces a
      Windows installer `.exe` via `electron-builder` (NSIS target)
- [x] **Write a user guide** — `apps/desktop/USER_GUIDE.md`, aimed at the VPE (non-technical):
      install, first-time cookie setup (File → Open Credentials File…), Refresh, reading the
      dashboard, exporting the roster, troubleshooting. Simple numbered steps, no jargon.

**Validation:**
1. [x] `test -d apps/desktop` and `grep '"electron"' apps/desktop/package.json` — app scaffolded
2. [x] `grep -E '"desktop:dev"|"desktop:build"' package.json` — both scripts present
3. [x] `npm run desktop:build` produces `apps/desktop/release/Toastmasters Tools Setup 1.0.0.exe`
       (88 MB, NSIS). The emitted `out/main` bundle is also rebuilt and evaluated on every
       `npm test` by `apps/desktop/tests/main-bundle.test.ts`, which guards the load-bearing
       import-order invariant (core is never reached before `TOASTMASTERS_DATA_DIR` is set)
4. [x] `test -f apps/desktop/USER_GUIDE.md` — end-user guide exists
5. [ ] **Manual (pending user):** launch the installed `.exe`, paste a live cookie, click
       "Refresh Progress", confirm the member table repopulates. Not verifiable headlessly —
       the automated proxy is the full 267-test suite (incl. IPC handlers + bundle evaluation).

---

## Phase 12 — Done (In-app Toastmasters login) — no more cookie pasting

_Today the VPE must open DevTools, copy `BASECAMP_SESSIONID` and the full `TI_COOKIE`
string by hand, and paste them into `config.env` (Phase 11). This phase replaces that with
a real login: the user clicks **Log in**, authenticates on the genuine Toastmasters pages
inside an embedded window (username/password, MFA, SSO — whatever TI presents), and the app
harvests the resulting session cookies itself. **Electron only** — the browser's cross-origin
cookie isolation makes this impossible for the Next.js web app, which keeps the manual paste
(and can read the `config.env` the desktop app now writes)._

**Why this is an Electron-only capability:** the scrapers authenticate purely by sending a
`Cookie` header (`packages/core/helpers/api.ts:11`, `packages/core/services/membership.ts:44`).
Electron's **main-process** `session.cookies.get()` can read those cookies — including the
**httpOnly** auth cookies a renderer `document.cookie` read would silently miss — from a real
Chromium session after the user logs in. We never see the password; it goes straight to TI over
HTTPS. We only read the cookies from our own session store.

**Load-bearing constraint (discovered, must be solved first):** `config.ts` freezes `SESSION_ID`
and `TI_COOKIE` into module-level consts at import time (`packages/core/config.ts:6-7`), and core
is imported lazily but **once**. A login that happens after that first import would have no effect
until an app restart. So core must read the two cookies **dynamically** (live from `process.env`
at request time), not from frozen consts. This is a framework-agnostic change (no Electron import)
that also lets the web app pick up refreshed cookies without a server restart.

- [x] **Core: dynamic cookie reads.** Add live accessors in `packages/core/config.ts`
      (e.g. `getSessionId()` / `getTiCookie()` reading `process.env` at call time) and switch
      `helpers/api.ts` (`buildHeaders`) and `services/{fetch,membership}.ts` to use them instead
      of the frozen `SESSION_ID` / `TI_COOKIE` consts. Keep the consts exported for
      backward-compat. `DATA_DIR` / `DEFAULT_DB_PATH` stay frozen (correct — SQLite opens at
      import). Update `packages/core/tests/workspace.test.ts` if it asserts the const surface.
- [x] **Desktop: `src/main/auth.ts`.** A persistent session partition
      (`persist:toastmasters`) so the login survives app restarts. Pure, unit-testable helpers:
  - `harvestCookies(session)` → reads `sessionid` from
    `https://basecamp.toastmasters.org/` and joins every cookie for
    `https://www.toastmasters.org/` into one `name=value; …` string, returning
    `{ basecampSessionId?, tiCookie? }`.
  - `applyCookies(...)` → writes non-empty values into `config.env` (reusing the
    `credentials.ts` writer) **and** sets `process.env` live, so the very next refresh uses them.
- [x] **Desktop: login window + flow.** `openLoginWindow(url)` opens a `BrowserWindow` bound to
      the persistent partition's session, loading the **genuine** HTTPS Toastmasters page.
      Security: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, **no preload**
      — it shows a third-party page and must not reach our IPC bridge. The **Log in** action runs
      a sequence that handles both the SSO and non-SSO cases without prior knowledge: open the TI
      login window → on close, harvest → if the Basecamp `sessionid` was **not** captured by SSO,
      open the Basecamp login window → harvest again. Harvesting logs which cookies were found.
- [x] **Desktop: IPC + menu + startup self-heal.** New channels `AUTH_LOGIN` (run the flow,
      return which credentials were obtained) and `AUTH_STATUS` (which cookies are currently
      non-empty). A **File → Log in to Toastmasters…** menu item. On startup, after
      `loadCredentials`, re-harvest from the persistent session and set `process.env` if cookies
      are present — this is what keeps the user logged in across restarts. Keep **Open Credentials
      File…** as the manual fallback.
- [x] **Desktop: renderer UX.** A **Log in** control injected via a new _optional_ `authControl`
      slot on the shared `DashboardHeader` (undefined for the web app — no web behaviour change).
      When a refresh fails with an auth-shaped error (HTTP 401/403), the error toast offers a
      "Log in again" action that triggers `AUTH_LOGIN`; on success, re-run the pending refresh and
      reload the table.
- [x] **Update `apps/desktop/USER_GUIDE.md`** — replace the DevTools cookie-copying steps with:
      click **Log in**, sign in on the Toastmasters window(s), done. Keep the manual paste as a
      "if login doesn't work" fallback. Note that logins persist until the session expires.

**Validation:**
1. [x] `grep -E "getSessionId|getTiCookie" packages/core/config.ts` — live accessors present, and
   `grep -n "process.env" packages/core/config.ts` shows them reading env at call time
2. [x] `grep -E "getSessionId|getTiCookie" packages/core/helpers/api.ts packages/core/services/membership.ts`
   — scrapers no longer bind the frozen consts
3. [x] `test -f apps/desktop/src/main/auth.ts` and `grep "persist:toastmasters" apps/desktop/src/main/auth.ts`
   — persistent-partition login module exists
4. [x] `grep -E "AUTH_LOGIN|AUTH_STATUS" apps/desktop/src/shared/ipc.ts` — channels declared
5. [x] `grep -i "Log in to Toastmasters" apps/desktop/src/main/index.ts` — menu item present
6. [x] `npm test` — full suite green (dynamic-cookie change + new `auth.ts` pure-helper unit tests
   with a mocked `session.cookies.get`). **298 tests pass.**
7. [x] `npm run build` exits 0 (web app unaffected by the new optional header slot)
8. [x] `npm run desktop:build` produces the NSIS installer
   `apps/desktop/release/Toastmasters Tools Setup 1.0.0.exe` (~91.6 MB). Code-signing is
   skipped — no certificate — so the installer is unsigned (SmartScreen "unknown publisher",
   as in Phase 11).
9. [ ] **Manual (pending user — not headlessly verifiable, mirrors Phase 11 step 5):** launch the app,
   click **Log in**, complete the real Toastmasters login once, then click **Refresh Progress** and
   **Refresh Membership** with an empty `config.env` — both succeed using only the harvested
   cookies. Confirms whether a single TI login also covers Basecamp (SSO) or the second login
   window is needed; the harvest log records which cookies each step captured.

---

## Phase 13 — Repo README refresh + GitHub Actions CI/CD  ← current priority

_The 1.0 release is tagged, but the repo has no automated checks and the README still
describes the pre-desktop state. This phase makes `main` self-verifying (tests run on every
push/PR) and turns a version tag into a downloadable Windows installer, then brings the
README up to date with the shipped monorepo. **Higher priority than the Deferred item below.**_

### Part A — README refresh (`README.md`)
The README predates Phases 10–12 and has drifted:
- [x] Desktop app is **shipped**, not "planned" — rewrite the Phase 11/12 "planned" asides
      (Data storage, Importing core, the `TI_COOKIE` note) to describe `apps/desktop` as real.
- [x] Add `apps/desktop` to the **Project structure** tree and document `npm run desktop:dev`
      / `npm run desktop:build` in the **Commands** table (and that `npm test` now covers
      core + web + **desktop**).
- [x] Fix the core subpath list: add `/queries` (10th subpath, Phase 11) and remove the dead
      `helpers/csv.ts` reference (deleted in Phase 10).
- [x] Add a short **Desktop app** section: what the `.exe` is, that CI publishes it on a
      version tag (link to GitHub Releases), and the in-app **Log in** flow (Phase 12).
- [x] Add a **CI status badge** at the top (points at the workflow from Part B).
- [x] Bump the Node prerequisite to match CI (Node 20 LTS).

### Part B — GitHub Actions CI/CD (`.github/workflows/`)
No workflows exist yet. Add:
- [x] **`ci.yml` — test job** (`ubuntu-latest`, Node 20, `npm ci`): runs `npm test` (core +
      web + desktop, incl. the `electron-vite`-rebuild bundle test) and the Playwright E2E
      suite (`npx playwright install --with-deps chromium` + `npm run test:e2e`). Triggers on
      **push** (all branches) and **pull_request** to `main`. This is the gate that keeps
      `main` green.
- [x] **`release.yml` — desktop build/publish job** (`windows-latest`, Node 20 — required:
      the NSIS installer and the `better-sqlite3` native rebuild must run on real Windows):
      `npm ci` → `npm run desktop:build` → collect `apps/desktop/release/*.exe` (+ `.blockmap`).
      **Triggers (decided): version tags** (`v*` / `1.0`-style) **and `workflow_dispatch`** —
      not every main push, to conserve Windows minutes. **On a tag, auto-create a GitHub
      Release and attach the installer** so the VPE can download it from the Releases page;
      manual runs upload the `.exe` as a workflow artifact only (no Release).
- [x] Pin any third-party action to a specific version (supply chain); grant the release job
      only the `contents: write` permission it needs.
- [x] **Do not** let CI touch or require real secrets — tests must pass with **no** cookies
      (they mock the network; the API/refresh routes already assert the missing-cookie path).
      No `BASECAMP_SESSIONID` / `TI_COOKIE` in any workflow.

**Validation:**
1. [x] `test -f .github/workflows/ci.yml` and `release.yml` — both exist and parse as valid
   YAML (js-yaml load: `ci.yml` job `test`, triggers push/pull_request; `release.yml` job
   `build-windows`, triggers push-tags/workflow_dispatch).
2. [x] `npm test` (303) and `npm run test:e2e` (6) pass locally — the workflow just wraps them.
3. [ ] **Pending first push:** the **test** workflow run goes green on GitHub Actions
   (`gh run list`). CI runs on GitHub, not locally.
4. [ ] **Pending next tag / manual dispatch:** the desktop build produces
   `Toastmasters Tools Setup <version>.exe` as a CI artifact and, on a tag, attaches it to the
   GitHub Release.
5. [x] README has the CI badge and no stale "planned"/`csv.ts` references
   (`grep -nE "planned|csv\.ts" README.md` — no hits).

> **Note:** Items 1, 2, 5 pass locally now; items 3–4 can only be confirmed after pushing —
> the workflows run on GitHub. `actionlint` was unavailable offline, so YAML was validated by
> js-yaml parse instead.

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
