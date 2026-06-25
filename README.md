# Toastmasters Tools

Personal VPE tooling for one Toastmasters club. Scrapes Basecamp (pathway progress) and toastmasters.org (membership roster), stores snapshots in SQLite, and serves a local web dashboard for weekly/monthly reporting.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- An active Toastmasters officer account with access to both Basecamp and toastmasters.org

## Installation

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

| Command | Description |
|---|---|
| `npm run fetch` | Scrape Basecamp progress for all members and snapshot to SQLite |
| `npm run membership` | Download TI membership roster and snapshot to SQLite |
| `npm run cli` | Interactive launcher — choose which scripts to run |
| `npm run dev` | Start the local web dashboard at `http://localhost:3000` |
| `npm run build` | Build the Next.js app for production |
| `npm start` | Start the production build |
| `npm test` | Run the test suite |
| `npm run test:coverage` | Run tests with coverage report |

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

All data lives in `results/db.sqlite`. The only file written to `results/` is the membership CSV downloaded by `npm run membership` (kept for the download endpoint in the dashboard).

## Project structure

```
├── index.ts              # Interactive CLI launcher (npm run cli)
├── config.ts             # Environment variables and shared constants
├── types.ts              # TypeScript type definitions
│
├── services/
│   ├── fetch.ts          # Scrapes Basecamp progress, snapshots to SQLite
│   └── membership.ts     # Downloads TI membership CSV, snapshots to SQLite
│
├── helpers/
│   ├── api.ts            # Basecamp API calls
│   ├── csv.ts            # CSV parsing utilities
│   ├── db.ts             # SQLite read/write (snapshots, queries, diff)
│   ├── files.ts          # File utilities (findLatestMembershipFile)
│   └── pathway.ts        # Pathway/level logic (titles, next level, etc.)
│
├── app/                  # Next.js 15 app (App Router)
│   ├── page.tsx          # Dashboard home (member table)
│   ├── members/[email]/  # Member detail page
│   └── api/
│       ├── members/      # GET /api/members — member list with pathway summaries
│       ├── members/[email]/ # GET /api/members/:email — full level detail
│       ├── diff/         # GET /api/diff — progress + membership diff
│       └── membership-file/ # GET /api/membership-file — CSV download
│
├── components/           # React UI components (MemberTable, LevelAccordion, …)
├── lib/                  # Client-side fetch wrappers (api.ts)
│
├── tests/
│   ├── helpers/          # Unit tests for pathway.ts and db.ts
│   └── api/              # Smoke tests for each API route
│
└── results/              # SQLite DB + membership CSV (not committed)
```
