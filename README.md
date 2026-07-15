# Toastmasters Tools

Personal VPE tooling for one Toastmasters club. Scrapes Basecamp (pathway progress) and toastmasters.org (membership roster), stores snapshots in SQLite, and serves a local web dashboard for weekly/monthly reporting.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
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

> **Desktop app:** the Electron app (see [`specs/roadmap.md`](specs/roadmap.md) Phase 12) can obtain
> these cookies automatically — click **Log in** and sign in on the embedded Toastmasters pages,
> and it harvests `BASECAMP_SESSIONID` / `TI_COOKIE` for you (writing them to its own `config.env`).
> The DevTools method above is still the way to supply cookies for the CLI and web app.

## Typical workflow

```bash
# 1. Fetch latest data (run both before opening the dashboard)
npm run fetch       # Scrape Basecamp → SQLite
npm run membership  # Scrape TI membership roster → SQLite

# 2. Open the dashboard
npm run dev         # http://localhost:3000
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
| `npm run dev` | web | Start the local web dashboard at `http://localhost:3000` |
| `npm run build` | web | Build the Next.js app for production |
| `npm start` | web | Start the production build |
| `npm test` | core + web | Run the full unit/API test suite (core first, then web) |
| `npm run test:e2e` | web | Run the Playwright E2E tests |

Workspace-only scripts (coverage, watch mode) are run with `-w`:

```bash
npm run test:coverage -w @toastmasters/core
npm run test:watch -w @toastmasters/web
```

## Web dashboard

Start with `npm run dev`, then open `http://localhost:3000`.

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
workspace: `npm run fetch` runs in `packages/core/`, `npm run dev` runs in `apps/web/`. They
still read and write the same `<repo>/results/db.sqlite` and the same `<repo>/.env`. The anchor
lives in `packages/core/paths.ts` (`REPO_ROOT`, `DATA_DIR`, `ENV_FILE`).

To store data somewhere else, set `TOASTMASTERS_DATA_DIR` to an absolute path:

```bash
TOASTMASTERS_DATA_DIR=/absolute/path/to/data npm run fetch
```

The database and membership CSVs then live there instead of `<repo>/results/`; `.env` stays at
the repo root. This override is how the planned desktop app
(see [`specs/roadmap.md`](specs/roadmap.md) Phase 11) will point data at Electron's
`app.getPath('userData')`.

## Project structure

The repo is an **npm workspaces** monorepo. Shared scraping/SQLite/pathway logic lives in
`packages/core`; each app in `apps/` consumes it. Every command below is still run from the
repository root — the root `package.json` delegates to the right workspace.

```text
├── package.json              # Workspace root — delegates all scripts (private, no source)
│
├── packages/
│   └── core/                 # @toastmasters/core — framework-agnostic shared logic
│       ├── index.ts          # Interactive CLI launcher (npm run cli)
│       ├── paths.ts          # Repo-root anchor: REPO_ROOT, DATA_DIR, ENV_FILE, .env loading
│       ├── config.ts         # Environment variables and shared constants
│       ├── types.ts          # TypeScript type definitions
│       ├── services/
│       │   ├── fetch.ts      # Scrapes Basecamp progress, snapshots to SQLite
│       │   └── membership.ts # Downloads TI membership CSV, snapshots to SQLite
│       ├── helpers/
│       │   ├── api.ts        # Basecamp API calls
│       │   ├── csv.ts        # CSV parsing utilities
│       │   ├── db.ts         # SQLite read/write (snapshots, queries, diff)
│       │   ├── files.ts      # File utilities (findLatestMembershipFile)
│       │   └── pathway.ts    # Pathway/level logic (titles, next level, etc.)
│       └── tests/            # Unit tests for pathway.ts and db.ts + workspace invariants
│
├── apps/
│   └── web/                  # @toastmasters/web — Next.js app (App Router)
│       ├── app/
│       │   ├── page.tsx      # Dashboard home (member table)
│       │   ├── members/[email]/     # Member detail page
│       │   └── api/
│       │       ├── members/         # GET /api/members — member list with pathway summaries
│       │       ├── members/[email]/ # GET /api/members/:email — full level detail
│       │       ├── diff/            # GET /api/diff — progress + membership diff
│       │       ├── membership-file/ # GET /api/membership-file — CSV download
│       │       └── refresh/         # POST /api/refresh/{progress,membership}
│       ├── components/       # React UI components (MemberTable, LevelAccordion, …)
│       ├── lib/              # Client-side fetch wrappers (api.ts)
│       └── tests/
│           ├── api/          # Smoke tests for each API route
│           └── e2e/          # Playwright E2E tests for the dashboard
│
└── results/                  # SQLite DB + membership CSV (not committed)
```

### Importing core

`packages/core` has no build step (it runs through `tsx`, and Next.js transpiles it via
`transpilePackages`). Consumers import it through its declared subpaths:

```ts
import { getLatestProgress } from "@toastmasters/core/db";
import { titleFromFlags } from "@toastmasters/core/pathway";
import type { SummaryRow } from "@toastmasters/core/types";
```

Available subpaths: `/db`, `/pathway`, `/api`, `/files`, `/config`, `/paths`, `/types`,
`/fetch`, `/membership`.

`@toastmasters/core/paths` is the filesystem anchor described under
[Data storage](#data-storage) — importing it (directly, or transitively via `/config` or `/db`)
loads the repo-root `.env` as a side effect.

Core must stay free of `next` and `react` imports — a test in
`packages/core/tests/workspace.test.ts` enforces this, because that invariant is what lets the
planned Electron desktop app (see [`specs/roadmap.md`](specs/roadmap.md) Phase 11) reuse the
same code.
