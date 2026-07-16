# Toastmasters Tools

[![CI](https://github.com/oongjiexiang/toastmasters-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/oongjiexiang/toastmasters-tools/actions/workflows/ci.yml)

Personal VPE tooling for one Toastmasters club. Scrapes Basecamp (pathway progress) and toastmasters.org (membership roster), stores snapshots in SQLite, and ships as a double-clickable Windows desktop app (see [Desktop app](#desktop-app)) for weekly/monthly reporting.

> **Contributing:** every feature/phase lands on its own branch and reaches `main` only
> through a reviewed PR gated on CI — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Prerequisites

- [Node.js](https://nodejs.org/) v20 LTS or later (matches CI)
- An active Toastmasters officer account with access to both Basecamp and toastmasters.org

## Installation

Run from the repository root — this is an npm workspaces monorepo, and a single install covers
every workspace:

```bash
npm install
```

## Environment setup

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### Getting `BASECAMP_SESSIONID`

1. Log in to [basecamp.toastmasters.org](https://basecamp.toastmasters.org)
2. Open DevTools (`F12`) → **Application** → **Cookies** → `basecamp.toastmasters.org`
3. Copy the value of the `sessionid` cookie
4. Add it to `.env` as `BASECAMP_SESSIONID=<value>`

### Getting `TI_COOKIE`

1. Log in to [www.toastmasters.org](https://www.toastmasters.org)
2. Open DevTools (`F12`) → **Application** → **Cookies** → `www.toastmasters.org`
3. Copy all cookies as a single semicolon-separated string (e.g. `cookie1=val1; cookie2=val2; ...`)
4. Add it to `.env` as `TI_COOKIE=<value>`

Both cookies expire with your browser session — you will need to refresh them periodically.

> **Desktop app:** the [desktop app](#desktop-app) obtains these cookies automatically — click
> **Log in** and sign in on the embedded Toastmasters pages, and it harvests
> `BASECAMP_SESSIONID` / `TI_COOKIE` for you (writing them to its own `config.env`).
> The DevTools method above is still the way to supply cookies for the CLI, or as the desktop
> app's manual fallback (**Open Credentials File…**).

## Typical workflow

```bash
# 1. Fetch latest data (run both before opening the dashboard)
npm run fetch       # Scrape Basecamp → SQLite
npm run membership  # Scrape TI membership roster → SQLite

# 2. Open the dashboard
npm run desktop:dev # Electron app with hot reload — see Desktop app below
```

Or use the interactive CLI launcher to run fetch and membership in sequence:

```bash
npm run cli
```

## Commands

All commands are run from the repository root.

| Command | Workspace | Description |
|---|---|---|
| `npm run fetch` | core | Scrape Basecamp progress for all members and snapshot to SQLite |
| `npm run membership` | core | Download TI membership roster and snapshot to SQLite |
| `npm run cli` | core | Interactive launcher — choose which scripts to run |
| `npm run desktop:dev` | desktop | Run the Electron desktop app with hot reload |
| `npm run desktop:build` | desktop | Build the Windows installer (`apps/desktop/release/*.exe`) |
| `npm test` | core + desktop | Run the full unit/IPC/bundle test suite (core → desktop) |

Workspace-only scripts (coverage, watch mode) are run with `-w`:

```bash
npm run test:coverage -w @toastmasters/core
```

## Dashboard

Open it via the [desktop app](#desktop-app) (`npm run desktop:dev`, or the installed `.exe`).

The dashboard reads from the SQLite database written by `fetch` and `membership`. Run those first — the dashboard shows a banner if no snapshot is found.

### Member table

Lists all active (paid) members with:
- Pathway name and current title (e.g. `PM3`)
- Next level to complete
- Number of remaining projects in that level
- Status badge: **Completed**, **Ready** (level done, awaiting approval), **Close** (1 project left), **In Progress**, or **Not Started**

Click any member row to open the detail view.

### Member detail view

Shows all six level groups (Level 1–5 + Path Completion) in expand/collapse accordions, each with:
- Per-level completion badge (e.g. `3 / 4` or `Complete`)
- Every project in that level — Core or Elective, marked Done or Pending

Expand all / Collapse all controls at the top.

### Diff view

Shows what changed between the two most recent snapshots: who advanced a level, who joined, who left, and membership status changes.

### Membership file download

Downloads the raw membership CSV from toastmasters.org that was last fetched.

## Desktop app

A double-clickable Windows app (`apps/desktop`, Electron) that bundles Node, the scrapers,
SQLite, and the dashboard into one native app — no terminal, no local dev server. It reuses
the same `@toastmasters/core` scraping/SQLite logic and the shared React components in
`packages/ui` (`@toastmasters/ui`), talking to the main process over IPC instead of HTTP.

- **Download:** grab `Toastmasters Tools Setup <version>.exe` from the repo's
  [Releases](https://github.com/oongjiexiang/toastmasters-tools/releases) page — CI builds and
  publishes it automatically on each version tag (see [CI/CD](#cicd)). Or build it yourself:

  ```bash
  npm run desktop:dev     # run with hot reload
  npm run desktop:build   # produce the NSIS installer in apps/desktop/release/
  ```

- **Log in, no cookie pasting:** click **Log in** and sign in on the embedded Toastmasters
  pages — the app harvests your `BASECAMP_SESSIONID` / `TI_COOKIE` session cookies itself (into
  its own `config.env`), and stays logged in across restarts until the session expires. A full
  end-user walkthrough is in [`apps/desktop/USER_GUIDE.md`](apps/desktop/USER_GUIDE.md).
- The SQLite database and credentials live in Electron's user-data directory (via the
  `TOASTMASTERS_DATA_DIR` anchor described under [Data storage](#data-storage)), not in the repo.

## CI/CD

GitHub Actions (`.github/workflows/`) keep `main` releasable:

- **`ci.yml`** runs the full test suite (`npm test` — core + desktop) on every branch push and
  PR into `main`. It needs no Toastmasters cookies — the tests mock the network.
- **`release.yml`** builds the Windows installer on `windows-2022` when you push a **version
  tag** (e.g. `1.0`), push/merge to **`main`**, or trigger it manually. On a version tag it
  creates a stable **GitHub Release** with the `.exe` attached. On a push to `main` it instead
  publishes/refreshes a single **rolling pre-release** (tag `latest-main`) with the `.exe`
  attached, so there's always one obvious download link for the newest build between version
  tags — see [`CONTRIBUTING.md`](CONTRIBUTING.md). A manual `workflow_dispatch` run just
  uploads the installer as a workflow artifact, without publishing a Release.

## Title logic

| Title | Meaning |
|---|---|
| `DTM` | Member holds a DTM credential in the membership roster |
| `PM5`, `DL3`, … | Pathway initials + highest approved level |
| *(blank)* | No levels approved yet |

Members with `UnpaidMember` status are excluded from all views.

## Data storage

All data lives in a SQLite database at `results/db.sqlite`, at the **repository root**. The only
other file written to `results/` is the membership CSV downloaded by `npm run membership` (kept
for the download endpoint in the dashboard). `.env` also lives at the repository root — one file
for the whole monorepo.

Both locations are resolved from a **repo-root anchor**, not from the working directory of the
running process. This matters because npm workspace scripts run with the cwd set to their own
workspace: `npm run fetch` runs in `packages/core/`, `npm run desktop:dev` runs in
`apps/desktop/`. They still read and write the same `<repo>/results/db.sqlite` and the same
`<repo>/.env`. The anchor lives in `packages/core/paths.ts` (`REPO_ROOT`, `DATA_DIR`, `ENV_FILE`).

To store data somewhere else, set `TOASTMASTERS_DATA_DIR` to an absolute path:

```bash
TOASTMASTERS_DATA_DIR=/absolute/path/to/data npm run fetch
```

The database and membership CSVs then live there instead of `<repo>/results/`; `.env` stays at
the repo root. This override is how the [desktop app](#desktop-app) points its data at
Electron's `app.getPath('userData')`.

## Project structure

The repo is an **npm workspaces** monorepo: a single Electron app (`apps/desktop`) plus two
shared packages (`packages/core`, `packages/ui`). Every command below is still run from the
repository root — the root `package.json` delegates to the right workspace.

```text
├── package.json              # Workspace root — delegates all scripts (private, no source)
│
├── packages/
│   ├── core/                 # @toastmasters/core — framework-agnostic shared logic
│   │   ├── index.ts          # Interactive CLI launcher (npm run cli)
│   │   ├── paths.ts          # Repo-root anchor: REPO_ROOT, DATA_DIR, ENV_FILE, .env loading
│   │   ├── config.ts         # Environment variables and shared constants
│   │   ├── types.ts          # TypeScript type definitions
│   │   ├── services/
│   │   │   ├── fetch.ts      # Scrapes Basecamp progress, snapshots to SQLite
│   │   │   └── membership.ts # Downloads TI membership CSV, snapshots to SQLite
│   │   ├── queries.ts        # Transport-agnostic read-models (list/detail/diff) — used by desktop
│   │   ├── helpers/
│   │   │   ├── api.ts        # Basecamp API calls
│   │   │   ├── db.ts         # SQLite read/write (snapshots, queries, diff)
│   │   │   ├── files.ts      # File utilities (findLatestMembershipFile)
│   │   │   └── pathway.ts    # Pathway/level logic (titles, next level, etc.)
│   │   └── tests/            # Unit tests for pathway.ts and db.ts + workspace invariants
│   │
│   └── ui/                   # @toastmasters/ui — shared React components (Phase 14)
│       ├── components/       # MemberTable, LevelAccordion, DashboardHeader, DiffSection,
│       │                     # ProjectRow, providers.tsx, and the shadcn ui/* primitives
│       ├── lib/               # utils.ts (shared component helpers, e.g. cn())
│       └── globals.css       # Tailwind base styles, imported by the desktop renderer
│
├── apps/
│   └── desktop/               # @toastmasters/desktop — Electron app (the shipped product)
│       ├── src/
│       │   ├── main/          # Main process: IPC handlers, in-app login, credentials, menu
│       │   ├── preload/       # contextBridge — the only renderer→Node surface
│       │   ├── renderer/      # React UI — views + lib/api.ts (IPC client); imports its
│       │   │                  # components from @toastmasters/ui via the "@" alias
│       │   └── shared/        # Typed IPC contract
│       ├── tests/             # IPC, preload, auth, credentials + main-bundle invariant
│       └── USER_GUIDE.md      # Non-technical end-user guide
│
├── .github/workflows/        # CI (tests) + release (Windows installer) pipelines
└── results/                  # SQLite DB + membership CSV (not committed)
```

> **Historical note:** through Phase 13 there was also a `apps/web` Next.js dashboard,
> deleted in Phase 14 once the Electron app became the sole shipped product. Its reusable React
> components were extracted into `packages/ui` first — see `specs/roadmap.md` Phase 14 and the
> superseded ADRs in `specs/` (`architecture-react.md`, `feature-react-migration.md`,
> `ui-design-react.md`) for the historical record.

### Importing core

`packages/core` has no build step — it runs through `tsx` at the CLI, and `electron-vite`
transpiles and bundles it into the desktop app's main process (see
`apps/desktop/electron.vite.config.ts`). Consumers import it through its declared subpaths:

```ts
import { getLatestProgress } from "@toastmasters/core/db";
import { titleFromFlags } from "@toastmasters/core/pathway";
import type { SummaryRow } from "@toastmasters/core/types";
```

Available subpaths: `/db`, `/pathway`, `/api`, `/files`, `/config`, `/paths`, `/types`,
`/fetch`, `/membership`, `/queries`.

`@toastmasters/core/paths` is the filesystem anchor described under
[Data storage](#data-storage) — importing it (directly, or transitively via `/config` or `/db`)
loads the repo-root `.env` as a side effect.

Core must stay free of `next` and `react` imports — a test in
`packages/core/tests/workspace.test.ts` enforces this, because that invariant is what lets the
Electron [desktop app](#desktop-app) reuse the same code.
