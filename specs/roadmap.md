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
5. [x] **Manual (confirmed by user, 2026-07-16):** launched the installed `.exe`, pasted a live
       cookie, clicked "Refresh Progress", the member table repopulated.

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
9. [x] **Manual (confirmed by user, 2026-07-16):** launched the app, clicked **Log in**, completed
   the real Toastmasters login, then **Refresh Progress** and **Refresh Membership** both
   succeeded using the harvested cookies.

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

## Phase 16 — Done (Desktop login clarity & credential convenience, minor → 1.2.0)

_Four UX papercuts on the desktop login/auth surface (Phase 12). Together they make it obvious
whether you're signed in and remove the "I clicked Log in — now what?" confusion. User-facing
changes to the `.exe`, so **minor bump → `1.2.0`.**_

> **Finding (grounds item 3):** there is **no "What's New" button in the current desktop app.**
> A repo-wide search over `apps/desktop/src` and `packages/ui` finds no "What's New" / changelog /
> release-notes control — it lived in the Next.js web app that **Phase 14 deleted**. So item 3 is
> a **confirm-and-clean**, not the removal of a live control: verify nothing stale remains, then
> close it. Do **not** invent a button to delete.

- [x] **(item 3) Confirm no dead "What's New" control remains.** Grep the desktop menu
      (`apps/desktop/src/main/index.ts`), the shared header
      (`packages/ui/components/DashboardHeader.tsx`), the renderer views, and any About dialog for
      `what.?s.?new` / `changelog` / `release.?notes`. Remove anything found; otherwise record
      "none present" and close the item.
- [x] **(item 4) Show login state in the UI.** The backend already exists — `AUTH_STATUS` IPC +
      `currentAuthStatus()` (`apps/desktop/src/main/auth.ts:162`) report which of Basecamp / TI
      cookies are present. Surface it: the renderer calls `AUTH_STATUS` on mount (and after any
      login or refresh) and renders a status indicator in the `authControl` slot of
      `DashboardHeader` (`packages/ui/components/DashboardHeader.tsx:26`) — e.g. a green "Logged in"
      badge vs a muted "Not logged in", degrading to "Basecamp only" / "TI only" when just one
      cookie set is present. The **Log in** button stays in the same slot.
- [x] **(item 6) Auto-close the login popup on success + notify.** Today `openLoginWindow`
      resolves only when the user manually closes the window (`win.once("closed")`,
      `apps/desktop/src/main/auth.ts:126`) — with no on-page instructions, the user doesn't know
      when they're done. Change the flow to detect a successful capture (watch the partition's
      `session.cookies` `"changed"` event, or `webContents` `did-navigate` to a post-login URL, then
      re-harvest) and, once the needed cookie(s) are captured, **programmatically `win.close()`**
      and notify the renderer (success toast: "Signed in to Toastmasters"). Preserve
      `runLoginFlow`'s SSO two-window sequence (TI → Basecamp only if `sessionid` still missing) and
      keep manual close as the fallback (closing still harvests). Keep the window's hardened
      settings (`sandbox: true`, no preload).
- [x] **(item 5, "if feasible") Credential autofill / caching.** The login already uses a
      **persistent** session partition (`persist:toastmasters`, `apps/desktop/src/main/auth.ts:26`),
      so cookies survive restarts — the user usually won't re-enter anything until the session
      expires. Investigate enabling Chromium **form/password autofill** in that partition so the TI
      login page prefills the username (and, where the Electron build supports it, the password).
      **Feasibility caveat:** Electron ships without the full Chromium password-manager UI, so if
      native autofill isn't reliable, fall back to app-managed convenience — store the **last-used
      TI username** (never the password) in `config.env` and prefill it — or simply document that
      the persistent session already caches the login. **Never persist the password in plaintext.**
- [x] **Version bump:** minor-bump every workspace `package.json` `version` to `1.2.0`; after
      validation, tag `v1.2.0`.

**Validation:**
1. [x] **Login state visible:** `grep -r "AUTH_STATUS" apps/desktop/src/renderer` — the renderer
   consumes it and renders a status element; a component/unit test asserts the indicator text
   switches with the `{ basecamp, ti }` status.
2. [x] **Auto-close works:**
   `grep -nE "cookies.*changed|did-navigate|\.close\(\)" apps/desktop/src/main/auth.ts` — a capture
   listener closes the window; a unit test with a mocked cookie source asserts a captured cookie
   triggers close and returns the applied status; the renderer receives a login-success
   notification.
3. [x] **No stale What's-New control:**
   `grep -riE "what.?s.?new|changelog|release.?notes" apps/desktop/src packages/ui` — no hits
   (confirms item 3).
4. [x] **Credential convenience present, password never stored:** either autofill in the persistent
   partition is demonstrated/documented, or the fallback (prefilled username / documented cookie
   caching) is in place; `grep -riE "password" apps/desktop/src` shows no plaintext password
   persisted to disk.
