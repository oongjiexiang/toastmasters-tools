# Tech Stack

## Current (baseline)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (ESM) | Type safety for heterogeneous API/CSV shapes |
| Runtime | Node.js v18+ via `tsx` | Zero-compile dev loop; familiar ecosystem |
| CSV I/O | `csv-parse` / `csv-stringify` | Robust RFC 4180 handling without a DB dependency |
| Auth | Browser session cookies (manual) | Only viable method; both portals lack public OAuth |
| Packaging | Docker | Reproducible environment without a global Node install |
| Output | Flat CSV files in `results/` | Opens directly in Google Sheets / Excel |

## Target Architecture

The stack evolves in three layers. Each is independently useful and can be added in phases without breaking the one before it.

### Layer 1 — CLI (keep as-is)

The CLI remains the primary entry point. All automation, scheduling, and UI layers are built on top of it, not instead of it.

### Layer 2 — Local database (SQLite)

Add a SQLite file (`results/db.sqlite`) to persist snapshots after each run:

- Avoid redundant API calls: skip re-fetching members whose data hasn't changed.
- Enable historical queries: "who advanced last month?", "who has stalled for 60 days?"
- Power the web UI without re-parsing CSVs.

Likely driver: `better-sqlite3` (synchronous, zero native deps on Node 18+).

### Layer 3 — Local web UI (Phase 2, done)

A local HTTP server (Node's built-in `http`) reads from SQLite and serves the dashboard on
`localhost` only. In Phase 4 this is replaced by Next.js API routes + React pages.

### Layer 4 — Next.js frontend (Phase 4)

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

### Layer 6 — E2E browser testing (Phase 9)

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
| UI | React (reused from `apps/web`) | The existing `MemberTable` / `LevelAccordion` / refresh-header components port directly; only the data layer changes from `fetch("/api/…")` to IPC |
| Main ↔ renderer | IPC via `contextBridge` preload | Typed, sandboxed bridge; `nodeIntegration` stays off. Main process owns SQLite + scraping |
| Packaging | **electron-builder** (NSIS target) | One-command Windows installer `.exe`; user double-clicks, no terminal |

**Why Electron over the alternatives:**

- **Tauri** — a Rust backend would force rewriting all Node.js scraping + `better-sqlite3`
  integration. The smaller binary isn't worth that cost for one-user personal tooling.
- **Neutralino.js** — smaller ecosystem and awkward native-module (`better-sqlite3`) support.
- **Bundling Next.js inside Electron** — Next.js SSR assumes a server runtime; heavier and
  more moving parts than a plain Vite React renderer for a local desktop app.

**Monorepo prerequisite (Phase 10):** the repo becomes npm workspaces with `packages/core`
(shared SQLite + scraping + pathway logic) consumed by both `apps/web` (Next.js) and
`apps/desktop` (Electron). Neither app forks the core logic.

## Constraints

- **No cloud dependencies** for runtime. Credentials are local; data never leaves the machine.
- **CLI stays build-free.** `tsx` runs the Node code directly. The build step is scoped to the
  React app (`web/`) only — `npm start` and the CLI never require a bundler.
- **shadcn components are vendored source**, committed to the repo and edited in place.
- **Docker remains optional** but must continue to work after each layer is added.
