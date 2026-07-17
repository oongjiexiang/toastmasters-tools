# Tech Stack

> **Superseded (partial) — the web app was removed in Phase 14; components now live in
> `packages/ui`.** This document tracks the stack's evolution phase by phase, so most of it is
> still accurate — Layers 0–2, 5, and 7 describe the current shipped architecture. **Layer 3**
> (local web UI) and **Layer 4** (Next.js frontend) describe the `apps/web` app, and **Layer 6**
> describes its Playwright E2E suite — all three were deleted in Phase 14. The React/shadcn
> component decisions they document still hold: those components were extracted verbatim into
> `packages/ui` (`@toastmasters/ui`) and are now consumed by `apps/desktop`'s renderer (Layer 7)
> instead of by Next.js. See `specs/roadmap.md` Phase 14 for the removal and extraction.

## Current (baseline)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (ESM) | Type safety for heterogeneous API/CSV shapes |
| Runtime | Node.js v18+ via `tsx` | Zero-compile dev loop; familiar ecosystem |
| CSV I/O | `csv-parse` / `csv-stringify` | Robust RFC 4180 handling without a DB dependency |
| Auth | Browser session cookies (manual) | Only viable method; both portals lack public OAuth |
| Packaging | Electron `.exe` (Phase 11) for the end user; `npm run desktop:dev` for development | The VPE double-clicks an installer; developers run the workspace scripts from the repo root |
| Output | Flat CSV files in `results/` | Opens directly in Google Sheets / Excel |

## Target Architecture

The stack evolves in layers. Each is independently useful and can be added in phases without breaking the one before it.

### Layer 0 — Monorepo (Phase 10, done)

The repo is **npm workspaces**: `workspaces: ["apps/*", "packages/*"]` in a private root
`package.json` that holds no source and delegates every script into a workspace.

| Workspace | Package | Role |
|---|---|---|
| `packages/core` | `@toastmasters/core` | Framework-agnostic shared logic: SQLite (`helpers/db.ts`), scrapers (`services/{fetch,membership}.ts`), pathway rules (`helpers/pathway.ts`), config, types, and the interactive CLI. No build step — runs under `tsx` (originally also Next.js-transpiled via `transpilePackages`; now `electron-vite`-bundled for `apps/desktop`). |
| `apps/web` _(removed, Phase 14)_ | `@toastmasters/web` | Next.js dashboard (Layer 4). Imports core; owns its own `tsconfig`, `vitest.config.ts`, `playwright.config.ts`. Deleted in Phase 14 — its components live in `packages/ui` now. |
| `packages/ui` _(added, Phase 14)_ | `@toastmasters/ui` | Shared React/shadcn components extracted from `apps/web` before deletion; consumed by `apps/desktop`'s renderer. |
| `apps/desktop` | `@toastmasters/desktop` (Phase 11) | Electron app (Layer 7) — now the sole shipped app. Imports core from the main process and `packages/ui` in the renderer. |

Core is consumed through explicit `exports` subpaths (`@toastmasters/core/db`, `/pathway`,
`/api`, `/files`, `/config`, `/paths`, `/types`, `/fetch`, `/membership`) — not deep
relative imports — so its public surface is a deliberate contract rather than an accident of
file layout.

**Path resolution is anchored, not cwd-relative.** npm workspace scripts run with the cwd set to
the _workspace_ directory (`npm run fetch` → `packages/core`, `npm run dev` → `apps/web`), so any
path derived from `process.cwd()` resolves differently per entry point — which would give the CLI
and the dashboard two different SQLite databases. `packages/core/paths.ts` (exported as
`@toastmasters/core/paths`) resolves `REPO_ROOT` by walking up from `import.meta.url` to the
`package.json` that declares `workspaces`, and derives `ENV_FILE` (`<repo>/.env`) and `DATA_DIR`
(`<repo>/results`) from it. `config.ts` and `helpers/db.ts` consume those anchors, so
`RESULTS_DIR` and `DEFAULT_DB_PATH` are absolute regardless of cwd. `TOASTMASTERS_DATA_DIR`
(absolute) overrides `DATA_DIR` — that is the hook Phase 11's Electron main process uses to point
data at `app.getPath('userData')`, where there is no repo and cwd is arbitrary.