5. [x] `npm test` green; `npm run desktop:build` produces `Toastmasters Tools Setup 1.2.0.exe`;
   `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read `1.2.0`.
6. [x] **Manual (confirmed by user, 2026-07-16):** clicked **Log in**, completed the real
   Toastmasters login — the window closed by itself, a "Signed in" toast appeared, and the
   header showed "Logged in".

> **Note:** Validation items 1–5 are confirmed against the live repo: `npm test` passed
> 307/307 (225 core + 82 desktop, including new unit tests for `watchForCapture`'s auto-close
> behavior and `describeAuthStatus`'s label mapping), `npm run desktop:build` produced
> `apps/desktop/release/Toastmasters Tools Setup 1.2.0.exe` (91.6 MB), and every workspace
> `package.json` reads `1.2.0`. **Item 5 (credential convenience) was closed via the documented
> fallback, not a coded feature:** no autofill or username-prefill was implemented. Electron does
> not bundle Chromium's password-manager/autofill service, and prefilling by scraping the real TI
> login form's field selectors was ruled out as too fragile to maintain (an unversioned,
> third-party page whose markup can change without notice). The existing persistent session
> partition (`persist:toastmasters`, shipped in Phase 12) already covers the actual pain point —
> cookies survive app restarts, so the user only has to sign in again when the session genuinely
> expires — and that behaviour is now called out explicitly in `apps/desktop/USER_GUIDE.md` rather
> than left as an implicit side effect. **Item 6, the manual end-to-end click-through, is now
> confirmed** (2026-07-16): the user logged in against the real installed `.exe`, the popup closed
> itself, a "Signed in" toast appeared, and the header showed "Logged in".

---

> **Reprioritisation (2026-07-16, VPE request):** the desktop logout flow below is inserted as
> the new **Phase 17** — the next highest-priority work, requested directly by the VPE — pushing
> the previously-planned Phase 17 (parallelise progress fetching) down to **Phase 18** and Phase 18
> (production-grade refactor) down to **Phase 19**. Version targets re-sequenced to stay
> monotonic: `1.3.0` (logout) → `1.4.0` (parallelise) → `1.5.0` (refactor).

---

## Phase 17 — Done (Desktop logout (clear session cookies), minor → 1.3.0)

_The VPE discovered that deleting the cookie values from `config.env` by hand does **not**
actually log the app out: on the next launch the values reappear. Investigation traced this to
the persistent Electron session partition (`persist:toastmasters`,
`apps/desktop/src/main/auth.ts:29`) introduced in Phase 12 — it still holds the live Basecamp/TI
cookies on disk, and the **startup self-heal** (`apps/desktop/src/main/index.ts`, inside
`app.whenReady()`) re-harvests them into `config.env` on every launch, silently undoing the manual
edit. This phase adds a real **Log out** action that clears the partition itself, not just its
mirror in `config.env`. User-facing change to the `.exe`, so **minor bump → `1.3.0`.**_

> **Finding (grounds this phase):** `config.env` is only ever a durable *copy* of whatever cookies
> the persistent partition holds (`applyCookies`, `apps/desktop/src/main/auth.ts`) — it is never
> the source of truth. Any logout must clear the partition's cookie jar; clearing `config.env`
> alone is cosmetic and gets overwritten by the very next self-heal.

- [x] **`auth.ts`: `logOut(credsFile, session)`.** Clears cookies scoped to the Basecamp
      (`https://basecamp.toastmasters.org/`) and TI (`https://www.toastmasters.org/`) origins only
      — not the whole partition, so nothing else stored there is disturbed — via `sess.cookies.get`
      to enumerate each origin's cookies and `sess.cookies.remove(url, name)` to delete them one at a
      time, mirroring exactly how `harvestCookies` already reads them — then deletes
      `BASECAMP_SESSIONID` / `TI_COOKIE` from `process.env` (so a live scraper call sees them as
      unset immediately, matching the Phase 12 "dynamic cookie reads" behaviour) and blanks both
      lines in `config.env` by reusing the `credentials.ts` `upsertCredential` writer (write `""`,
      same as the template's empty placeholder). Returns the resulting `AuthStatus` so the caller
      can confirm the session is genuinely cleared, not just assume it.
- [x] **IPC: `AUTH_LOGOUT` channel.** New channel alongside `AUTH_LOGIN` / `AUTH_STATUS` in
      `apps/desktop/src/shared/ipc.ts`, wired through the preload `contextBridge` and the renderer's
      `lib/api.ts`, following the exact pattern the other two auth channels already use
      (`handleAuth`, no `loadCore()`).
- [x] **Menu: File → Log out.** Mirrors the existing **Log in to Toastmasters…** item
      (`apps/desktop/src/main/index.ts`) — runs the logout, then reloads the focused window so the
      header badge immediately reflects the cleared state.
- [x] **Renderer UX.** A **Log out** control in the same `authControl` slot as **Log in**
      (`DashboardHeader`, `packages/ui/components/DashboardHeader.tsx`), shown only while a session
      is actually held (`authStatus.basecamp || authStatus.ti`) so it isn't a dead button on first
      launch. **Log in** and **Log out** are mutually exclusive — the slot renders exactly one of
      them at a time, never both — per user UX feedback during manual testing. Loading →
      success/error toast, matching the existing **Log in** control's pattern.
- [x] **Update `apps/desktop/USER_GUIDE.md`** with a short "Log out" step, and correct the
      Troubleshooting section if it currently implies editing `config.env` is sufficient to sign
      out.
- [x] **Version bump:** minor-bump every workspace `package.json` `version` to `1.3.0`; after
      validation, tag `v1.3.0`.

**Validation:**
1. [x] `grep -n "AUTH_LOGOUT" apps/desktop/src/shared/ipc.ts` — channel declared
2. [x] `grep -n "logOut" apps/desktop/src/main/auth.ts` — logout helper present, and it clears cookies
   scoped to the Basecamp/TI origins individually via `sess.cookies.get`/`sess.cookies.remove` (not
   e.g. a bare `session.clearStorageData()` with no `origin`, which would over-clear the partition
   — and which was found in manual testing to silently fail to remove cookies at all)
3. [x] `grep -i "Log out" apps/desktop/src/main/index.ts` — menu item present
4. [x] `grep -r "AUTH_LOGOUT\|logOut" apps/desktop/src/renderer` — renderer wires the control
5. [x] `npm test` green, including a unit test with a mocked session proving: (a) a logout clears the
   mocked partition's cookies, `process.env`, and `config.env`, and (b) a subsequent
   `currentAuthStatus`/self-heal-style re-harvest on that same mocked session reports both cookies
   absent (the regression this phase exists to fix)
6. [x] `npm run desktop:build` produces `Toastmasters Tools Setup 1.3.0.exe`;
   `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read
   `1.3.0`
7. [x] **Manual (confirmed by user, 2026-07-16):** logged in, clicked **Log out**, restarted the
   app — the header showed "Not logged in" and **Log in** was required again.

> **Note:** Validation items 1–6 are confirmed against the live repo: `logOut` (`apps/desktop/src/main/auth.ts`)
> clears cookies scoped to the Basecamp and TI origins individually via `sess.cookies.get({ url })` to
> enumerate each origin's cookies and `sess.cookies.remove(url, name)` to delete them one at a time —
> the same per-origin scoping `harvestCookies` already reads with, never a bare unscoped call — then
> clears `process.env.BASECAMP_SESSIONID` / `TI_COOKIE` and blanks both lines in `config.env`,
> returning a live-re-derived `AuthStatus`. The
> `AUTH_LOGOUT` channel is wired end-to-end (`shared/ipc.ts` → `preload/index.ts` → `main/index.ts`'s
> `handleAuth` handler and its own **File → Log out** menu item, calling `logOut` directly, not a
> copy of the login handler → `renderer/lib/api.ts`'s `logOut()` wrapper → the **Log out** button in
> `DashboardView.tsx`). The renderer button renders only when `authStatus?.basecamp || authStatus?.ti`
> is truthy, so it is never a dead control before first login — and it is mutually exclusive with
> **Log in** (the `authControl` slot renders one or the other, never both), a fix made in response to
> user UX feedback during manual testing. `npm test` passed 316/316 (225 core +
> 91 desktop, including the `logOut` unit tests — origin-scoped clear, `process.env` clear,
> `config.env` blanking, a live re-derived-status check, a multi-cookie-jar case, and a negative
> control proving the return value isn't hardcoded), `npm run typecheck` is clean, and every workspace `package.json` reads
> `1.3.0`. `apps/desktop/USER_GUIDE.md` gained a "Log out" section that also corrects the
> misconception that started this phase — hand-editing `config.env` does not sign you out. **Item 7,
> the manual end-to-end click-through, is now confirmed** (2026-07-16): the user logged in, clicked
> **Log out**, restarted the app, and the header showed "Not logged in" with **Log in** required
> again — proving a `config.env` edit alone is no longer the only thing standing between "looks
> logged out" and "is logged out." (This item's first real attempt is what surfaced Finding #2
> below — the false-positive login-capture bug — which was fixed and re-confirmed separately.)

> **Finding #2 (discovered during the user's manual validation of item 7 — a second, pre-existing bug
> logout exposed):** with logout now genuinely clearing the session partition, the user hit item 7 for
> real for the first time — and found that clicking **Log in** against a truly empty partition closes
> the popup **instantly, before any credentials are typed**, then reports "Signed in," then Refresh
> fails with **403** on both Basecamp and TI. Root cause, confirmed by reading `harvestCookies`
> (`apps/desktop/src/main/auth.ts`): the "login captured" check treats **any cookie at all** as proof
> of authentication — TI's branch joins whatever cookies exist for `www.toastmasters.org` with no
> filter, and Basecamp's branch keys off a cookie literally named `sessionid`, which (like TI's) is
> commonly set for an **anonymous** visitor too, not only after real authentication. Merely loading the
> login page sets such a cookie within about a second, which the auto-close logic (Phase 16 item 6)
> then misreads as a completed login and writes into `config.env` as if it were real. This bug has
> existed since Phase 12/16 but was invisible until now: Phase 17's logout was previously a no-op
> (see Finding #1 above), so the partition always still held a genuinely-authenticated cookie from the
> last real login, and reopening **Log in** would correctly (if coincidentally) detect that real
> session instantly. **User-confirmed: both Refresh Progress (Basecamp) and Refresh Membership (TI)
> 403 as a result — both checks are affected, not just one.**
>
> **Fix (user-selected, of two options offered):** stop keying "login captured" off cookie presence at
> all. Instead, watch the login window's `webContents` navigation — `did-navigate` /
> `did-navigate-in-page` — and treat the login as captured only once the page has navigated **away**
> from a login-shaped URL (path containing `login`/`signin`/`sso`/`auth`, case-insensitive) to one that
> isn't, which can only happen after the server actually accepts the credentials (or grants access via
> an already-valid session — the legitimate "already logged in" fast path). Still harvest cookies at
> that point as the actual payload to apply — the navigation event is the *gate*, not a replacement for
> cookie harvesting. This is more robust than matching a specific cookie name (doesn't depend on
> guessing TI/Basecamp's cookie scheme, won't break if they rename cookies) but carries a known,
> flagged risk: a multi-step login (e.g. an MFA page hosted at a URL that doesn't match the
> login/signin/sso/auth pattern) could still cause a premature capture, and Basecamp's redirect chain
> (`BASECAMP_LOGIN_URL` is the destination `/dashboard` page itself, not a `/login` path — the login
> detection there depends on Basecamp actually redirecting through a login-shaped URL first) is
> unverified against the real site. Both risks require the user's real-world testing to confirm or
> refute; this is not headlessly verifiable, same as item 7.

- [x] **`auth.ts`: replace cookie-presence capture with navigation-gated capture.** Add a
      navigation-aware watcher (parallel to the existing `watchForCapture`, which stays for its
      current cookie-reading role) that resolves only once the login window's `webContents` has
      navigated to a non-login-shaped URL, then harvests cookies as before. Wire it into
      `openLoginWindow`/`runLoginFlow` in place of the pure-cookie `watchForCapture` predicate
      currently used for the "captured" signal (the periodic cookie read inside stays useful as the
      actual harvest, just not as the sole gate for closing the window).
- [x] **Unit tests** with a fake `webContents`-like `EventEmitter` (mirroring the existing
      `CookieWatcher` fake pattern in `apps/desktop/tests/auth.test.ts`), proving: (a) a plain page
      load of the login URL alone does **not** trigger capture even once a cookie appears; (b) capture
      fires once navigation lands on a non-login-shaped URL; (c) an "already logged in" instant
      redirect away from the login URL still captures immediately (preserves the fast path); (d) a
      failed-login redisplay of the same login-shaped URL (e.g. with an error query string) does not
      falsely capture.
- [x] **Clear the bogus cookies already written from the false-positive bug** — not a code fix, but
      call out in the PR/manual-test notes that a user who already hit this bug should click **Log
      out** (now genuinely working per Finding #1) before retesting **Log in**, so stale garbage
      cookies from an anonymous page visit aren't sitting in `config.env`.

**Validation (Finding #2):**
1. [x] `grep -nE "did-navigate" apps/desktop/src/main/auth.ts` — navigation-gated capture present
2. [x] `npm test` green, including the four navigation-capture cases listed above (with at least one
   proven as a negative control — a plain page load with a cookie present must NOT satisfy the new
   capture condition, unlike the old one)
3. [x] `npm run desktop:build` produces the (still `1.3.0`, no new version bump — this is a bug fix
   within the still-unreleased phase) installer
4. [x] **Manual (confirmed by user, 2026-07-16):** clicked **Log out** to clear the stale cookies,
   then **Log in**, typed Toastmasters credentials — the popup did not close prematurely, and
   **Refresh Progress** / **Refresh Membership** both succeeded afterward (no 403).

> **Note:** Items 1–3 above and the code/test items are confirmed against the live repo. `auth.ts`
> now gates login capture on navigation, not cookie presence: `looksLikeLoginPage` classifies a URL as
> login-shaped by a loose, case-insensitive `login`/`signin`/`sso`/`auth` pathname substring match, and
> the new `watchForNavigationCapture` (built on a `NavigationSource` listening to `did-navigate` and
> `did-navigate-in-page`) resolves only once the window's `webContents` has navigated **away** from a
> login-shaped URL AND the target cookie has landed — cookies remain the payload `applyCookies` needs,
> but navigation is now the gate, never cookie presence alone. `openLoginWindow`/`runLoginFlow` are
> rewired to build this watcher (via a `buildCaptureSignal` factory bound to the real window's
> `webContents`) instead of the old cookie-only `watchForCapture`, which stays in the module only as an
> independently-tested, no-longer-load-bearing primitive. `apps/desktop/tests/auth.test.ts` covers all
> four roadmap-required cases (a)–(d) — including the exact false-positive regression scenario from
> Finding #2 — plus adversarial coverage: two navigation events racing before either's cookie harvest
> settles still resolves and unsubscribes exactly once; `cancel()` invoked from both the capture-resolved
> path and the window's `"closed"` handler is idempotent; and the TI and Basecamp windows' watchers are
> proven isolated from each other, so a stray navigation on an already-closed window cannot affect the
> other window's capture. `npm test` passed 333/333 (225 core + 108 desktop) and `npm run typecheck`
> (desktop) is clean. `apps/desktop/release/Toastmasters Tools Setup 1.3.0.exe` was rebuilt with a fresh
> timestamp, still `1.3.0` (no version bump — this fix lands within the still-unreleased phase).
> **Item 4 is now confirmed** (2026-07-16): the user clicked **Log out**, then **Log in**, typed
> real Toastmasters credentials, the popup did not close prematurely, and **Refresh Progress** /
> **Refresh Membership** both succeeded afterward with no 403 — the navigation-gated capture fix
> holds up against the real site.

---

## Phase 18 — Done (Parallelise progress-page fetching, minor version → 1.4.0)

> _Was **Phase 16** before the 2026-07-16 reprioritisation, then **Phase 17** before the
> 2026-07-16 logout insertion (see above). Version target moved `1.3.0` → `1.4.0` to stay
> monotonic behind the new logout phase._

_Phase 7 already parallelised **Step 2** (per-member lesson detail). **Step 1** —
`fetchAllProgress` in `packages/core/helpers/api.ts` — is still strictly sequential: it fetches
`page=1`, reads `page.next`, fetches `page=2`, and so on, one page at a time, because each
page's `next` URL is only known after the previous page returns. Parallelising the page
fetches cuts Step 1 wall time from O(pages) to O(pages/concurrency). This is a performance
improvement with no API-shape change, so **bump the minor version → `1.4.0`** when taken up._

> **Clue from the website's response (the enabling fact):** the endpoint returns a standard
> Django-REST paginated payload — `{ count, next, previous, results }` (`packages/core/types.ts:23-28`).
> **`count` (total members) arrives on page 1**, and the page size equals `results.length` of
> page 1. So after the *first* request we can compute `totalPages = ceil(count / pageSize)`
> and issue pages `2..totalPages` **in parallel** by constructing their URLs directly
> (`?club=<CLUB_ID>&page=N`) instead of walking the `next` chain serially.

- [x] Rework `fetchAllProgress`: fetch page 1 first (learn `count` + `pageSize`), then fetch
      pages `2..totalPages` with a **concurrency-limited** parallel runner — reuse the exact
      Phase 7 pattern (`Promise.allSettled` over chunks, a `PROGRESS_CONCURRENCY` constant at
      the top of the module, default 5). No new dependency.
- [x] **Preserve member ordering:** assemble `allResults` by page index, not by completion
      order, so the output is identical to the sequential version.
- [x] **Safe fallback:** if page 1 returns no `count`, an empty `results`, or a `next` URL that
      doesn't match the `page=N` scheme, fall back to the current sequential `next`-following
      loop. Never fabricate page URLs the server didn't imply.
- [x] **Error handling per page:** a single failed page logs a warning and the run continues
      (matching the per-member tolerance in Step 2); the progress reporter still logs
      `Page N: X of <count> downloaded.`
- [x] Concurrency cap is a tunable constant, mirroring `DETAIL_CONCURRENCY`
      (`packages/core/services/fetch.ts:7`).
- [x] **Version bump:** minor bump to `1.4.0` across workspaces; tag `v1.4.0`.

**Validation:**
1. [x] `grep "PROGRESS_CONCURRENCY" packages/core/helpers/api.ts` — constant defined and set to a number
2. [x] `grep "Promise.allSettled" packages/core/helpers/api.ts` — parallel runner present in the progress path
3. [x] `npm test` passes — including a test that mocks a multi-page `{count,next,results}` response and asserts (a) member order is preserved and (b) pages 2..N are requested concurrently, plus a single-page and a missing-`count` fallback case
4. [x] `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read `1.4.0`

> **Note:** All 4 validation items are confirmed against the live repo. `fetchAllProgress`
> (`packages/core/helpers/api.ts`) still fetches page 1 first via the existing `fetchPage`
> helper, then — only when page 1's `next` parses as a `page=2` URL and both `pageSize` and
> `count` are sane — computes `totalPages` and fetches pages `2..totalPages` in
> `PROGRESS_CONCURRENCY = 5`-wide chunks via `Promise.allSettled`, assembling results **by page
> index** (not completion order) so member ordering is byte-identical to the old sequential
> output. **Safety is the noteworthy part:** if `count`/`pageSize` are missing or invalid, or
> `next` doesn't follow the `page=N` scheme (e.g. a cursor-based pagination scheme), it falls
> back to the original sequential `next`-walk unchanged rather than fabricating a page URL the
> server never implied — and a single failed page during the parallel path logs a warning and is
> omitted, it does not abort the run. New test file
> `packages/core/tests/api-progress-parallel.test.ts` (10 tests) covers this end to end,
> including a genuine **concurrency negative control** — it tracks how many page requests are
> simultaneously in flight and asserts `maxConcurrent > 1`, a check that fails outright against a
> reverted sequential implementation rather than merely asserting call counts. `npm test` passed
> 235 core tests + 108 desktop tests, all green, and every workspace `package.json`
> (root, `packages/core`, `packages/ui`, `apps/desktop`) reads `1.4.0`. **No `v1.4.0` tag has
> been created yet** — that remains a separate step after this docs pass.

---

> **Reprioritisation (2026-07-16, VPE request):** the desktop UI-polish phase below is inserted
> as the new **Phase 19** — the next highest-priority work, requested directly by the VPE —
> pushing the production-grade refactor down to **Phase 20**. Version targets re-sequenced to stay
> monotonic: `1.5.0` (UI polish) → `1.6.0` (refactor). The refactor keeps yielding to
> user-facing work, and there is a second reason to order it this way: this phase touches
> `packages/ui` heavily, and Phase 20's own rule is not to refactor code an earlier phase is
> still actively changing.

---

## Phase 19 — Done (Desktop UI polish (affordances, expand/collapse, theming, layout), minor → 1.5.0)

_The desktop app works, but it doesn't feel like a finished product. Nothing signals what is
clickable, the two screens disagree about how expand/collapse works, there is no dark mode, and
the header controls pile up in a ragged row. This phase is a UI-quality pass over the shipped
`.exe` — no new data, no scraper or IPC change. User-facing, so **minor bump → `1.5.0`.**_

> **Finding A (grounds the cursor items — it is one root cause, not N papercuts):** the app has
> exactly **two** `cursor-pointer` classes in the entire renderer + `packages/ui`
> (`MemberTable.tsx:97` and `:170`). Everything else — every `Button`, every `AccordionTrigger`,
> the expand chevron in `MemberTable.tsx:126` — shows the default arrow cursor, because Tailwind
> v4's preflight sets `button { cursor: default }` (a deliberate v4 change from v3) and neither
> `buttonVariants` (`packages/ui/components/ui/button.tsx:7`) nor the `AccordionTrigger` base
> class (`packages/ui/components/ui/accordion.tsx:35`) adds it back. So fix this **centrally in
> the two primitives**, not by sprinkling `cursor-pointer` on call sites; the sprinkle would
> re-rot the moment a new button is added.

> **Finding B (load-bearing — dark mode is *disabled*, not missing; do this in order):**
> `packages/ui/components/providers.tsx:7` renders
> `<ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light">`. `forcedTheme`
> pins the app to light and makes the provider ignore any theme you set. `packages/ui/globals.css`
> **already ships a complete `.dark` token block** (lines 85–117) and `ui/sonner.tsx:3` already
> reads `useTheme()`, so the plumbing exists. **But** ~20 hardcoded palette classes with **no
> `dark:` variant** sit across `MemberTable.tsx` (blue/amber/green badges, the `text-blue-600`
> details link), `LevelAccordion.tsx` (`StatusBadge`), `ProjectRow.tsx` (`text-green-600/700`),
> `MemberDetailView.tsx:75`, and `DashboardView.tsx:325`. `bg-blue-100 text-blue-800` on a dark
> card is unreadable. **So: tokenise the status colours first, then remove `forcedTheme`.**
> Dropping `forcedTheme` before the tokenisation ships a visibly broken dark mode.

- [x] **(item 1) Pointer cursor on everything clickable — fixed at the primitive.** Add
      `cursor-pointer` to the `buttonVariants` base string (`packages/ui/components/ui/button.tsx`)
      and to the `AccordionTrigger` base class (`packages/ui/components/ui/accordion.tsx`), so
      every existing and future button/trigger inherits it. `disabled:pointer-events-none` is
      already in `buttonVariants` and keeps disabled buttons from showing it — verify that holds.
      Then remove the now-redundant per-call-site `cursor-pointer` in `MemberTable.tsx:170`. Any
      element that is clickable but is **not** a `Button` (the `<TableRow>`s, the raw `<button>`
      chevron at `MemberTable.tsx:126`) still needs it explicitly — cover those under item 2.
- [x] **(item 2) Whole-row click targets in `MemberTable`.** Today the behaviour is inconsistent:
      a **single-pathway** row is already fully clickable with a pointer and `hover:bg-muted/50`
      (`MemberTable.tsx:95-99`), but a **multi-pathway** member's parent row is inert — no cursor,
      no hover, and clicking it does nothing; only the ~16px chevron responds. Its expanded child
      rows are worse: they navigate only via a small `details →` text button
      (`MemberTable.tsx:168-173`). Make it uniform:
  - Parent (multi-pathway) row: clicking anywhere on it **toggles expand**, with `cursor-pointer`
    + the same `hover:bg-muted/50`. Keep the chevron as the visual affordance; it must not
    double-fire (the existing `e.stopPropagation()` at `MemberTable.tsx:64` is what prevents that
    — keep it).
  - Child (per-pathway) row: clicking anywhere navigates to that pathway's detail, same cursor +
    hover treatment as a single-pathway row. Drop the `details →` button once the row itself
    navigates, or keep it only if it still earns its place as a visual affordance.
  - Keep the rows keyboard-reachable and screen-reader-sane: a clickable `<TableRow>` needs
    `role="button"`-equivalent semantics (`tabIndex={0}` + Enter/Space handling) or an inner
    focusable control. A row that only responds to a mouse is a regression, not polish.
- [x] **(item 3) One expand/collapse-all toggle, not two buttons.** `LevelAccordion.tsx:68-83`
      renders **separate** "Expand all" and "Collapse all" buttons (shipped in Phase 3). Replace
      them with a **single** button that reflects and flips the current state — "Collapse all"
      when any level is open, "Expand all" when none are — matching the VPE's request for "just a
      button". Default stays **all expanded** (Phase 3's documented behaviour; do not change it).
      Decide the label from `openItems.length > 0`, so the button stays truthful when the user
      opens/closes levels individually.
- [x] **(item 4) Expand/collapse in the overview page.** The dashboard's `MemberTable` has
      per-member expansion for multi-pathway members (`expandedRows`, `MemberTable.tsx:61`) but
      **no** expand-all/collapse-all control — that only exists on the detail page. Add the same
      single toggle from item 3 above the table, driving the `expandedRows` set. It must
      **only render when at least one member actually has multiple pathways**
      (`members.some(m => m.pathways.length > 1)`) — in a club where nobody is on two paths it
      would be a dead control, exactly the "never a dead button" rule Phase 17 applied to **Log
      out**. Consider extracting the toggle as a shared component in `packages/ui` rather than
      writing it twice.
- [x] **(item 5) Tokenise the hardcoded status colours (prerequisite for item 6).** Replace the
      raw palette classes listed in Finding B with theme-aware ones. Prefer semantic tokens that
      already flip with `.dark` (`muted`, `accent`, `destructive`, `foreground`) where they fit;
      where a genuine status hue is needed (green = done/approved, amber = ready/close, blue =
      title), either add `dark:` variants (`bg-blue-100 text-blue-800 dark:bg-blue-950
      dark:text-blue-200`) or — better — add status tokens to the `:root` / `.dark` blocks in
      `packages/ui/globals.css` and use those, so the mapping lives in one place. The status
      semantics must not change: approved still reads green, ready still reads amber.
- [x] **(item 6) Light/dark mode with a real toggle.** Remove `forcedTheme="light"` from
      `packages/ui/components/providers.tsx` and set `defaultTheme="system"` with
      `enableSystem` so the app follows the OS by default (Windows 11 has a system-wide dark
      setting; matching it is the least surprising default). Add a header toggle
      (sun/moon icon `Button`, `lucide-react` already provides `Sun`/`Moon`) cycling
      light → dark → system, in a new **optional** `themeControl` slot on `DashboardHeader` —
      mirroring exactly how the `authControl` slot was added in Phase 12
      (`packages/ui/components/DashboardHeader.tsx:26`). `next-themes` persists the choice to
      `localStorage`, which in Electron lives under the app's `userData` partition, so the
      setting survives restarts with no new persistence code — **verify this rather than
      assume it**; if it does not persist, fall back to storing the preference in `config.env`
      via the existing `credentials.ts` `upsertCredential` writer. Guard against the
      first-paint flash of the wrong theme in the renderer's HTML shell. Sonner already reads
      `useTheme()`, so toasts should follow for free — confirm they do.
- [x] **(item 7) Header + layout tidy.** `DashboardHeader` (`flex items-start justify-between`)
      now carries six controls — auth badge, Log in/out, Refresh Progress, Refresh Membership,
      Membership CSV, and the new theme toggle — in one `flex-wrap` row that ragged-wraps at
      narrow widths. Group them so the header reads as deliberate: the auth badge and its
      button together, the two Refresh buttons as one visual unit (they are the primary action
      pair), and the utility controls (CSV, theme) separated — a button group, a separator, or
      an icon-only button for the low-frequency ones. Keep every existing control reachable and
      keep its accessible name (the tests and the user guide reference these labels); this is a
      **visual regrouping, not a removal**. Confirm the layout holds at the app's minimum window
      width.
- [x] **(item 8) No behaviour change beyond the UI.** No IPC channel, query, scraper, or
      `packages/core` change belongs in this phase. If something here appears to need a core
      change, stop and flag it — that is a sign the item is mis-scoped.
- [x] **Version bump:** minor-bump every workspace `package.json` `version` to `1.5.0`; after
      validation, tag `v1.5.0`.

**Validation:**
1. [x] `grep -n "cursor-pointer" packages/ui/components/ui/button.tsx packages/ui/components/ui/accordion.tsx`
   — present in **both** primitives' base classes (item 1), so the fix is central rather than
   per-call-site.
2. [x] `grep -nE "cursor-pointer|hover:bg-muted" packages/ui/components/MemberTable.tsx` — the
   multi-pathway parent row and the expanded child rows both carry the affordance, not just the
   single-pathway row (item 2). A unit test asserts: clicking a parent row toggles expansion
   (and does **not** navigate), clicking a child row calls `onSelectMember` with that child's
   pathway, and clicking the chevron toggles **once**, not twice (the `stopPropagation` guard —
   include this as a negative control, since it is the exact bug item 2 can introduce).
3. [x] `grep -c "Expand all" packages/ui/components/LevelAccordion.tsx` — the two-button pair is
   gone (item 3); a test asserts one button whose label flips between "Expand all" and
   "Collapse all" with the open state, and that the default render is all-expanded (guards
   Phase 3's behaviour).
4. [x] A test asserts the overview toggle **renders** when a member has >1 pathway and does
   **not** render when every member has exactly one (item 4) — the dead-control guard, and the
   half that is easy to forget.
5. [x] `grep -rnE "(bg|text)-(blue|green|amber)-[0-9]{2,3}" packages/ui/components apps/desktop/src/renderer`
   — every remaining hit is paired with a `dark:` variant, or the hit count is zero because the
   colours moved into `globals.css` tokens (item 5).
6. [x] `grep -n "forcedTheme" packages/ui/components/providers.tsx` — **no hits** (item 6), and
   `grep -rn "themeControl" packages/ui/components/DashboardHeader.tsx apps/desktop/src/renderer`
   — the slot exists and the renderer fills it. A test asserts the toggle cycles
   light → dark → system and that the provider is no longer force-pinned.
7. [x] `npm test` green (existing 343 as the floor — 235 core + 108 desktop — plus the new
   component tests; **note** `packages/ui` ships no test suite of its own by design (Phase 14),
   so these land in `apps/desktop/tests/`, which is where the components are actually rendered.
   The renderer currently has no component-rendering test at all — `authStatusLabel.test.ts` is
   a pure-function test — so this phase must **add a component test harness**
   (`@testing-library/react` + `jsdom`) as its first step, which is new devDependency + vitest
   `environment` config work in `apps/desktop`, not a free assumption).
8. [x] `npm run typecheck` clean; `npm run desktop:build` produces
   `Toastmasters Tools Setup 1.5.0.exe`;
   `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read
   `1.5.0`.
9. [x] **Manual (user):** launch the built `.exe` and confirm — the pointer cursor appears over
   buttons, table rows, and accordion headers; clicking anywhere on a multi-pathway row expands
   it and anywhere on a child row opens that pathway; the single expand/collapse toggle works on
   **both** screens; the theme toggle switches light↔dark with **all** badges legible in dark
   (this is the item automated tests cannot judge — the tokenisation in item 5 is verified for
   *presence* by validation 5, not for *legibility*); and the theme survives an app restart.

> **Scope note:** items 1–4 and 7 are mechanical and independently verifiable. Item 6 is the
> only one with a real ordering dependency (item 5 must land first — Finding B), and item 9 is
> the only judgement call that must go to the user. If the phase runs long, items 5 + 6 (theming)
> are the clean split point: 1–4 + 7 ship a complete "affordances + layout" phase on their own.

> **Note:** Validation items 1–8 are confirmed against the live repo, independently re-verified
> during this docs pass (not just taken from agent self-report): `npm test` passed **359/359**
> (235 core + 124 desktop, +16 over the pre-Phase-19 floor of 343 — 108 desktop + 8 new
> `MemberTable.test.tsx` cases + 4 new `LevelAccordion.test.tsx` cases + 4 new
> `ThemeToggle.test.tsx` cases), `npm run typecheck -w @toastmasters/desktop` is clean, and
> `apps/desktop/release/Toastmasters Tools Setup 1.5.0.exe` (+ `.blockmap`) exists on disk with
> every workspace `package.json` (root, `packages/core`, `packages/ui`, `apps/desktop`) reading
> `1.5.0`. **`v1.5.0` has not been tagged yet** — that remains a separate step after this docs
> pass, per the same pattern Phase 18 left open.
>
> **Grep-literal/implementation mismatch (not a regression — flagging so it isn't re-litigated
> later, same as Phase 15's and Phase 17's flagged mismatches):** validation item 3's literal
> `grep -c "Expand all" packages/ui/components/LevelAccordion.tsx` now reads `0`, not `>0`. This
> is expected, not a miss: item 3's own text invited "extracting the toggle as a shared
> component in `packages/ui`" (see item 4), and the implementation took that route — both
> `LevelAccordion.tsx` and `MemberTable.tsx` now render the shared `ExpandCollapseToggle.tsx`,
> which is where the "Expand all"/"Collapse all" label text actually lives
> (`grep -c "Expand all" packages/ui/components/ExpandCollapseToggle.tsx` → `2`). The real
> behaviour the grep was checking for — one button, correct label-flip, default all-expanded —
> is genuinely present and covered by `apps/desktop/tests/LevelAccordion.test.tsx` and
> `MemberTable.test.tsx`; only the specific file path in the literal command is now stale.
>
> **Docs-pass cross-check (task per this phase's closing brief):** re-read `ExpandCollapseToggle.tsx`,
> `MemberTable.tsx`, `LevelAccordion.tsx`, and `apps/desktop/src/renderer/index.html` directly.
> `ExpandCollapseToggle` holds **no internal state** — it is a pure controlled component
> (`{ expanded, onToggle }` props only) — so `MemberTable`'s toggle (backed by its own
> `expandedRows`/`anyExpanded` state) and `LevelAccordion`'s toggle (backed by its own
> `openItems`/`anyOpen` state) cannot interfere with each other; there is no shared/module-level
> state to sync. The FOUC guard script in `index.html` wraps its `localStorage.getItem("theme")` /
> `matchMedia` read in a `try`/`catch` and silently falls through to next-themes' own
> effect-based theme application on failure, so a restrictive Electron partition that throws on
> `localStorage` access degrades gracefully (a possible one-frame flash of the wrong theme, not a
> crash). **No bug found in either area — the cross-check held up.**
>
> **Item 9 (manual user verification) is confirmed (2026-07-16):** the user launched the built
> `.exe` and checked cursor affordances, whole-row click behaviour, the single toggle on both
> screens, dark-mode legibility of every badge, and theme persistence across a real app restart.

---

> **Reprioritisation (2026-07-16, VPE request):** the overview-page name-search feature below is
> inserted as the new **Phase 20** — requested directly by the VPE right after Phase 19 shipped —
> pushing the production-grade refactor down to **Phase 21**. Version targets re-sequenced to
> stay monotonic: `1.6.0` (search) → `1.7.0` (refactor).

---

## Phase 20 — Done (Overview page name search, minor version → 1.6.0)

_The overview table (`packages/ui/components/MemberTable.tsx`) lists every club member with no
way to jump straight to one — on a club with dozens of members, finding a specific person means
scanning the whole table. This phase adds a live text filter above the table: type a name, the
visible rows narrow to matches immediately. **Confirmed with the VPE (2026-07-16):** a live
in-place filter, not a combobox that selects-and-navigates to a member — the plain full table is
already how the VPE scans status across the whole club, and narrowing it in place keeps that
scan-everything view intact rather than replacing it with a jump-to-one interaction. User-facing,
so **minor bump → `1.6.0`.**_

- [x] **Search input above the table.** Add a text `Input` (`packages/ui/components/ui/input.tsx`
      — an existing shadcn primitive, no new dependency) above the member table in
      `packages/ui/components/MemberTable.tsx`, alongside (not replacing) the existing
      `ExpandCollapseToggle` row added in Phase 19. Filter is a case-insensitive substring match
      against `MemberSummary.name`. This is local component state — no IPC/query change, no
      `packages/core` change.
- [x] **Empty/no-match state.** An empty query shows every member (current behaviour, unchanged).
      A query with zero matches shows a friendly inline message (e.g. "No members match
      '<query>'") instead of an empty `<TableBody>`.
- [x] **Interaction with expand/collapse (Phase 19 items 3/4).** `ExpandCollapseToggle` and the
      `hasMultiPathway`/`expandedRows` logic it drives must operate on the **filtered** list, not
      the full one — expanding "all" while a filter is active should only affect the rows
      actually on screen, and the toggle must still hide itself if no *visible* member has
      multiple pathways, even if some hidden-by-filter member does (the same "never a dead
      button" rule Phase 17/19 already applied elsewhere).
- [x] **Live match count.** Show a small "`N of M members`" hint next to the search input,
      updating as the user types, so the VPE can tell an empty result apart from "still typing."
      Wire it through `aria-live="polite"` (or equivalent) so it's announced to screen readers,
      not just visible to sighted users.
- [x] **Clearable.** A small clear ("×") control inside or next to the input resets the query in
      one click/tap — don't make the VPE select-all-delete to get back to the full table.
- [x] **State persists across a refresh, resets on navigation.** Typing a query and then clicking
      Refresh Progress/Membership must not clear it (the query lives in `MemberTable`'s own
      component state, independent of the `members` data reload in `DashboardView`). Returning
      from the member detail screen to the dashboard **does** reset it — `App.tsx`'s view union
      already fully unmounts/remounts `DashboardView` on that transition, so this is existing
      behaviour to leave alone, not a new bug to fix or special-case.
- [x] **No debounce.** Club rosters are small (tens of members, not thousands) — filter on every
      keystroke directly against the in-memory array; don't add a debounce/throttle that would
      only mask a performance problem this scale doesn't have.
- [x] **Version bump:** minor-bump every workspace `package.json` `version` to `1.6.0`; after
      validation, tag `v1.6.0`.

**Validation:**
1. [x] `grep -n "Input" packages/ui/components/MemberTable.tsx` — the search input is present in
   the overview table component.
2. [x] A unit test asserts: typing a substring of one member's name narrows the rendered rows to
   just that member (case-insensitive); clearing the query restores the full list.
3. [x] A unit test asserts the "no matches" message renders for a query matching nobody, and does
   **not** render for an empty query or a query with matches.
4. [x] A unit test asserts: with a filter active that hides the only multi-pathway member, the
   `ExpandCollapseToggle` control is not rendered — the filtered-list dead-control guard,
   mirroring Phase 19 item 4's original one.
5. [x] A unit test asserts the clear control resets the query and restores the full table.
6. [x] `npm test` green (floor: the Phase 19 count, currently 359 — 235 core + 124 desktop);
   `npm run typecheck` clean; `npm run desktop:build` produces
   `Toastmasters Tools Setup 1.6.0.exe`; `grep -h '"version"' package.json packages/*/package.json
   apps/*/package.json` — all read `1.6.0`.
7. [x] **Manual (user):** launch the built `.exe`, type a partial name into the search box,
   confirm the table narrows live, the match count updates, clearing restores the full list, and
   a Refresh click doesn't wipe the in-progress query.

> **Note:** Validation items 1–6 are confirmed against the live repo, independently re-verified
> during this docs pass (not just taken from the implementer's self-report), and **item 7 (manual
> user check) is now also confirmed (2026-07-16)** — the user launched the built `.exe`, typed a
> partial name, and confirmed the table narrowed live, the match count updated, clearing restored
> the full list, and a Refresh click did not wipe the in-progress query. `npm test` passed
> **367/367** (235 core + 132 desktop, +8 over the pre-Phase-20 floor of 359 — all 8 new cases
> land in `apps/desktop/tests/MemberTable.test.tsx`, which grew from 8 to 16), `npm run typecheck
> -w @toastmasters/desktop` is clean, and `apps/desktop/release/Toastmasters Tools Setup
> 1.6.0.exe` (+ `.blockmap`) exists on disk with every workspace `package.json` (root,
> `packages/core`, `packages/ui`, `apps/desktop`) reading `1.6.0`. **`v1.6.0` has not been
> tagged yet** — that remains a separate step after this docs pass, per the same pattern Phases
> 18 and 19 left open.
>
> **Judgment calls made during implementation (read directly off
> `packages/ui/components/MemberTable.tsx`, not assumed):**
> - **Search input placement:** the `Input` sits in the *same* `flex flex-wrap` control row as
>   the live match count and the `ExpandCollapseToggle` (all three are siblings inside one
>   `<div className="flex flex-wrap items-center gap-3 mb-3">` above `<Table>`), not on a row of
>   its own — this keeps the whole "narrow the table" toolbar in one visual group rather than
>   spreading it across two rows.
> - **Empty-state wording:** the message is rendered as `No members match "{trimmedQuery}"`
>   (curly double quotes via `&quot;`, the query itself un-escaped inside them) — e.g. typing
>   `zzz` renders exactly `No members match "zzz"`, matching the wording this phase's spec
>   proposed.
> - **Clear control:** implemented as a small inline icon button (`lucide-react`'s `X`,
>   `size={14}`), absolutely positioned inside the input's own relative wrapper (`right-1.5`,
>   vertically centered) — not a separate element sitting next to the input. It only renders
>   once `query` is non-empty, and the input itself gains `pr-7` in that state so the icon never
>   overlaps typed text.
> - **Match-count wording:** `"{filteredMembers.length} of {members.length} members"`, always
>   visible (not just once a query is typed) and wrapped in `aria-live="polite"` so an empty
>   query's "N of N members" establishes a baseline a screen-reader user can compare later counts
>   against.
>
> **Docs-pass cross-check (task per this phase's closing brief):** re-read the current
> `MemberTable.tsx` directly rather than trusting the implementation summary. Two specific risks
> were checked and **neither is a bug**:
> - *Expand-all while filtered, then clear.* `multiPathwayEmails` (and therefore the set
>   `toggleExpandAll` writes into `expandedRows`) is derived from `filteredMembers`, not the raw
>   `members` prop — a multi-pathway member hidden by the search never has its email added to
>   `expandedRows` in the first place, so clearing the filter afterwards cannot reveal it
>   pre-expanded. This is exercised by a genuine negative control,
>   `apps/desktop/tests/MemberTable.test.tsx`'s "expand-all scoped to visible rows" case (a
>   `deltaMultiHidden` member deliberately excluded from the active filter, expand-all clicked,
>   filter cleared, then asserted still collapsed) — re-run standalone and confirmed passing.
> - *Empty-state `colSpan={5}` vs. the actual column count.* `<TableHeader>` currently renders
>   exactly five `<TableHead>` cells (NAME, TITLE, PATHWAY, NEXT LEVEL, REMAINING), matching the
>   no-match row's `colSpan={5}` exactly — no desync today. This pairing is hardcoded rather than
>   derived (e.g. from a shared column-count constant), so a future column addition would need to
>   update both spots by hand; flagging this as a latent maintenance trap for Phase 21's refactor
>   pass, not a bug in the current code.
>
> **Item 7 (manual user verification) is not done** and is not being claimed as done here —
> launching the installed `.exe`, typing a partial name, and confirming live narrowing, the match
> count, the clear button, and that Refresh doesn't wipe the in-progress query all still require
> the user to look.

---

## Phase 21 — Done (Production-grade refactor, minor version → 1.7.0)

> _Was **Phase 15** before the 2026-07-16 reprioritisation, then **Phase 18** before the
> 2026-07-16 logout insertion, then **Phase 19** before the 2026-07-16 UI-polish insertion, then
> **Phase 20** before the 2026-07-16 search-filter insertion (see above). Stays **last** of the
> planned phases: it's a behaviour-preserving cleanup, so it yields to the pipeline (15),
> login-UX (16), logout (17), perf (18), UI-polish (19), and the search filter (20) work the VPE
> asked for first. Version target re-sequenced `1.6.0` → `1.7.0` to stay monotonic behind Phase
> 20's `1.6.0`._

_With the repo collapsed to a single app plus shared packages (Phase 14), do a repo-wide
cleanup pass to make it maintainable and production-grade: consistent structure, enforced
lint/format, strict typing, no dead code, uniform error handling and logging. This is a
behaviour-preserving refactor — no new user-facing feature and no user-facing change to the
shipped `.exe` — so **tag the resulting build with a minor bump — `1.7.0`.** Do this only
after Phases 15–20; refactoring code those phases are still actively changing is wasted work
(Phase 19/20 in particular rewrite much of `packages/ui`)._

- [x] **Tooling baseline:** a single shared ESLint (flat config) + Prettier setup at the repo
      root applied to every workspace; add `lint` / `format` scripts and wire `lint` into `npm test`
      and CI. Resolve every warning it surfaces (unused vars/imports, floating promises, etc.).
- [x] **Strict TypeScript:** enable `strict` (+ `noUncheckedIndexedAccess`,
      `noImplicitOverride`) in a shared base `tsconfig` that each workspace extends; eliminate
      resulting errors and stray `any`s (replace with real types from `packages/core/types.ts`).
- [x] **Module boundaries & dead code:** remove any code orphaned by Phases 6/10/14; ensure
      `@toastmasters/core` and `@toastmasters/ui` only expose intended `exports` subpaths;
      keep the "core imports nothing framework-specific" invariant
      (`packages/core/tests/workspace.test.ts`) and add the equivalent guard for `packages/ui`.
- [x] **Error handling & logging:** replace scattered `console.log`/`console.error` with a
      small shared logger (levels + structured context), keeping the `ProgressReporter` callback
      seam (`packages/core/services/fetch.ts:15`) intact so the Electron live-log still works.
      Consistent error types for the auth/HTTP failure paths (`helpers/api.ts`).
- [x] **Naming & consistency:** uniform file/naming conventions, import ordering, and
      barrel/`index.ts` conventions across `packages/*` and `apps/desktop`.
- [x] **No behaviour change / no coverage loss:** the full test suite stays green and coverage
      does not drop; refactors that touch logic get a test asserting the preserved behaviour.
- [x] **Version bump:** set every workspace `package.json` `version` to `1.7.0`; after
      validation, tag the build `v1.7.0`.

**Validation:**
1. [x] `npm run lint` exits 0 with zero warnings; `npm run format -- --check` (or equivalent) is
   clean. Confirmed: `npm run lint` → exit 0, zero warnings; `npm run format:check` → clean.
2. [x] `npm test` passes with coverage ≥ the Phase 14 baseline (no regression). Confirmed:
   **394/394** (253 core + 141 desktop) — well above the Phase 14 baseline of 288 (219 core + 69
   desktop). Re-run after `npm run desktop:build` (which rebuilds `better-sqlite3` for Electron's
   Node-ABI) still passed 394/394, confirming `restore:node-abi` correctly restores the
   vitest-compatible native build.
3. [x] `npm run desktop:build` produces `Toastmasters Tools Setup 1.7.0.exe`. Confirmed on disk:
   `apps/desktop/release/Toastmasters Tools Setup 1.7.0.exe` (91,660,365 bytes) + its `.blockmap`.
4. [x] `grep -rc "any" packages/core/*.ts packages/core/helpers` shows no new bare `any`s vs.
   baseline; strict flags present in the shared tsconfig. Confirmed: 2 substring hits, both false
   positives inside comments ("any module importing it", "correct under any cwd") in
   `packages/core/paths.ts` — zero actual bare `any` types, matching the 0 baseline.
   `tsconfig.base.json` carries `strict: true` plus the two new flags, `noUncheckedIndexedAccess`
   and `noImplicitOverride`; `packages/core`, `apps/desktop`, and the new `packages/ui/tsconfig.json`
   all extend it, and `npm run typecheck` is clean in all three workspaces.
5. [x] `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read
   `1.7.0`. Confirmed.

> **Note:** All 5 validation items were independently re-run and confirmed by the docs pass, not
> taken from any agent's self-report — including re-reading the actual source rather than trusting
> the summary. `eslint.config.js` (new root flat config, `typescript-eslint` +
> `eslint-config-prettier` + `eslint-plugin-react-hooks`) and `.prettierrc.json`/`.prettierignore`
> exist as described; root `package.json` gained `lint`/`format`/`format:check` and the root `test`
> script now chains `npm run lint` after core+desktop tests. `tsconfig.base.json` is new at the
> repo root; `packages/core/tsconfig.json` and `apps/desktop/tsconfig.json` extend it, and
> `packages/ui` — which had **no** `tsconfig.json` before this phase — now has one (also extending
> the base) plus a `typecheck` script in its `package.json`. The two structured loggers
> (`packages/core/logger.ts`, used by `packages/core/index.ts`, `services/fetch.ts`, and
> `services/membership.ts`; `apps/desktop/src/main/logger.ts`, used by `apps/desktop/src/main/index.ts`
> and `auth.ts`) are deliberately separate, not shared — every file under `apps/desktop/src/main`
> except `core.ts` must never statically import `@toastmasters/core` (an invariant
> `apps/desktop/tests/main-bundle.test.ts` enforces on the built bundle, guarding against evaluating
> core's env-derived consts before Electron's bootstrap sets `TOASTMASTERS_DATA_DIR`), and both
> loggers deliberately leave the `ProgressReporter` callback seam (`services/fetch.ts`,
> `services/membership.ts`, `helpers/api.ts`) untouched — it is user-facing CLI/IPC output, not
> diagnostic logging, and still defaults to `console.log`. `packages/core/helpers/api.ts` gained an
> `HttpError extends Error` class (with a `.status` field) reused by `services/membership.ts`; its
> `.message` text (`HTTP ${status} ${statusText} for ${url}`) is unchanged from the old inline error,
> so `apps/desktop/src/renderer/views/DashboardView.tsx`'s `/HTTP 40[13]/` auth-failure regex still
> matches — confirmed by reading both files directly. The new "packages/ui stays desktop-agnostic"
> guard in `packages/core/tests/workspace.test.ts` mirrors the pre-existing core guard, asserting no
> file under `packages/ui/components`/`packages/ui/lib` imports `electron` or reaches into
> `apps/desktop`, and has a genuine negative control —
> `packages/core/tests/fixtures/ui-boundary-offender.tsx`, a deliberately broken `.tsx` fixture
> (never imported by real code, so `tsc` never compiles it, scanned only as text) that proves the
> guard fails closed by importing both `electron` and `apps/desktop/src/main/auth`. Both new logger
> unit test files (`packages/core/tests/logger.test.ts`, `apps/desktop/tests/logger.test.ts`) exist
> and pin level→console-method routing and empty-vs-non-empty-context call arity. A repo-wide grep
> for `TODO`/`FIXME`/`@deprecated` across `packages/` and `apps/` (excluding tests) came back empty —
> a legitimate "confirm and close," matching how Phase 16 closed its "What's New" item, not a
> skipped check. `packages/core/tsconfig.json`'s `include` (`**/*.ts`) covers `tests/` again, so the
> mid-phase exclusion mentioned in the implementation history is reverted, as claimed. **This is a
> behind-the-scenes refactor with no user-facing `.exe` behaviour change**, so — unlike Phases 16,
> 17, 19, and 20 — there is correctly no "manual, confirmed by user" checkbox in this phase's
> Validation list; none was fabricated here. **`v1.7.0` has not been tagged yet** — that remains a
> separate step after this docs pass, per the same pattern Phases 18, 19, and 20 left open.

---

## Phase 22 — Done (Refresh UX hardening + automated release tagging, minor → 1.8.0)

_Four loose ends before shipping to the customer and moving into maintenance. Items 1–3 are
refresh-console UX papercuts that share the same touched files (`DashboardView.tsx`, `App.tsx`,
IPC, core); item 4 is a separate CI/CD concern, but it's small and this phase's own merge to
`main` is the first real exercise of the new tag/release automation — the same dogfooding
pattern Phase 15 used for its pipeline change. User-facing changes to the `.exe` (items 1–3), so
**minor bump → `1.8.0`.**_

> **Supersedes the old "Deferred — Hardened pipeline" item** (removed from this roadmap): that
> item's actual pain point — cookie expiry silently breaking a run with a confusing error — is
> what item 1 below fixes properly, with a clear in-app remediation path instead of a startup
> pre-check. The rest of that deferred item (`npm run all`, stale-`results/` warnings) is now
> moot — there is no CLI-only user left to serve; the desktop app is the shipped product.

- [x] **(item 1) Cookie-expiry clarity.** In `DashboardView.tsx`'s `reportRefreshError`, when the
      `AUTH_ERROR` regex matches (HTTP 401/403), stop showing the truncated raw message in the
      toast. Instead: push the full error text into the existing `log` console state, and show a
      fixed, friendly toast — "Your Toastmasters session has expired. Log out and log in again to
      continue." — keeping the existing "Log in again" action button. Non-auth-error failures are
      unchanged (still show the first line in the toast).
- [x] **(item 2) Persistent, independently-collapsible output console.** Today `App.tsx` renders
      `DashboardView`/`MemberDetailView` as mutually exclusive branches, so navigating to the
      detail page unmounts `DashboardView` — and with it, the `log` state and `onRefreshLog`
      subscription it owns. Lift that state to `App.tsx` (always mounted) so the console survives
      navigation, and render it as a sibling above whichever view is active, in the same
      `max-w-[960px] mx-auto` width both views use. Give the console its own collapse toggle in
      its header bar, with its own state — **not** wired to `ExpandCollapseToggle`, which only
      ever controlled table rows/accordion levels and is an unrelated concern. Add a "Copy logs"
      button in the console header (`navigator.clipboard.writeText`, success/error toast) so the
      user can hand the log to the maintainer if problems persist. Default: expanded while a
      refresh is active; otherwise leave whatever state the user last set.
- [x] **(item 3) Cancel an in-flight refresh.** Feasible — both scrapers use the platform `fetch`,
      which supports `AbortSignal`. Thread a signal from a new IPC channel down into core:
  - `packages/core/helpers/api.ts`: add `CancelledError extends Error` (mirrors the existing
    `HttpError`); thread an optional `signal` through `fetchPage`, `fetchDetail`, and
    `fetchAllProgress` into the underlying `fetch(...)` calls; check `signal?.aborted` between
    page/batches and stop early.
  - `packages/core/services/fetch.ts` / `services/membership.ts`: `main(report, signal?)` passes
    the signal through; an abort during Step 2 skips Step 3 (`snapshotProjects`) rather than
    writing incomplete data — Step 1's snapshot, already written, is safe to keep.
  - New `IPC.REFRESH_CANCEL` channel. `apps/desktop/src/main/index.ts` keeps a module-level
    `AbortController` for the in-flight refresh (only one can run at a time — both Refresh
    buttons disable together already); the cancel handler calls `.abort()`. `handleRefresh`
    catches `CancelledError` distinctly and returns `{ ok: false, code: "CANCELLED", ... }`
    (not the generic `SERVER_ERROR`).
  - Renderer: a **Cancel** button in the console header while a refresh is active; the refresh
    handlers check `e.code === "CANCELLED"` before falling into the auth-error path and show a
    neutral "Refresh cancelled" toast instead (no "Log in again" action).
- [x] **(item 4) Automatic tag + Release on merge to `main`.** Today the VPE creates the GitHub
      Release by hand after tagging. In `.github/workflows/release.yml`'s `build-windows` job, add
      steps after "Upload installer artifact" — gated on the exact guard the Phase 15 rolling
      pre-release step already uses (`github.ref == 'refs/heads/main' && github.event_name ==
      'push'`, so a manual `workflow_dispatch` run never auto-tags):
  1. Read the version from the root `package.json`; check via `git ls-remote --tags origin
     "refs/tags/v<version>"` whether that tag already exists (idempotent — a docs-only merge with
     no version bump no-ops here, same as today).
  2. If not: create and push an annotated tag `v<version>` using the `GITHUB_TOKEN`-backed remote
     `actions/checkout` already configures — no new secret.
  3. If a new tag was just created: publish the versioned Release for it directly in this same job
     (`softprops/action-gh-release@v2`, `generate_release_notes: true`), reusing the `.exe`/
     `.blockmap` already built in this run rather than rebuilding. This is a **new, distinctly
     gated** step — separate from the existing tag-push-triggered "Publish GitHub Release" step,
     which stays as-is for the (now rare) case of a manually pushed version tag. (A tag pushed
     with the default `GITHUB_TOKEN` does not itself re-trigger a workflow run — GitHub's
     loop-prevention — which is why the Release is published in the same job instead of relying on
     the tag-push trigger.)
  - Extend `packages/core/tests/release-workflow.test.ts` (same structural-YAML-plus-negative-
    control pattern already used there) to cover the new steps and their guard.
  - Update `CONTRIBUTING.md`'s description of what happens automatically on merge to include the
    new versioned-tag/Release behavior, and remove any remaining "you create the Release on
    GitHub" language.
- [x] **Version bump:** minor-bump every workspace `package.json` `version` to `1.8.0`; after
      validation, tag `v1.8.0` (or let item 4's new automation do it on merge).

**Validation:**
1. [x] A unit test on `reportRefreshError`/the refresh handlers asserts: an `AUTH_ERROR`-matching
   failure appends the full message to the log and shows the fixed hint text in the toast (not
   the raw message); a non-auth failure is unchanged (item 1).
2. [x] A component test simulates a view switch (dashboard → member detail → dashboard) with a
   non-empty log and asserts the console's content and collapse state are unaffected by the
   navigation; a second test asserts toggling the console's own collapse control does not affect
   `ExpandCollapseToggle`'s state or vice versa (item 2).
3. [x] `grep -n "REFRESH_CANCEL" apps/desktop/src/shared/ipc.ts` — channel declared; a unit test
   (mocked `AbortController`/fetch) proves a cancelled progress or membership run: (a) stops
   further page/detail fetches, (b) does not call `snapshotProjects`/write a membership CSV for
   the aborted run, and (c) surfaces as `code: "CANCELLED"`, not `SERVER_ERROR`, over IPC (item 3).
4. [x] `grep -nE "refs/tags/v|ls-remote|action-gh-release" .github/workflows/release.yml` shows
   the new tag-check/create/publish steps; `packages/core/tests/release-workflow.test.ts` passes,
   including a negative control that fails on the pre-Phase-22 shape (item 4).
5. [x] `npm test` green (floor: 394 — 253 core + 141 desktop) plus the new cases above; `npm run
   typecheck` clean; `npm run desktop:build` produces `Toastmasters Tools Setup 1.8.0.exe`;
   `grep -h '"version"' package.json packages/*/package.json apps/*/package.json` — all read
   `1.8.0`.
6. [ ] **Manual (user):** force a 401/403 (e.g. an expired/invalid cookie) and confirm the toast
   hint + full error in the console; start a refresh, navigate to a member's detail page and back,
   confirm the console/log survived; click Cancel mid-refresh and confirm it stops cleanly with no
   partial/corrupt data; after this phase's PR merges to `main`, confirm on GitHub that a
   `v1.8.0` tag and a matching (non-prerelease) Release with the installer attached were created
   automatically, with no manual step.

> **Finding (discovered during the user's manual validation of item 1/6 — a real bug, not a
> cosmetic gap):** the first `.exe` build (`Toastmasters Tools Setup 1.8.0.exe`) still showed a
> raw, cryptic error — `Invalid Opening Quote: a quote is found on field "<!DOCTYPE html>" at
> line 8, value is "<html lang="` — in the toast for a **Refresh Membership** run, even though
> the progress console had already logged "Roster downloaded — saved and recorded." Root cause,
> confirmed by reading `packages/core/services/membership.ts`: an expired/invalid `TI_COOKIE`
> does **not** fail this endpoint with a 401/403 — Toastmasters answers **200 OK with an HTML
> login/error page** instead of the CSV export. The old code had no way to tell the difference: it
> wrote that "csv" to disk, reported success, and only then blew up inside
> `snapshotMembership` (`helpers/db.ts`'s `csv-parse` call) with a parser error that item 1's
> `AUTH_ERROR` regex (`/HTTP 40[13]/`) never recognized, since no real HTTP error status was ever
> involved — so the user saw the raw parser error in a toast instead of the friendly
> "session expired" hint item 1 was supposed to guarantee.
>
> **Fix:** `main()` now checks the response body immediately after fetching it — `looksLikeHtml()`
> tests whether the trimmed, lowercased head starts with `<!doctype html` or `<html` — and if so
> throws an `HttpError` with `status: 401` and a message containing the literal substring
> `"HTTP 401"`, **before** the file is written, before `snapshotMembership` ever sees it, and
> before "Roster downloaded" is reported. This routes it through the exact same `AUTH_ERROR`
> path the rest of item 1 already built: the full detail lands in the log console, and the toast
> shows the friendly "session expired" hint with the "Log in again" action. A real CSV whose
> content happens to mention "<html>" inside a field value is unaffected — the check only matches
> when the response's head itself is a doctype/html tag, not any occurrence of that text.
> Covered by the new `packages/core/tests/membership-expired-session.test.ts` (4 tests): the
> HTML-response case rejects with the `HTTP 401`-shaped `HttpError` and never writes the file or
> calls `snapshotMembership`; a second test confirms "Roster downloaded" is never reported before
> the throw; a negative control proves a real CSV containing "<html>" in a field is unaffected;
> and a last test pins the fix's message shape against the actual `AUTH_ERROR` regex the renderer
> uses, so the two can't silently drift apart. `npm test` now passes **270 core + 151 desktop =
> 421** (up from 417), `npm run typecheck`/`lint`/`format:check` are clean, and
> `apps/desktop/release/Toastmasters Tools Setup 1.8.0.exe` was rebuilt with the fix — same
> version number (no bump; this is a fix within the still-unreleased phase, mirroring how Phase
> 17's Finding #2 and Phase 18's fallback fixes were handled). **Confirmed by the user
> (2026-07-17):** re-ran Refresh Membership against a genuinely expired TI session with the
> rebuilt `.exe` — the fix holds. The rest of item 6 (mid-refresh navigation, Cancel, and the
> auto-tag/Release check) requires this phase's own PR to actually merge to `main`, so it stays
> open until after that.

> **Note:** Validation items 1–5 are confirmed against the live repo, independently re-run by the
> docs pass (not taken from any agent's self-report). `npm test` passed **266 core + 151 desktop =
> 417 tests**, up from the pre-phase floor of 394 (253 + 141) — the new cases live in
> `packages/core/tests/{api-cancellation,fetch-cancel,membership-cancel}.test.ts` (10 tests
> attacking the `AbortSignal`/`CancelledError` threading through `helpers/api.ts`,
> `services/fetch.ts`, and `services/membership.ts`, including negative controls proving each
> check can actually fail), `apps/desktop/tests/DashboardView.test.tsx` (3 tests for the
> `reportRefreshError`/`CANCELLED` behaviour), and `apps/desktop/tests/App.test.tsx` (4 tests
> proving the console survives a real dashboard → member-detail → dashboard round trip via
> `@testing-library/react`, that its collapse toggle is wired independently of
> `ExpandCollapseToggle` in both directions, and covering the Cancel/Copy-logs buttons), plus
> extensions to `main-ipc.test.ts`, `preload.test.ts`, and `release-workflow.test.ts` (the last
> gaining a stronger guard — the `event_name == 'push'` half was originally only asserted on the
> tag-check step, not the two steps that act on it — and a negative control proving that gap was
> real). `npm run lint` and `npm run format:check` are clean (a repo-wide CRLF/LF churn from
> `core.autocrlf` was normalized away with zero real content change, confirmed via `git diff
> --stat` parity before/after). `npm run typecheck` is clean in `packages/core`, `packages/ui`,
> and `apps/desktop`. `apps/desktop/release/Toastmasters Tools Setup 1.8.0.exe` (+ `.blockmap`)
> exists on disk, and every workspace `package.json` (root, `packages/core`, `packages/ui`,
> `apps/desktop`) reads `1.8.0`. `results/`, `.env`, and `config.env` were confirmed untouched
> throughout. **`v1.8.0` has not been tagged yet** — per item 4's own design, this phase's PR
> merging to `main` is what should create it automatically; **item 6 (manual verification) remains
> open**, same as every prior user-facing phase, pending the user exercising the built `.exe` and
> the real merge-to-`main` flow.

---

## Phase 23 — Done (Security: bump end-of-life Electron major, minor → 1.9.0)

_A repo security audit (2026-07-17) found Electron pinned at `33.4.11` in
`apps/desktop/package.json` — past Electron's supported-majors window, so no further Chromium
security backports land on it. The one place untrusted remote content is rendered is the login
`BrowserWindow` (`apps/desktop/src/main/auth.ts`), which loads real
`toastmasters.org`/`basecamp.toastmasters.org` pages to capture session cookies after the user
logs in; it's already correctly sandboxed (`nodeIntegration:false`, `contextIsolation:true`,
`sandbox:true`, no preload), but an unpatched Chromium renderer-sandbox-escape CVE against that
window is residual risk that only grows the longer this sits unpatched. Land this ahead of
Phase 24's credential-encryption work and Phase 25's UI work, so both build on a currently-
supported runtime instead of needing to be re-verified after a later bump. No new user-facing
feature — the app just keeps working — but per this project's convention of minor-bumping every
phase regardless of visibility (Phase 21 precedent), **minor bump → `1.9.0`.**_

- [x] **Spike first (not shippable on its own):** locally bump `electron` in
      `apps/desktop/package.json` to the current stable major, `npm install`, `npm run
      desktop:build`, and confirm `better-sqlite3` rebuilds cleanly against the new Electron
      Node-ABI (via the existing `restore:node-abi` step) and that `electron-builder`/
      `electron-vite` support the target major without needing their own bump. If either forces a
      larger chain of upgrades than expected, note it and re-scope before continuing.
- [x] **Version bump:** bump `electron` (and `electron-builder`/`electron-vite` if the spike
      required it) in `apps/desktop/package.json` to the chosen current-stable major.
- [x] **CI:** confirm the existing Phase 13 `windows-2022` + pinned Python 3.11 native-rebuild
      path still succeeds unchanged; adjust only if the spike surfaced a gap.
- [x] **No behaviour change:** this is a runtime bump, not a feature —
      `apps/desktop/src/main/auth.ts`'s login/harvest/logout flow, the IPC surface, and the
      renderer are untouched except where the Electron major forces an API update.

**Validation:**
1. [x] `npm test` green at the pre-phase floor (no regressions); `npm run typecheck` clean.
2. [ ] `npm run desktop:build` produces `Toastmasters Tools Setup 1.9.0.exe` with no native-module
   (`better-sqlite3`) load errors.
3. [x] `grep -h '"electron"' apps/desktop/package.json` shows the new pinned major; confirm at
   merge time it's still within Electron's current supported-majors window.
4. [ ] **Manual (user):** on the packaged `.exe` — log in and confirm the login window completes
   and cookies are captured; log out; log back in; run Refresh Progress and Refresh Membership
   (exercises the `better-sqlite3` native module); restart the app and confirm the prior login
   session persisted. Any regression here blocks the merge.

> **Note:** Landed as `electron: 33.4.11 → 43.1.1` (exact pin, matching the pre-existing format),
> confirmed against `npm view electron dist-tags` at validation time (2026-07-17) — `latest` was
> `43.1.1`; `44.x` exists only as `alpha` prereleases, so `43.1.1` was the correct current-stable
> target, not a partial bump. The spike confirmed `electron-builder` and `electron-vite` needed no
> *compatibility* bump — `npm run desktop:build` gets past `electron-vite build` and into
> `electron-builder`'s `@electron/rebuild` step (`electronVersion=43.1.1`) with no
> version-incompatibility complaint from either tool (`electron-builder` was separately bumped for
> an unrelated security finding — see below). `.github/workflows/release.yml`'s
> `windows-2022` job needed no changes: its Python 3.11 pin exists for `node-gyp`/`distutils`
> during the `better-sqlite3` native rebuild and is unrelated to the Electron major, and the job
> otherwise just runs `npm ci && npm run desktop:build` generically. Every workspace
> `package.json` (root, `packages/core`, `packages/ui`, `apps/desktop`) bumped to `1.9.0`. A
> negative-control test, `apps/desktop/tests/electron-version.test.ts`, reads the real installed
> `electron` package (no mock) and asserts the major is `43` and matches the exact pin in
> `package.json`, guarding against a future dependency bump silently re-pinning back to an EOL
> major.
>
> **Regression found and fixed during validation:** the Electron bump's `npm install` reshuffled
> npm's hoisting and bumped the root-hoisted `typescript` from `5.9.3` to `6.0.3`.
> `packages/core` and `apps/desktop` already pinned `typescript: ^5.0.0` in their own
> `devDependencies`, so they got local 5.x copies and were shielded; `packages/ui` (whose
> `tsconfig.json`/`typecheck` script was added in Phase 21) had no explicit `typescript`
> devDependency and silently inherited the hoisted `6.0.3`, which flags `packages/ui/tsconfig.json`'s
> `baseUrl` option as deprecated (`TS5101`). Fixed by adding `typescript: ^5.0.0` to
> `packages/ui/package.json`, matching its sibling workspaces, and resyncing `package-lock.json` —
> not by suppressing the warning. `npm run typecheck --workspaces --if-present` is clean across
> `@toastmasters/core`, `@toastmasters/ui`, and `@toastmasters/desktop` as a result.
>
> **Security-review finding fixed post-PR:** a review on this phase's PR (#8) flagged that
> `electron-builder@^25.1.8` (pre-existing pin, unchanged by the Electron bump itself) resolves
> inside a HIGH-severity `tar` path-traversal / hardlink-symlink arbitrary-file-write range
> (`app-builder-lib`/`@electron/rebuild` → `tar`), reachable from exactly the native-module
> extraction step `npm run desktop:build` invokes on `windows-2022` CI to produce the shipped
> `.exe` — a real build-time supply-chain-integrity risk, in scope because this phase's own spike
> explicitly evaluated `electron-builder` compatibility with the new Electron major. Fixed by
> bumping `electron-builder` to `^26.15.3` (`npm audit`'s own `fixAvailable` pointer); confirmed
> via `npm audit --json` that the entire `electron-builder`/`app-builder-lib`/`@electron/rebuild`/
> `tar`/`cacache`/`dmg-builder` HIGH-severity chain is gone afterward (16 → 7 total vulnerabilities
> repo-wide), and that `electron-builder` 26.x's config schema is fully compatible with the
> existing `electron-builder.yml` — `npm run desktop:build` reaches the identical
> `@electron/rebuild electronVersion=43.1.1` invocation and the same pre-existing cross-compile
> wall as 25.x did, with no new/earlier failure point. `npm test` re-confirmed at 423/423
> afterward. The review's other two findings were left as explicitly non-blocking and are not
> addressed here: a MODERATE `esbuild`/`vite` advisory reachable via `electron-vite` (dev-server
> only — `npm run desktop:dev`, not the shipped artifact) and a suggestion to hoist the
> `typescript: ^5.0.0` pin to the root `package.json` as a single source of truth. Both remain
> open for a future phase; the 7 remaining `npm audit` findings after this fix are all in that
> same out-of-scope `vitest`/`vite`/`esbuild`/`electron-vite` cluster, pre-existing and unrelated
> to this phase's Electron bump.
>
> **Gap found, not fixed here:** `.github/workflows/ci.yml` runs `npm test` only — it never runs
> any workspace's `typecheck` script. That is how the `packages/ui` regression above slipped past
> this phase's own initial validation (which only checked `npm run typecheck -w
> @toastmasters/desktop`, the one workspace this phase's text mentions) until an independent
> cross-check ran `npm run typecheck --workspaces --if-present`. Worth a future phase adding a
> `typecheck` step to `ci.yml`; left unaddressed here as out of this phase's scope.
>
> **`npm run desktop:build` (item 2) was not achievable in this sandbox:** it reaches
> `electron-builder`'s `@electron/rebuild` step for `better-sqlite3` and fails with `node-gyp does
> not support cross-compiling native modules from source`. Root cause: this Linux sandbox has no
> outbound access to github.com, so the win32-x64 prebuilt binary can never be fetched and
> node-gyp falls back to a from-source build it cannot cross-compile for Windows — reproduced
> identically against the old, pre-bump `33.4.11` pin, confirming this is a pre-existing
> sandbox/network limitation, not a regression from this phase. The real confirmation happens on
> `windows-2022` in CI (`.github/workflows/release.yml`) once this branch's PR triggers `ci.yml`,
> or via a merge/`workflow_dispatch`-triggered `desktop:build`. **Item 2 (the built `.exe`
> artifact) and item 4 (manual login/logout/refresh verification on the packaged `.exe`) remain
> open** — the latter requires a human with the real installed `.exe`, same as every prior
> user-facing phase's manual-validation item.

---

## Phase 24 — Done (Security: encrypt stored session credentials at rest, minor → 1.10.0)

_The same audit found `apps/desktop/src/main/credentials.ts` writes captured session cookies
(`BASECAMP_SESSIONID`, `TI_COOKIE`) as cleartext `KEY=value` lines to `<userData>/config.env`.
These are unauthenticated bearer tokens — reusable by anything that can read the file (malware,
another local account, a cloud-backup/sync tool scooping up `%APPDATA%`), with no second factor
required. Electron ships `safeStorage.encryptString`/`decryptString` (OS-level encryption — DPAPI
on Windows) essentially for free, and this app doesn't use it yet — the `persist:toastmasters`
Chromium cookie jar is already OS-encrypted at rest, making `config.env` the one plaintext
outlier. Depends on Phase 23 landing first so this new storage code is validated on the
currently-supported Electron runtime. User-visible only as a trust upgrade (no behaviour change to
login/logout) — **minor bump → `1.10.0`.**_

- [x] **`CredentialCipher` in `credentials.ts`:** wrap each stored value with
      `safeStorage.encryptString`, base64-encoded, tagged with a self-describing prefix
      (`enc:v1:<base64>`) so a single loader can tell encrypted values from legacy plaintext.
      `upsertCredential` always encrypts on write when `safeStorage.isEncryptionAvailable()`; when
      unavailable (e.g. Linux without a keyring), fall back to plaintext and log a warning — never
      hard-fail or lock the user out.
- [x] **Transparent one-time migration:** `loadCredentials` decrypts `enc:v1:` values; for a value
      it finds as unprefixed plaintext, use it as today (copy into `process.env`) and immediately
      re-write it encrypted via `upsertCredential`, so an existing user's plaintext `config.env`
      self-upgrades on next launch with no dialog or consent prompt.
- [x] **Preserve the manual-paste fallback (Phase 11/12):** a user hand-pasting a plaintext cookie
      into `config.env` via "Open Credentials File…" must still work — the same plaintext-
      detection path in `loadCredentials` picks it up and encrypts it on next load. Update the
      file's template comments to say so.
- [x] **Logout parity:** confirm Phase 17's logout path clears the encrypted store the same way it
      clears plaintext today (don't reintroduce "deleting/blanking the file doesn't log you out").
- [x] **Bootstrap ordering:** `loadCredentials` currently runs at module-eval in `index.ts`, before
      `app.whenReady()`. `safeStorage` is only guaranteed ready after `whenReady()` on some
      platforms; since the only real constraint is credentials being in `process.env` before the
      first `loadCore()` call (already lazy, inside `whenReady`), move the load if needed to sit
      after `whenReady()` and before that first call.
- [x] **Docs:** update `USER_GUIDE.md` (and the credentials-file template comments) to describe
      the new encrypted-at-rest storage in place of any language implying plaintext; the "Nothing
      here ever leaves your computer" copy stays as-is (still true — this closes the at-rest gap,
      it doesn't change the exfiltration claim).

**Validation:**
1. [x] Unit tests (mocking `safeStorage`) cover: a fresh write is stored `enc:v1:`-prefixed and
   round-trips through decrypt; an existing plaintext value loads correctly *and* is rewritten
   encrypted on that same load; `isEncryptionAvailable() === false` falls back to plaintext with a
   logged warning rather than throwing.
2. [x] A test confirms logout clears both the encrypted and (legacy) plaintext value paths.
3. [ ] `npm test` green; `npm run typecheck` clean; `npm run desktop:build` produces
   `Toastmasters Tools Setup 1.10.0.exe`. **`npm test` (432/432) and `npm run typecheck` are
   confirmed clean; the `desktop:build` `.exe` sub-claim is blocked by this sandbox — see note
   below — so this item is left unchecked as a whole, consistent with how Phase 23 left its
   equivalent `.exe`-build item unchecked.**
4. [ ] **Manual (user):** with an existing plaintext `config.env` from a pre-1.10.0 install,
   launch the built `.exe` once, then inspect `config.env` and confirm the values are now
   `enc:v1:`-prefixed and the app still shows "Logged in"; log out and confirm the file no longer
   carries a usable session; log back in and confirm a fresh encrypted write.

> **Note:** Landed exactly as scoped — `CredentialCipher` in `apps/desktop/src/main/credentials.ts`
> wraps `safeStorage.encryptString`/`decryptString` behind the `enc:v1:<base64>` prefix;
> `upsertCredential` always encrypts on write (falling back to plaintext + a logged warning, never
> throwing, when `safeStorage.isEncryptionAvailable()` is false); `loadCredentials` decrypts
> `enc:v1:`-prefixed values and transparently self-upgrades any unprefixed legacy/hand-pasted
> plaintext value to encrypted on load, with no prompt. `index.ts`'s bootstrap moved the
> `loadCredentials()` call from module-eval time into the `app.whenReady()` callback — before the
> startup self-heal and the first `loadCore()` call — since `safeStorage` is only guaranteed ready
> after `whenReady()` on some platforms; `auth.ts` itself needed no change, since Phase 17's
> `logOut()` already goes through `upsertCredential` for its blank-out write, so it picks up
> encryption for free (verified by test, not by code change). The credentials-file template
> comment in `credentials.ts` was updated to describe the new encrypted-at-rest behaviour, and
> `USER_GUIDE.md` was brought current to `1.10.0` with a plain-language mention of the same (see
> `apps/desktop/USER_GUIDE.md`'s "Where your data is kept" section and a one-line note in "Log
> out" explaining the `enc:v1:` gibberish a user will now see if they open `config.env` by hand).
> Every workspace `package.json` (root, `packages/core`, `packages/ui`, `apps/desktop`) bumped to
> `1.10.0`. `npm test` is green at 432/432 (270 core + 162 desktop, including new
> `credentials.test.ts`/`auth.test.ts` coverage for the fresh-write round-trip, the
> plaintext-loads-then-self-upgrades path, the `isEncryptionAvailable() === false` plaintext
> fallback with logged warning, a decrypt-failure-treated-as-unset guard, and logout clearing both
> a legacy-plaintext-originated and newly-encrypted credential); `npm run typecheck
> --workspaces --if-present` is clean across `@toastmasters/core`, `@toastmasters/ui`, and
> `@toastmasters/desktop`; `npm run lint` and `npm run format:check` are both clean.
>
> **`npm run desktop:build` (item 3's `.exe` sub-claim) was not achievable in this sandbox** — same
> pre-existing, documented limitation as Phase 23 (see Phase 23's note above): it reaches
> `electron-builder`'s `@electron/rebuild` step for `better-sqlite3` and fails with `node-gyp does
> not support cross-compiling native modules from source`, because this Linux sandbox has no
> outbound access to github.com to fetch the win32-x64 prebuilt binary. Reproduced independently
> during this phase's own review with an identical stack trace, confirming it is not a new
> regression from the encryption change. `npm test`/`typecheck`/`lint`/`format` are confirmed
> genuinely green (see the note above); the `.exe` artifact itself is not — it needs `windows-2022`
> CI or a merge/`workflow_dispatch`-triggered `desktop:build` to confirm, same as every prior
> phase's native-module build step. Item 3 above is left unchecked as a whole rather than partially
> ticked, since the roadmap's own checkbox text bundles the test/typecheck confirmation and the
> `.exe`-build claim into one line.
>
> **Item 4 (manual verification) remains open** — requires a human with the real installed `.exe`,
> same as every prior user-facing phase's manual-validation item; this is the first real-world test
> of the plaintext→encrypted self-upgrade path since it depends on the OS-level `safeStorage`
> backend (DPAPI on Windows) that cannot be exercised in this sandbox.
>
> **Accepted residual risk, not fixed here:** the `enc:v1:` prefix is a plain string match, not a
> format-versioned envelope with a checksum — a legacy plaintext cookie value that happened to
> itself literally start with the seven characters `enc:v1:` would be misclassified as already
> encrypted and passed to `decryptString`, which would fail and (per the decrypt-failure guard
> above) be treated as unset rather than loaded. Toastmasters/Basecamp session cookies are
> effectively random tokens, so the odds of this collision are negligible, but it is a real,
> documented edge case rather than an impossibility — left unaddressed as out of this phase's scope.

---

## Phase 25 — Done (Dashboard UI/UX polish: data freshness, login-aware messaging, console placement, minor → 1.11.0)

> _Was **Phase 23** before the 2026-07-17 security-findings insertion: a repo security audit
> surfaced one HIGH (EOL Electron) and one MEDIUM (plaintext session-cookie storage) finding,
> discussed jointly with the software-architect and product-manager agents and inserted as
> **Phase 23** (Electron bump) and **Phase 24** (credential encryption) ahead of this phase, so the
> next UI work ships on a currently-supported, already-hardened runtime instead of needing
> re-verification after a later security bump. Version target re-sequenced `1.9.0` → `1.11.0` to
> stay monotonic behind the two inserted phases._

_A ui-ux-designer review of the shipped app (spec ∪ Phases 19–22) surfaced four real usability
gaps, cross-checked with product for cost/benefit against this tool's actual audience — one
non-technical VPE who opens it weekly/monthly, not a general user base. Three are accepted below;
a fourth (item 4, redundant triple status reporting during refresh) was an observation only, not
an ask — items 2–3 already remove most of the visual noise it described, so no separate work item
exists for it. Several other findings from the same review (invalid `role="button"` ARIA on table
rows, `ThemeToggle`'s 3-state discoverability, missing "Speech · date" in project rows, the
console's "Last refresh" text never clearing) were explicitly deferred/rejected — low or no benefit
for a single sighted user with no assistive-tech need, or already a deliberate, documented scope
cut (see Phase-25 planning notes, not re-litigated here). User-facing changes to the `.exe`, so
**minor bump → `1.11.0`.**_

- [x] **(item 1) Data-freshness indicator in the header.** Today `DashboardHeader` shows only
      `{N} members` — nothing tells the VPE whether they're looking at this month's snapshot or one
      from six months ago. Surface the **latest snapshot timestamp** (member/progress snapshot
      rows already carry a date; expose it through `packages/core/queries.ts` and the existing
      members IPC call — no new channel) next to the member count, e.g. `38 members · Updated 3
      days ago`. Render it in **amber** when the latest snapshot is older than a fixed threshold
      (21 days — roughly one reporting cycle; no settings UI, no per-member timestamps). On a
      fresh install with no snapshot yet, read cleanly as "Never refreshed" rather than a blank or
      broken date.
- [x] **(item 2) Login-aware refresh-error and empty-state copy.** `DashboardView.tsx`'s
      `reportRefreshError` currently shows the same "Your Toastmasters session has expired. Log
      out and log in again." for every `AUTH_ERROR`-shaped (401/403) failure — including a
      brand-new user who has never logged in, who is told to "log out" of a session they never
      had. The renderer already knows `authStatus` (it drives the header's "Logged in" / "Not
      logged in" badge). Branch the message on it: if not logged in, show "Log in to Toastmasters
      first, then Refresh" (no "Log in again" *action* button needed — action framing wrong for a
      first-time state, showing the same login control the header already has is enough). Apply
      the same branch to the empty-state card's copy (`DashboardView.tsx`, the "No data yet" card),
      which today tells a logged-out user to "use the Refresh buttons" that will only 401. The
      already-logged-in expired-session path is unchanged.
- [x] **(item 3) Refresh console below the header, collapsed by default when idle.** `App.tsx`
      currently mounts `RefreshConsole` *above* `DashboardView`/`MemberDetailView`, so raw scraper
      log lines render above the "Toastmasters Dashboard" title and header controls — inverted
      hierarchy for a non-technical user, and a visible seam from Phase 22 lifting the console to
      `App.tsx` for persistence without reconciling its placement. Move it to render as a sibling
      **below** the header/title (same `max-w-[960px] mx-auto` container both views already use —
      no change to that). Default it to a **slim collapsed bar** when no refresh is active,
      auto-expanding when a refresh starts (preserves Phase 22's "expanded while a refresh is
      active; otherwise leave what the user last set" behaviour — collapsed-when-idle is just the
      correct default for a console that's mostly empty history). The console's independent
      collapse state, Cancel button, and Copy Logs button are unchanged.

**Validation:**
1. [x] A unit/component test on the header asserts: the latest-snapshot date renders next to the
   member count; it switches to the amber treatment when the fixture snapshot date is older than
   21 days; a no-snapshot fixture renders "Never refreshed" instead of a blank/invalid date
   (item 1).
2. [x] A test on `reportRefreshError` (or the equivalent renderer handler) asserts: an
   `AUTH_ERROR`-shaped failure with `authStatus` showing logged-out renders the "Log in to
   Toastmasters first, then Refresh" copy, not the "session expired" text; the same failure with
   `authStatus` showing logged-in is unchanged from today. A second test/assertion covers the
   empty-state card's logged-out copy (item 2).
3. [x] `grep -n "RefreshConsole" apps/desktop/src/renderer/App.tsx` shows it mounted after the
   header/title in render order (or a component test asserts DOM order); a component test asserts
   the console renders collapsed when idle and expands when a refresh starts, and that navigating
   between views doesn't reset it (regression check on Phase 22's persistence) (item 3).
4. [ ] `npm test` green; `npm run typecheck` clean; `npm run desktop:build` produces
   `Toastmasters Tools Setup 1.11.0.exe`; `grep -h '"version"' package.json packages/*/package.json
   apps/*/package.json` — all read `1.11.0`. **`npm test` (447/447: 272 core + 175 desktop),
   `npm run typecheck --workspaces --if-present`, `npm run lint`, and `npm run format:check` are
   all confirmed clean; every workspace `package.json` reads `1.11.0`. The `desktop:build` `.exe`
   sub-claim is blocked by this sandbox — see note below — so this item is left unchecked as a
   whole, consistent with how Phases 23 and 24 left their equivalent `.exe`-build item unchecked.**
5. [ ] **Manual (user):** on a fresh/never-refreshed state the header reads "Never refreshed" and
   an unauthenticated Refresh shows the login-first message (not "session expired"); after a
   refresh, the header's "Updated …" text and the console's placement below the title both look
   right; the console starts collapsed on next launch and expands automatically when a refresh is
   triggered.

> **Note:** All three feature items are confirmed against the live repo, not just the developer's
> own report of them. `packages/core/helpers/db.ts`'s `getLatestSnapshotAt` and
> `queries.ts`'s `listMembers` (now returning `{ members, latestSnapshotAt }` via the new
> `ListMembersResult` type) were read line-by-line: a true fresh install (both
> `progress_snapshots`/`membership_snapshots` never populated) returns `ok:true` with an empty
> member list and `latestSnapshotAt: null`; a partial capture (only one table ever populated)
> still returns `SNAPSHOT_MISSING`, matching item 1's spec exactly — this is pinned down by two
> dedicated `queries.test.ts` cases (one per branch) plus a "threads the value straight through"
> test that would catch a hardcoded/dropped field. `DashboardHeader`'s `FreshnessNote` renders
> "Never refreshed" / "Updated today" / "Updated 1 day ago" / "Updated N days ago" next to the
> member count exactly as item 1's `38 members · Updated 3 days ago` example specifies, and goes
> amber on `days > 21` (confirmed **strictly** greater-than, not `>=`, by a same-day negative
> control at exactly 21 days in `DashboardHeader.test.tsx`). `DashboardView.tsx`'s
> `reportRefreshError` and the "No data yet" empty-state card both now branch on
> `authStatus.basecamp || authStatus.ti`: logged-out shows "Log in to Toastmasters first, then
> Refresh." (and the empty-state equivalent) with no action button, while the already-logged-in
> "session expired" path — copy, "Log in again" action, and behaviour — is byte-for-byte
> unchanged, each confirmed by its own passing test plus a negative control asserting the other
> copy is absent. `App.tsx` now mounts `RefreshConsole` textually *after* the
> `DashboardView`/`MemberDetailView` switch (confirmed by `grep -n "RefreshConsole"
> apps/desktop/src/renderer/App.tsx`, and by a new DOM-order assertion in `App.test.tsx` comparing
> string indices of "Toastmasters Dashboard" vs. the console's "Last refresh" marker text), and
> `consoleCollapsed` now defaults to `true` — a dedicated test confirms a log line arriving with no
> refresh active does **not** show its content until the console's own toggle is clicked (a
> negative control that would fail against the pre-Phase-25 default), while a second test confirms
> a refresh still auto-expands it with no manual click, and the existing Phase 22
> survives-navigation test was updated (an extra toggle click) rather than deleted, so that
> regression coverage is intact. `npm test` was re-run independently during this cross-check and
> reproduced the claimed 447/447 (272 core + 175 desktop), and `npm run typecheck
> --workspaces --if-present`, `npm run lint`, and `npm run format:check` were all independently
> re-run clean. Every workspace `package.json` (root, `packages/core`, `packages/ui`,
> `apps/desktop`) reads `1.11.0`.
>
> **`npm run desktop:build` (validation item 4's `.exe` sub-claim) was not achievable in this
> sandbox** — independently reproduced during this cross-check: it reaches `electron-builder`'s
> `@electron/rebuild` step for `better-sqlite3` and fails with `node-gyp does not support
> cross-compiling native modules from source`, because this Linux sandbox has no outbound access
> to github.com to fetch the win32-x64 prebuilt binary — the same pre-existing limitation
> confirmed identically in Phases 23 and 24, not a Phase 25 regression. It needs `windows-2022` CI
> or a merge/`workflow_dispatch`-triggered `desktop:build` to confirm.
>
> **Validation item 5 (manual verification) remains open** — requires a human with the real
> installed `.exe`, same as every prior user-facing phase's manual-validation item.
>
> **Minor discrepancy noted during cross-check (not blocking, not a violation of the item-1
> spec as written):** on a *partial*-capture `SNAPSHOT_MISSING` (one snapshot table has data, the
> other has never been populated — e.g. a user who only ever ran "Refresh Progress" and never
> "Refresh Membership"), `DashboardView.tsx`'s catch block unconditionally sets
> `latestSnapshotAt` to `null`, so the header reads "Never refreshed" even though one table does
> in fact hold a real snapshot timestamp. Item 1's spec and its validation only require the header
> to distinguish a *true* fresh install ("Never refreshed") from a populated one ("Updated N days
> ago") — it says nothing about this rarer partial-capture edge case — so this is not a spec
> violation, and the same case already rendered the identical "No data yet" card with no error
> banner *before* this phase (Phase 25 adds no new incorrectness here, it just means the new
> freshness note inherits the same blind spot). Left unaddressed as out of this phase's scope; a
> future phase could thread `getLatestSnapshotAt`'s real value through even on the
> `SNAPSHOT_MISSING` path if this edge case turns out to matter in practice.

> **Deferred from the same design review (not part of this phase):** invalid `role="button"` ARIA
> on `MemberTable` rows (no assistive-tech user on this single-seat tool — fix opportunistically
> only if that code is touched for another reason); `ThemeToggle`'s icon-only light/dark/system
> cycle (revisit only if the VPE reports trouble finding "system"); "Speech · date" in project rows
> (the data model doesn't carry it — a deliberate Phase-4-era scope cut, not a regression); the
> console's "Last refresh" label never clearing (cosmetic, not worth a state machine for one user).
