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

### Layer 3 — Local web UI

Add a lightweight local HTTP server (e.g. `express` or Node's built-in `http`) that reads from SQLite and serves a simple HTML dashboard:

- Filter/sort members by level, pathway, title, or membership status.
- Highlight members close to a level completion or at risk of expiry.
- No external hosting — runs on `localhost` only.

## Constraints

- **No cloud dependencies** for runtime. Credentials are local; data never leaves the machine.
- **No build step required** for development. `tsx` watches files; the CLI stays runnable with `npm start`.
- **Docker remains optional** but must continue to work after each layer is added.