**The load-bearing invariant:** core must never import `next` or `react`. That is what allows
`apps/desktop` to run the exact same scraping and SQLite code in an Electron main process with no
fork and no rewrite. It is enforced by `packages/core/tests/workspace.test.ts` (which also asserts
that every core subpath resolves and that no source file uses the dead pre-monorepo `@/` aliases),
so the precondition for Phase 11 cannot silently rot.

### Layer 1 — CLI (keep as-is)

The CLI remains the primary entry point. All automation, scheduling, and UI layers are built on top of it, not instead of it.

### Layer 2 — Local database (SQLite)

Add a SQLite file (`results/db.sqlite`) to persist snapshots after each run:

- Avoid redundant API calls: skip re-fetching members whose data hasn't changed.
- Enable historical queries: "who advanced last month?", "who has stalled for 60 days?"
- Power the web UI without re-parsing CSVs.

Likely driver: `better-sqlite3` (synchronous, zero native deps on Node 18+).

### Layer 3 — Local web UI (Phase 2, done; superseded — see banner above)

A local HTTP server (Node's built-in `http`) reads from SQLite and serves the dashboard on
`localhost` only. In Phase 4 this is replaced by Next.js API routes + React pages.

### Layer 4 — Next.js frontend (Phase 4; superseded, removed Phase 14 — see banner above)

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router) | Full-stack: API routes replace the custom Node HTTP server; one `next dev` command; no separate `web/` subfolder or proxy |
| UI library | React 19 (bundled with Next.js) | Component model for accordion/detail views |
| Styling | Tailwind CSS | Required by shadcn; utility-first keeps CSS local to components |
| Components | shadcn/ui (Radix + Tailwind) | Accessible primitives (Accordion, Table, Badge) copied into `components/ui/` — no runtime lock-in. See ADR `architecture-react.md` |
| Data fetching | Next.js API routes + `fetch` in React | Server-side: `better-sqlite3` in API routes; client-side: typed `fetch` wrappers |

shadcn/ui is **not an npm package** — its CLI copies component source into `components/ui/`,
so we own and can edit every component. The Next.js App Router is the primary shadcn target.

**Why Next.js over Vite + Node HTTP (prior decision):** eliminates the `web/` subfolder and
separate `package.json`; API routes replace the hand-rolled Node server; one `npm run dev`
command instead of two processes. See ADR for full comparison.

### Layer 5 — Unit testing (Phase 5)

| Concern | Choice | Why |
|---|---|---|
| Test runner | **Vitest** | Native ESM + TS (matches our `tsx` setup), Vite-aligned, Jest-compatible API |
| Coverage | `@vitest/coverage-v8` | Built-in, no extra config |
| Scope | `helpers/` pure logic + API endpoint mappers | Highest value, lowest mocking cost |

