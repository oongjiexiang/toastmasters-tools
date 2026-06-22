# Roadmap

Phases are ordered so each one delivers usable value on its own. A phase should be completable in a single sitting.

---

## Phase 0 — Done (baseline)

- [x] Fetch Basecamp progress for all members (`progress.csv`, `details.csv`)
- [x] Download TI membership roster (`membership-YYYY-MM-DD.csv`)
- [x] Generate unified summary (`summary.csv`) with title, next level, next project, remaining count
- [x] Interactive CLI launcher (`npm start`)
- [x] Docker support

---

## Phase 1 — SQLite persistence

_Enables history and removes redundant API calls._

- [ ] Add `better-sqlite3` dependency
- [ ] On each `fetch` run, write a timestamped snapshot of progress rows into SQLite alongside the CSV
- [ ] On each `membership` run, write a timestamped snapshot of membership rows into SQLite
- [ ] Expose a `npm run diff` command that compares the two most recent snapshots and prints who advanced, who joined, and who went unpaid

---

## Phase 2 — Local web UI

_Answer the one core question quickly: has a member achieved a given level, and what projects remain?_

- [ ] Add a local HTTP server (`npm run ui`) that serves a dashboard on `localhost:3000`
- [ ] Table view: all members with their pathway, current title (highest approved level), and projects remaining in the next level
- [ ] Detail view: click a member to see every project in the current level — which are done and which are outstanding
- [ ] Reads from SQLite (Phase 1 prerequisite); falls back to latest CSVs if no DB exists

---

## Phase 3 — Hardened pipeline (low priority)

_Pain point: cookie expiry silently breaks runs; manual step order is error-prone._

- [ ] Add a `npm run all` (or menu option) that runs fetch → membership → analyze in sequence, stopping cleanly on first failure
- [ ] Detect expired/invalid cookies at startup and print a precise remediation message before making any API calls
- [ ] Validate that `results/` input files exist and are recent before running `analyze`; warn if they are older than N days
