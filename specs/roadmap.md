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

## Phase 13 — Done (Repo README refresh + GitHub Actions CI/CD)

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
3. [x] **Confirmed after push:** pushed `user/oong/v2` to origin (12 commits, incl. Part A/B) —
   the **test** workflow triggered automatically and went green on GitHub Actions
   (`gh run view 29458318895`: job `test` passed in 2m40s, covering `npm test` and
   `npm run test:e2e`). Run: https://github.com/oongjiexiang/toastmasters-tools/actions/runs/29458318895
4. [x] **Confirmed via manual dispatch, then two debug fixes:** the first two
   `workflow_dispatch` runs on `windows-latest` failed installing `better-sqlite3` — no
   prebuilt binary for Node 20.20.2/win32/x64, and the `node-gyp` source-build fallback
   couldn't parse the newer Visual Studio install `windows-latest` now ships
   (unrecognized version string). Pinning `runs-on: windows-2022` fixed VS detection but
   surfaced a second issue: `node-gyp`'s bundled `gyp` imports `distutils`, removed in
   Python 3.12 (the runner's default). Added `actions/setup-python@v5` pinned to `3.11`
   before `npm ci`. Verified via two temporary debug runs (pushed to a temp `push` trigger
   on this branch, reverted after): run `29459106670` confirmed the windows-2022 fix
   surfaced the Python issue, run `29459225166` went green in 4m40s and produced the
   `toastmasters-tools-installer` artifact. Trigger reverted back to tags +
   `workflow_dispatch` only (commit `1ce41ea`) — confirmed the next push did **not**
   re-trigger `release.yml`, only `ci.yml` as expected.
5. [x] README has the CI badge and no stale "planned"/`csv.ts` references
   (`grep -nE "planned|csv\.ts" README.md` — no hits).

> **Note:** All 5 validation items are confirmed. `release.yml` now targets `windows-2022`
> (not `windows-latest`) and pins Python 3.11 for the `better-sqlite3` native rebuild — both
> load-bearing fixes, not stylistic choices; do not revert either without re-verifying a
> `workflow_dispatch` run.

---

## Phase 14 — Done (Remove the Next.js web app, minor version → 1.1.0)

_The Electron desktop app (Phases 11–12) is the delivered product. The Next.js web app
(`apps/web`) is no longer used — nobody runs `npm run dev` to serve a dashboard on
`localhost:3000` anymore. This phase deletes it, collapsing the repo to a single app plus
shared packages. There is no user-facing change to the shipped `.exe`, so **tag the resulting
build with a minor bump — `1.1.0`.**_

> **Load-bearing constraint (must be solved first — mirrors the Phase 3/6 sequencing note):**
> the desktop renderer reuses the web app's React components **verbatim**. It imports
> `DashboardHeader`, `MemberTable`, `LevelAccordion`, `ProjectRow`, `DiffSection`, the shadcn
> `ui/` primitives, and `providers` through an `@` alias that resolves to `apps/web`
> (`apps/desktop/electron.vite.config.ts:37-38`, `WEB_DIR`), and its data layer mirrors
> `apps/web/lib/api.ts`. **Deleting `apps/web` outright breaks the desktop build.** So the
> shared UI + lib must be **extracted into a package first** (e.g. `packages/ui`,
> `@toastmasters/ui`), the desktop `@` alias repointed at that package, and only then is
> `apps/web` safe to remove. Do not delete before extracting.

- [x] **Extract shared UI into `packages/ui`** (`@toastmasters/ui`, private, no build step —
      consumed via `exports` subpaths, same pattern as `@toastmasters/core`). Move the reused
      components (`DashboardHeader`, `MemberTable`, `LevelAccordion`, `ProjectRow`,
      `DiffSection`, `ui/*`, `providers`) and any shared client types out of `apps/web`.
      Repoint the desktop renderer's `@`/`@/components` alias at the new package
      (`apps/desktop/electron.vite.config.ts`, `apps/desktop/tsconfig.json`). Keep the
      renderer's own `lib/api.ts` IPC layer.
- [x] **Delete `apps/web/`** entirely — Next.js app, `app/api/*` routes, `next.config.ts`,
      web-only unit tests (`apps/web/tests/api`), the Playwright E2E suite
      (`apps/web/tests/e2e`), and `playwright.config.ts`. The `workspaces` array stays
      `["apps/*", "packages/*"]` (desktop + packages remain).
- [x] **Prune root scripts:** remove `dev`, `build`, `start`, `test:e2e` (all web-only).
      Keep `fetch`, `membership`, `cli`, `test`, `desktop:dev`, `desktop:build`. `npm test`
      now covers core + desktop (`packages/ui` ships no tests of its own — it is pure
      component source, no build step, consumed and exercised through the desktop bundle).
- [x] **Update CI (`.github/workflows/ci.yml`):** drop the Playwright / `test:e2e` step
      (web-only) and any `apps/web` build step; keep the core + desktop test job. `release.yml`
      (desktop installer) is unaffected.
- [x] **Documentation sweep** — remove or mark historical every reference to the running web
      app: `README.md` (project-structure tree, Commands table, any "run the dashboard on
      localhost:3000" text), `specs/tech-stack.md` (Next.js/React-web layer),
      `specs/architecture-react.md`, `specs/feature-react-migration.md`,
      `specs/ui-design-react.md`. These ADRs/specs are historical records — prefer a
      "**Superseded — the web app was removed in Phase 14; components now live in
      `packages/ui`**" banner over silent deletion.
- [x] **Version bump:** set every workspace `package.json` `version` to `1.1.0` (root,
      `packages/core`, `packages/ui`, `apps/desktop`). After validation, tag the build
      `v1.1.0` (electron-builder's product version follows, so the installer becomes
      `Toastmasters Tools Setup 1.1.0.exe`).

**Validation:**
1. [x] `test ! -d apps/web` and `test ! -f playwright.config.ts` — web app fully removed.
   Confirmed: neither path exists in the repo.
2. [x] `test -d packages/ui` and `grep -q "@toastmasters/ui" apps/desktop/package.json` —
   shared UI extracted and consumed. Confirmed: `packages/ui` exists (`DashboardHeader.tsx`,
   `MemberTable.tsx`, `LevelAccordion.tsx`, `ProjectRow.tsx`, `DiffSection.tsx`,
   `providers.tsx`, `components/ui/*`, `lib/utils.ts`, `globals.css`); `apps/desktop/package.json`
   depends on `"@toastmasters/ui": "*"` and `apps/desktop/electron.vite.config.ts` aliases `@`
   to `packages/ui`.
3. [x] `grep -rE "apps/web|@toastmasters/web|next" apps/desktop package.json .github/workflows`
   — no live references. Confirmed: the only match is a coincidental substring hit inside a
   _committed build artifact_ (`apps/desktop/release/win-unpacked/...`, unrelated `sqlite3.c` /
   `better-sqlite3` "next" iterator code) — no source or config reference to the removed web
   app remains.
4. [x] `npm test` passes (core + desktop; no E2E). Confirmed: **288/288** — core
   `packages/core` 219 tests (6 files: `config-dynamic`, `db`, `paths`, `pathway`, `queries`,
   `workspace`) + desktop `apps/desktop` 69 tests (5 files: `preload`, `main-ipc`,
   `credentials`, `auth`, `main-bundle`). No Playwright/E2E step runs.
5. [x] `npm run desktop:build` produces `apps/desktop/release/Toastmasters Tools Setup
   1.1.0.exe`. Confirmed: the file (plus its `.blockmap`) is present in
   `apps/desktop/release/`.
6. [x] `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all
   read `1.1.0`. Confirmed: root, `packages/core`, `packages/ui`, and `apps/desktop` all report
   `"version": "1.1.0"`.

> **Note:** All 6 validation items are confirmed against the live repo (not just the diff) as
> part of the docs pass that closed this phase. `npm test` was re-run and produced the same
> 288/288 split (219 core + 69 desktop) cited above.

---

> **Reprioritisation (2026-07-16, VPE request):** Phases 15–16 below are **new** and take
> priority over the two previously-planned phases, which are pushed down and renumbered —
> old **Phase 15** (production-grade refactor) → now **Phase 18**; old **Phase 16**
> (parallelise progress fetching) → now **Phase 17**. Numeric order = priority order, so the
> pipeline/workflow work (15) and the desktop login-UX polish (16) ship before the perf (17)
> and cleanup (18) phases. Version targets were re-sequenced to stay monotonic — see each phase.

---

## Phase 15 — Done (Branch-per-feature workflow + auto-build/release pipeline)

_Every feature should land on its own branch and reach `main` only through a reviewed PR; a
downloadable Windows build should then be produced automatically on merge to `main` (or on
demand) and published as a GitHub Release so the VPE's users can download it without hunting
through CI artifacts. Phase 13 already cuts a versioned Release **on a tag**; this phase adds
the **branch → PR → main** discipline and the **auto-build-on-main** + rolling-download story
on top of it. Pipeline-only change — the shipped app is byte-identical — so a **patch bump →
`1.1.1`**, just to have a concrete Release that exercises the new flow._

- [x] **(item 1) Branch-per-feature policy, documented.** Add a short `CONTRIBUTING.md` (and a
      note in `README.md`): no direct commits to `main`; each feature/phase on its own branch;
      merge to `main` only via PR with `ci.yml` green. Phases 16 → 18 follow this from now on.
- [x] **(item 1) Enforce PR-only merges via branch protection on `main`.** Applied via
      `gh api -X PUT repos/oongjiexiang/toastmasters-tools/branches/main/protection` (recorded in
      `CONTRIBUTING.md`) with the user's explicit approval: `required_status_checks` = the `test`
      job (strict), `required_pull_request_reviews.required_approving_review_count = 1`,
      `enforce_admins = false`. `enforce_admins` was deliberately set `false`, not the originally
      drafted `true` — this repo has a single contributor, and GitHub does not allow an author to
      approve their own PR, so `enforce_admins: true` would have permanently blocked every future
      merge (including this phase's own PR) with no second account able to review. Confirmed live
      via `gh api repos/oongjiexiang/toastmasters-tools/branches/main/protection`.
- [x] **(item 1) Auto-build on merge to `main`.** Extend `release.yml`'s triggers from
      `tags + workflow_dispatch` (Phase 13) to **also** include `push: { branches: [main] }`, so
      every merge to `main` builds the `.exe` on `windows-2022` (keep the Phase 13 Python-3.11 /
      `better-sqlite3` native-rebuild fixes — do **not** revert them). `workflow_dispatch` stays
      for on-demand manual builds.
- [x] **(item 2) Publish builds as downloadable GitHub Releases.** On a **version tag**, keep
      Phase 13's behaviour — a stable, versioned Release with the installer attached. On a **`main`
      push**, publish/refresh a single **rolling pre-release** (e.g. tag `latest-main`, title
      "Latest build from `main`") whose `.exe` is replaced each build, so users always have one
      obvious download link for the newest build without a formal version tag. Keep `contents:
      write` as the only elevated permission; keep third-party actions pinned; **no
      secrets/cookies** in the workflow (Phase 13 constraint).
- [x] **Version bump:** patch-bump every workspace `package.json` `version` to `1.1.1`; after
      validation, tag `v1.1.1` (the first Release cut through the new pipeline — a dogfood of the
      flow).

**Bug found and fixed during cross-check (not caught by the developer/tester/linter stages):**
the "Publish rolling main pre-release" step was gated only on `if: github.ref ==
'refs/heads/main'`. GitHub Actions also sets `github.ref` to the dispatched branch for
`workflow_dispatch` runs (defaulting to the repo's default branch, `main`) — so a routine manual
test run launched from `main` would **also** have published/overwritten the public `latest-main`
pre-release, contradicting README.md's explicit claim that "a manual `workflow_dispatch` run just
uploads the installer as a workflow artifact, without publishing a Release." Fixed with an
`event_name` guard: `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`. This is
now covered structurally by `packages/core/tests/release-workflow.test.ts` (the `mainGatedStep`
assertion still matches on the `refs/heads/main` substring, so the fix required no test change);
re-ran the test file standalone (6/6 pass) and the full suite (294/294) after the fix.

**Validation:**
1. [x] `release.yml` triggers parse (js-yaml) to include **push → branches:[main]**, **push →
   tags**, and **workflow_dispatch**; the build job still targets `windows-2022` and sets up
   Python 3.11. Confirmed by manual read of `.github/workflows/release.yml` and by
   `packages/core/tests/release-workflow.test.ts` (6/6 passing, incl. 4 negative controls that
   fail on the pre-Phase-15 shape, a `windows-latest` drift, a missing publish step, and a
   wrong Python pin).
2. [ ] **Pending — requires an actual push/merge or `workflow_dispatch` run on GitHub, which
   this cross-check pass does not perform (no push/merge was made; the branch stays local per
   instructions):** a merge to `main` (or a `workflow_dispatch` run) completing green on Actions
   and producing a GitHub Release with the installer attached, confirmed via `gh release list` /
   `gh run view`. Structurally the workflow is correct (see item 1 and the bug-fix note above),
   but that has not yet been exercised against real GitHub Actions infrastructure.
3. [x] `main` is protected: `gh api repos/oongjiexiang/toastmasters-tools/branches/main/protection`
   shows `required_status_checks.contexts: ["test"]` (strict) and
   `required_pull_request_reviews.required_approving_review_count: 1`. Run with the user's
   explicit approval, with `enforce_admins: false` rather than the originally drafted `true` (see
   item 1's note above — `true` would have blocked every future merge on a single-contributor
   repo). Confirmed live via the same `gh api` GET call.
4. [x] `test -f CONTRIBUTING.md` — exists at the repo root. Confirmed it documents the
   branch → PR → merge → auto-build flow (workflow steps 1–3) and reproduces the exact
   `gh api -X PUT .../branches/main/protection` command with `required_status_checks.contexts:
   ["test"]` and `required_pull_request_reviews`, matching item 1's spec above.
5. [x] `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all four
   read `"version": "1.1.1"`. Confirmed.

> **Note:** Checklist items 1a (policy documented), 1b (branch protection), 1c (auto-build
> trigger), 2 (release publishing behaviour), and the version bump are all confirmed against the
> live repo — including re-running `npm test` (294/294: 225 core incl. the 6 new
> `release-workflow.test.ts` cases, 69 desktop) and a live `gh api` GET of the branch-protection
> settings. One item remains genuinely open, by design, not oversight: **Validation item 2**, an
> end-to-end green Actions run producing a real Release, requires an actual push/merge or dispatch
> to GitHub, which lands via this phase's own PR — the first real exercise of the new pipeline.
> Do not tag `v1.1.1` until that run is confirmed green.

---

## Phase 16 — Desktop login clarity & credential convenience (minor → 1.2.0)

_Four UX papercuts on the desktop login/auth surface (Phase 12). Together they make it obvious
whether you're signed in and remove the "I clicked Log in — now what?" confusion. User-facing
changes to the `.exe`, so **minor bump → `1.2.0`.**_

> **Finding (grounds item 3):** there is **no "What's New" button in the current desktop app.**
> A repo-wide search over `apps/desktop/src` and `packages/ui` finds no "What's New" / changelog /
> release-notes control — it lived in the Next.js web app that **Phase 14 deleted**. So item 3 is
> a **confirm-and-clean**, not the removal of a live control: verify nothing stale remains, then
> close it. Do **not** invent a button to delete.

- [ ] **(item 3) Confirm no dead "What's New" control remains.** Grep the desktop menu
      (`apps/desktop/src/main/index.ts`), the shared header
      (`packages/ui/components/DashboardHeader.tsx`), the renderer views, and any About dialog for
      `what.?s.?new` / `changelog` / `release.?notes`. Remove anything found; otherwise record
      "none present" and close the item.
- [ ] **(item 4) Show login state in the UI.** The backend already exists — `AUTH_STATUS` IPC +
      `currentAuthStatus()` (`apps/desktop/src/main/auth.ts:162`) report which of Basecamp / TI
      cookies are present. Surface it: the renderer calls `AUTH_STATUS` on mount (and after any
      login or refresh) and renders a status indicator in the `authControl` slot of
      `DashboardHeader` (`packages/ui/components/DashboardHeader.tsx:26`) — e.g. a green "Logged in"
      badge vs a muted "Not logged in", degrading to "Basecamp only" / "TI only" when just one
      cookie set is present. The **Log in** button stays in the same slot.
- [ ] **(item 6) Auto-close the login popup on success + notify.** Today `openLoginWindow`
      resolves only when the user manually closes the window (`win.once("closed")`,
      `apps/desktop/src/main/auth.ts:126`) — with no on-page instructions, the user doesn't know
      when they're done. Change the flow to detect a successful capture (watch the partition's
      `session.cookies` `"changed"` event, or `webContents` `did-navigate` to a post-login URL, then
      re-harvest) and, once the needed cookie(s) are captured, **programmatically `win.close()`**
      and notify the renderer (success toast: "Signed in to Toastmasters"). Preserve
      `runLoginFlow`'s SSO two-window sequence (TI → Basecamp only if `sessionid` still missing) and
      keep manual close as the fallback (closing still harvests). Keep the window's hardened
      settings (`sandbox: true`, no preload).
- [ ] **(item 5, "if feasible") Credential autofill / caching.** The login already uses a
      **persistent** session partition (`persist:toastmasters`, `apps/desktop/src/main/auth.ts:26`),
      so cookies survive restarts — the user usually won't re-enter anything until the session
      expires. Investigate enabling Chromium **form/password autofill** in that partition so the TI
      login page prefills the username (and, where the Electron build supports it, the password).
      **Feasibility caveat:** Electron ships without the full Chromium password-manager UI, so if
      native autofill isn't reliable, fall back to app-managed convenience — store the **last-used
      TI username** (never the password) in `config.env` and prefill it — or simply document that
      the persistent session already caches the login. **Never persist the password in plaintext.**
- [ ] **Version bump:** minor-bump every workspace `package.json` `version` to `1.2.0`; after
      validation, tag `v1.2.0`.

**Validation:**
1. **Login state visible:** `grep -r "AUTH_STATUS" apps/desktop/src/renderer` — the renderer
   consumes it and renders a status element; a component/unit test asserts the indicator text
   switches with the `{ basecamp, ti }` status.
2. **Auto-close works:**
   `grep -nE "cookies.*changed|did-navigate|\.close\(\)" apps/desktop/src/main/auth.ts` — a capture
   listener closes the window; a unit test with a mocked cookie source asserts a captured cookie
   triggers close and returns the applied status; the renderer receives a login-success
   notification.
3. **No stale What's-New control:**
   `grep -riE "what.?s.?new|changelog|release.?notes" apps/desktop/src packages/ui` — no hits
   (confirms item 3).
4. **Credential convenience present, password never stored:** either autofill in the persistent
   partition is demonstrated/documented, or the fallback (prefilled username / documented cookie
   caching) is in place; `grep -riE "password" apps/desktop/src` shows no plaintext password
   persisted to disk.
5. `npm test` green; `npm run desktop:build` produces `Toastmasters Tools Setup 1.2.0.exe`;
   `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read `1.2.0`.
6. **Manual (pending user, mirrors Phase 12 step 9):** click **Log in**, complete the real
   Toastmasters login once — the window closes by itself, a "Signed in" toast appears, and the
   header shows "Logged in".

---

## Phase 17 — Parallelise progress-page fetching (minor version → 1.3.0)

> _Was **Phase 16** before the 2026-07-16 reprioritisation; the `1.3.0` version target is
> unchanged (the two new phases land at `1.1.1` and `1.2.0`, so this stays monotonic)._

_Phase 7 already parallelised **Step 2** (per-member lesson detail). **Step 1** —
`fetchAllProgress` in `packages/core/helpers/api.ts` — is still strictly sequential: it fetches
`page=1`, reads `page.next`, fetches `page=2`, and so on, one page at a time, because each
page's `next` URL is only known after the previous page returns. Parallelising the page
fetches cuts Step 1 wall time from O(pages) to O(pages/concurrency). This is a performance
improvement with no API-shape change, so **bump the minor version → `1.3.0`** when taken up._

> **Clue from the website's response (the enabling fact):** the endpoint returns a standard
> Django-REST paginated payload — `{ count, next, previous, results }` (`packages/core/types.ts:23-28`).
> **`count` (total members) arrives on page 1**, and the page size equals `results.length` of
> page 1. So after the *first* request we can compute `totalPages = ceil(count / pageSize)`
> and issue pages `2..totalPages` **in parallel** by constructing their URLs directly
> (`?club=<CLUB_ID>&page=N`) instead of walking the `next` chain serially.

- [ ] Rework `fetchAllProgress`: fetch page 1 first (learn `count` + `pageSize`), then fetch
      pages `2..totalPages` with a **concurrency-limited** parallel runner — reuse the exact
      Phase 7 pattern (`Promise.allSettled` over chunks, a `PROGRESS_CONCURRENCY` constant at
      the top of the module, default 5). No new dependency.
- [ ] **Preserve member ordering:** assemble `allResults` by page index, not by completion
      order, so the output is identical to the sequential version.
- [ ] **Safe fallback:** if page 1 returns no `count`, an empty `results`, or a `next` URL that
      doesn't match the `page=N` scheme, fall back to the current sequential `next`-following
      loop. Never fabricate page URLs the server didn't imply.
- [ ] **Error handling per page:** a single failed page logs a warning and the run continues
      (matching the per-member tolerance in Step 2); the progress reporter still logs
      `Page N: X of <count> downloaded.`
- [ ] Concurrency cap is a tunable constant, mirroring `DETAIL_CONCURRENCY`
      (`packages/core/services/fetch.ts:7`).
- [ ] **Version bump:** minor bump to `1.3.0` across workspaces; tag `v1.3.0`.

**Validation:**
1. `grep "PROGRESS_CONCURRENCY" packages/core/helpers/api.ts` — constant defined and set to a number
2. `grep "Promise.allSettled" packages/core/helpers/api.ts` — parallel runner present in the progress path
3. `npm test` passes — including a test that mocks a multi-page `{count,next,results}` response and asserts (a) member order is preserved and (b) pages 2..N are requested concurrently, plus a single-page and a missing-`count` fallback case
4. `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read `1.3.0`

---

## Phase 18 — Production-grade refactor (minor version → 1.4.0)

> _Was **Phase 15** before the 2026-07-16 reprioritisation, and moved to **last** of the planned
> phases: it's a behaviour-preserving cleanup, so it yields to the pipeline (15), login-UX (16),
> and perf (17) work the VPE asked for first. Version target re-sequenced `1.2.0` → `1.4.0` to
> stay monotonic behind Phase 17's `1.3.0`._

_With the repo collapsed to a single app plus shared packages (Phase 14), do a repo-wide
cleanup pass to make it maintainable and production-grade: consistent structure, enforced
lint/format, strict typing, no dead code, uniform error handling and logging. This is a
behaviour-preserving refactor — no new user-facing feature and no user-facing change to the
shipped `.exe` — so **tag the resulting build with a minor bump — `1.4.0`.** Do this only
after Phases 15–17; refactoring code those phases are still actively changing is wasted work._

- [ ] **Tooling baseline:** a single shared ESLint (flat config) + Prettier setup at the repo
      root applied to every workspace; add `lint` / `format` scripts and wire `lint` into `npm test`
      and CI. Resolve every warning it surfaces (unused vars/imports, floating promises, etc.).
- [ ] **Strict TypeScript:** enable `strict` (+ `noUncheckedIndexedAccess`,
      `noImplicitOverride`) in a shared base `tsconfig` that each workspace extends; eliminate
      resulting errors and stray `any`s (replace with real types from `packages/core/types.ts`).
- [ ] **Module boundaries & dead code:** remove any code orphaned by Phases 6/10/14; ensure
      `@toastmasters/core` and `@toastmasters/ui` only expose intended `exports` subpaths;
      keep the "core imports nothing framework-specific" invariant
      (`packages/core/tests/workspace.test.ts`) and add the equivalent guard for `packages/ui`.
- [ ] **Error handling & logging:** replace scattered `console.log`/`console.error` with a
      small shared logger (levels + structured context), keeping the `ProgressReporter` callback
      seam (`packages/core/services/fetch.ts:15`) intact so the Electron live-log still works.
      Consistent error types for the auth/HTTP failure paths (`helpers/api.ts`).
- [ ] **Naming & consistency:** uniform file/naming conventions, import ordering, and
      barrel/`index.ts` conventions across `packages/*` and `apps/desktop`.
- [ ] **No behaviour change / no coverage loss:** the full test suite stays green and coverage
      does not drop; refactors that touch logic get a test asserting the preserved behaviour.
- [ ] **Version bump:** set every workspace `package.json` `version` to `1.4.0`; after
      validation, tag the build `v1.4.0`.

**Validation:**
1. `npm run lint` exits 0 with zero warnings; `npm run format -- --check` (or equivalent) is clean
2. `npm test` passes with coverage ≥ the Phase 14 baseline (no regression)
3. `npm run desktop:build` produces `Toastmasters Tools Setup 1.4.0.exe`
4. `grep -rc "any" packages/core/*.ts packages/core/helpers` shows no new bare `any`s vs. baseline; strict flags present in the shared tsconfig
5. `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read `1.4.0`

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