**Component testing (`apps/desktop`, Phase 19).** `apps/desktop/vitest.config.ts`'s global
`test.environment` stays `"node"` — the existing main-process/pure-function tests have no DOM —
but it now also carries the `@vitejs/plugin-react` plugin, a `resolve.alias` for `@` →
`packages/ui` (mirroring `electron.vite.config.ts`'s renderer alias), and a
`setupFiles: ["./vitest.setup.ts"]` entry (`@testing-library/jest-dom` matchers, RTL's
`afterEach(cleanup)`, and a `window.matchMedia` polyfill that `next-themes`' `useTheme()` needs
under jsdom). Individual component-test files opt into a DOM per-file with a
`// @vitest-environment jsdom` docblock rather than flipping the suite-wide default. This
required pinning `jsdom` to `24.1.0` (root `overrides` + `apps/desktop`'s own devDependency)
because this environment's Node 20 can't load newer `jsdom`'s ESM-only transitive deps. First
consumers: `apps/desktop/tests/MemberTable.test.tsx`, `LevelAccordion.test.tsx`, and
`ThemeToggle.test.tsx` — `packages/ui` itself still ships no test suite of its own (Phase 14);
its components are rendered and exercised from `apps/desktop/tests/`.

### Layer 6 — E2E browser testing (Phase 9; superseded, removed Phase 14 — see banner above)

| Concern | Choice | Why |
|---|---|---|
| E2E runner | **Playwright** | Runs against real Chromium; `@playwright/test` integrates with Next.js `webServer` config to start/stop `next dev` automatically |
| Scope | UI behaviour — button visibility, spinner state, Sonner toasts, data reload after refresh | Cannot be verified by Vitest (jsdom ignores CSS, Sonner toasts are portals outside the component tree, network timing is not realistic) |
| Test location | `tests/e2e/` | Separate from Vitest unit tests; run via `npx playwright test` |

Playwright is chosen over Cypress for its first-class TypeScript support, lower overhead, and
tighter Next.js integration. React Testing Library is not sufficient for this layer because
jsdom cannot assert real CSS visibility or observe Sonner toast portals.

### Layer 7 — Desktop app (Phase 11)

_The VPE does not want to install Docker or run a Node dev server. Ship a double-clickable
Windows `.exe` instead._

| Concern | Choice | Why |
|---|---|---|
| Shell | **Electron** | Bundles Node.js, so `@toastmasters/core` (SQLite + scrapers) and `better-sqlite3`'s native module run **unchanged** in the main process — no rewrite |
| Build tool | **electron-vite** | Modern Vite-based Electron tooling: hot reload in dev, clean main/preload/renderer build split |
| UI | React (reused from `apps/web`, later extracted to `packages/ui` in Phase 14) | The existing `MemberTable` / `LevelAccordion` / refresh-header components port directly; only the data layer changes from `fetch("/api/…")` to IPC |
| Main ↔ renderer | IPC via `contextBridge` preload | Typed, sandboxed bridge; `nodeIntegration` stays off. Main process owns SQLite + scraping |
| Packaging | **electron-builder** (NSIS target) | One-command Windows installer `.exe`; user double-clicks, no terminal |
| Auth (Phase 12) | **In-app login** — user signs in on the genuine Toastmasters pages in an embedded window; the main process harvests the session cookies from a persistent Electron partition (`persist:toastmasters`) | The scrapers authenticate by a `Cookie` header; the main process's `session.cookies.get()` can read those cookies — including httpOnly auth cookies — with no manual copy. Manual `config.env` paste stays as a fallback |
| Credential storage (Phase 24) | **Encrypted at rest** — `config.env` values are wrapped with Electron's `safeStorage.encryptString`/`decryptString` (OS-level encryption, DPAPI on Windows), base64-encoded and tagged `enc:v1:<base64>`; falls back to plaintext + a logged warning, never a hard failure, when `safeStorage.isEncryptionAvailable()` is false | Closes the one plaintext-at-rest outlier: the `persist:toastmasters` Chromium cookie jar was already OS-encrypted, but `config.env` — a durable copy of the same unauthenticated bearer tokens — was not |

**Authentication (Phase 12).** The desktop app replaces cookie-pasting with an in-app login: the
user authenticates on the real HTTPS Toastmasters pages inside a sandboxed `BrowserWindow`
(no preload, no IPC bridge), and the main process harvests `BASECAMP_SESSIONID` +
`TI_COOKIE` from its persistent session partition (`persist:toastmasters`), writing them to both
`process.env` (live) and `config.env` (durable). The persistent partition and a startup
self-heal keep the login across restarts; the manual **Open Credentials File…** paste remains as
a fallback. This depends on core reading its cookies **dynamically** — `getSessionId()` /
`getTiCookie()` in `packages/core/config.ts` read `process.env` at request time — so a login
applied after core is imported takes effect on the next refresh with no restart. Browser
cross-origin cookie isolation makes in-app login Electron-only; the CLI (and the desktop app's
own fallback) still use the manual paste. (`apps/web`, which also kept the manual paste, was
removed in Phase 14.)

**Credential storage (Phase 24).** `config.env` values are encrypted at rest, not stored as
plaintext `KEY=value` lines. `CredentialCipher` (`apps/desktop/src/main/credentials.ts`) wraps
each value with `safeStorage.encryptString`, base64-encodes it, and tags it `enc:v1:<base64>` so
`loadCredentials` can tell an encrypted value from legacy plaintext without attempting a decrypt
first. `upsertCredential` always encrypts on write; `loadCredentials` decrypts `enc:v1:` values
and transparently rewrites any unprefixed plaintext value (a pre-Phase-24 `config.env`, or a
fresh hand-paste via **Open Credentials File…**) as encrypted the next time it loads, with no
prompt. When `safeStorage.isEncryptionAvailable()` is false (e.g. a Linux box with no keyring),
writes fall back to plaintext with a logged warning rather than failing — a locked-out user is
worse than a plaintext credential. `index.ts`'s bootstrap loads credentials inside the
`app.whenReady()` callback rather than at module-eval time, since `safeStorage` is only
guaranteed ready after `whenReady()` on some platforms.

**Logout (Phase 17).** Because `config.env` is only ever a durable *copy* of whatever cookies
`persist:toastmasters` holds — never the source of truth — a real logout has to clear the
partition itself, not just blank the two lines in `config.env` (that alone is cosmetic: the
startup self-heal re-harvests from the still-live partition on the very next launch and silently
rewrites them back in). `logOut()` (`apps/desktop/src/main/auth.ts`) clears the partition's cookies
scoped to the Basecamp and TI origins individually — never the whole partition — then clears
`process.env` and blanks `config.env` to match. Since Phase 24, that blank write goes through the
same `upsertCredential`/`CredentialCipher` path as any other write, so the on-disk line is an
`enc:v1:` value that _decrypts_ to an empty string, not a literal `KEY=` blank — `loadCredentials`
still treats either form as unset.

**Theming (Phase 19).** The app has a real light/dark/system toggle, not a forced light theme.
`packages/ui/components/providers.tsx` sets `<ThemeProvider attribute="class"
defaultTheme="system" enableSystem>` (a prior `forcedTheme="light"` pinned the app to light and
made theme changes a no-op — removed once every hardcoded status-colour class in `MemberTable`,
`LevelAccordion`, `ProjectRow`, and `MemberDetailView` gained a paired `dark:` variant, so dark
mode wouldn't ship with unreadable badges). A header `ThemeToggle`
(`packages/ui/components/ThemeToggle.tsx`) cycles light → dark → system through `next-themes`'
`useTheme()`, filled into a new optional `themeControl` slot on `DashboardHeader` — the same
slot pattern Phase 12's `authControl` established. `next-themes` persists the choice to
`localStorage` in Electron's default (persistent) session partition, so it survives app
restarts. A synchronous inline script in `apps/desktop/src/renderer/index.html`'s `<head>` reads
that same `localStorage` key before `<div id="root">` paints, applying the `.dark` class early
to avoid a flash of the wrong theme; it wraps the read in `try`/`catch` so a `localStorage`
access failure (e.g. a restrictive session partition) falls back silently to `next-themes`' own
mount-time effect instead of throwing. Sonner toasts already read `useTheme()`
(`packages/ui/components/ui/sonner.tsx`), so they follow the theme with no extra code.

**Supersedes Docker (Phase 0 baseline), retired in Phase 10.** Docker solved "run this without a
global Node install" for a developer; the `.exe` solves it for the actual end user, and does so
without a terminal. See `roadmap.md` Phase 10 for the removal rationale.

**Why Electron over the alternatives:**

- **Tauri** — a Rust backend would force rewriting all Node.js scraping + `better-sqlite3`
  integration. The smaller binary isn't worth that cost for one-user personal tooling.
- **Neutralino.js** — smaller ecosystem and awkward native-module (`better-sqlite3`) support.
- **Bundling Next.js inside Electron** — Next.js SSR assumes a server runtime; heavier and
  more moving parts than a plain Vite React renderer for a local desktop app.

**Monorepo prerequisite (Phase 10):** the repo becomes npm workspaces with `packages/core`
(shared SQLite + scraping + pathway logic) consumed by both `apps/web` (Next.js) and
`apps/desktop` (Electron). Neither app forks the core logic. (`apps/web` was later removed in
Phase 14, leaving `apps/desktop` as the sole consumer alongside the new `packages/ui`.)

### Layer 8 — Repo-wide tooling: lint, format, strict typing, logging (Phase 21)

_A behaviour-preserving production-grade pass over the repo Phase 14 collapsed to a single app
plus shared packages: enforced lint/format, a stricter shared `tsconfig`, and a small structured
logger in place of scattered `console.log`/`console.error` calls._

| Concern | Choice | Why |
|---|---|---|
| Linting | **ESLint 9 flat config** (`eslint.config.js`, root) via `typescript-eslint` | One config for every workspace (`packages/core`, `packages/ui`, `apps/desktop`) — no per-workspace duplication. Type-aware linting (`recommendedTypeChecked`) for each workspace's real source via `projectService`, resolving against that workspace's own `tsconfig.json`; plain syntactic linting for tests/configs that sit outside every tsconfig's `include` |
| React rules | `eslint-plugin-react-hooks` (only `rules-of-hooks` + `exhaustive-deps`) | Deliberately not the full v7 "React Compiler readiness" ruleset, which would flag this codebase's long-standing "fetch on mount" effects — adopting it is separate, out-of-scope work |
| Formatting | **Prettier 3** (`.prettierrc.json`, `.prettierignore`) + `eslint-config-prettier` | `eslint-config-prettier` is applied last so ESLint owns correctness and Prettier owns formatting, with no rule conflicts |
| Scripts | `npm run lint`, `npm run format`, `npm run format:check` (root `package.json`) | `lint` is also chained onto the root `test` script (`npm run test -w core && npm run test -w desktop && npm run lint`) and wired into CI, so a lint regression fails the same gate as a test regression |
| Strict TypeScript | Shared `tsconfig.base.json` (repo root) — `strict: true` plus **`noUncheckedIndexedAccess`** and **`noImplicitOverride`** | `packages/core/tsconfig.json`, `apps/desktop/tsconfig.json`, and the **new** `packages/ui/tsconfig.json` (it had none before this phase) all `extend` it, so the stricter flags apply repo-wide from one place. `packages/ui` also gained a `typecheck` script, matching the pattern already used by `packages/core` and `apps/desktop` |
| Logging | Two small, deliberately-separate structured loggers: `packages/core/logger.ts` and `apps/desktop/src/main/logger.ts` | Both expose the same `debug`/`info`/`warn`/`error` shape with an optional structured `context` object, routing to the matching `console.*` method. Kept as **two** modules, not one shared import, because every file under `apps/desktop/src/main` except `core.ts` must never statically import `@toastmasters/core` — `apps/desktop/tests/main-bundle.test.ts` enforces this on the built bundle, since a static import would evaluate core's env-derived consts before Electron's bootstrap sets `TOASTMASTERS_DATA_DIR` |
| Module boundaries | New "packages/ui stays desktop-agnostic" guard in `packages/core/tests/workspace.test.ts` | Mirrors the pre-existing "core stays framework-agnostic" guard: asserts no file under `packages/ui/components`/`packages/ui/lib` imports `electron` or reaches into `apps/desktop`. Has a genuine negative control, `packages/core/tests/fixtures/ui-boundary-offender.tsx` (never imported by real code, `.tsx` so `tsc` never compiles it, scanned only as text), proving the guard fails closed |
| HTTP errors | `HttpError extends Error` (`packages/core/helpers/api.ts`), with a `.status` field | Reused by `services/membership.ts`; its `.message` text is byte-identical to the old inline error string, so `apps/desktop/src/renderer/views/DashboardView.tsx`'s `/HTTP 40[13]/` auth-failure-detection regex still matches unchanged |

**What this phase deliberately left alone:** the `ProgressReporter` callback seam
(`packages/core/services/fetch.ts`, `services/membership.ts`, `helpers/api.ts`) — that is
user-facing CLI/IPC _output_ whose exact shape earlier phases' tests assert, not diagnostic
logging, and it still defaults to `console.log`. A repo-wide grep for `TODO`/`FIXME`/`@deprecated`
came back empty, so no dead code was found or removed beyond what Phases 6/10/14 already cleaned
up.

## Constraints

- **No cloud dependencies** for runtime. Credentials are local; data never leaves the machine.
- **CLI stays build-free.** `tsx` runs the Node code directly. The build step is scoped to the
  React renderer (`apps/desktop`, via `electron-vite`) only — the CLI never requires a bundler.
- **`packages/core` imports no framework.** No `next`, no `react`. Enforced by
  `packages/core/tests/workspace.test.ts`.
- **shadcn components are vendored source**, committed to the repo and edited in place.
- **The end-user entry point is the packaged desktop app.** Any packaging path not covered by a
  roadmap **Validation** step is not supported.
