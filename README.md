# Toastmasters User Retriever

Fetches member progress from the Toastmasters Basecamp learning platform and the club membership roster, then produces a summary CSV and local web dashboard for VPE reporting.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later **— OR —** [Docker](https://www.docker.com/)
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
4. Paste it as `BASECAMP_SESSIONID=<value>` in `.env`

### Getting `TI_COOKIE`

1. Log in to [www.toastmasters.org](https://www.toastmasters.org)
2. Open DevTools (`F12`) → **Application** → **Cookies** → `www.toastmasters.org`
3. Select all cookies and copy them as a single semicolon-separated string
   (e.g. `cookie1=val1; cookie2=val2; ...`)
4. Paste it as `TI_COOKIE=<value>` in `.env`

Both cookies expire with your browser session, so you will need to refresh them periodically.

## Usage

### Interactive launcher

```bash
npm start
```

Presents a numbered menu to choose which script(s) to run.

### Run scripts directly

| Command | Description |
|---|---|
| `npm run fetch` | Download Basecamp progress data → `results/progress.csv` + `results/details.csv`, snapshot to SQLite |
| `npm run membership` | Download club membership roster → `results/membership-YYYY-MM-DD.csv`, snapshot to SQLite |
| `npm run analyze` | Generate member summary → `results/summary.csv` |
| `npm run diff` | Show what changed since the previous run (who advanced, joined, or went unpaid) |
| `npm run ui` | Start the local web dashboard at `http://localhost:3000` |

Run **fetch** and **membership** first (in either order), then **analyze** or **ui**.

### Web dashboard

```bash
npm run ui
```

Opens a dashboard at `http://localhost:3000`:

- **Table view** — all paid members with their pathway, current title, next level to complete, and remaining project count. Click a member to drill in.
- **Detail view** — every project in a member's current level, marked Done or Pending.

The dashboard reads from the SQLite snapshot (written by `fetch` and `membership`) and falls back to the CSV files if no snapshot exists yet.

Press `Ctrl+C` to stop the server.

## Docker

### Build the image

```bash
docker build -t user-retriever .
```

### Run

```bash
# macOS / Linux
docker run -it --env-file .env -v "$(pwd)/results:/app/results" user-retriever

# Windows PowerShell
docker run -it --env-file .env -v "${PWD}/results:/app/results" user-retriever

# Windows Command Prompt
docker run -it --env-file .env -v "%cd%/results:/app/results" user-retriever
```

- `-it` — required for the interactive menu (keyboard input + coloured output)
- `--env-file .env` — passes your credentials in; the `.env` file is never copied into the image
- `-v .../results:/app/results` — mounts the local `results/` folder so output files are written to your machine

The `results/` folder will be created automatically if it does not exist.

## Output files

All files are written to the `results/` folder.

| File | Description |
|---|---|
| `progress.csv` | One row per member per pathway. Includes level completion counts and approval status. |
| `details.csv` | One row per lesson per member per pathway. Captures completion status, type (Core/Elective), and speech details. |
| `membership-YYYY-MM-DD.csv` | Raw export from toastmasters.org. Used to determine paid membership status and earned credentials. |
| `summary.csv` | One row per member per pathway. Columns: Name, Title, Pathways, Next Level to Complete, Next Project, Remaining Projects. |
| `db.sqlite` | SQLite database holding timestamped snapshots from each `fetch` and `membership` run. Used by `diff` and `ui`. |

### Title logic

- **DTM** — member holds a DTM credential in the membership roster
- **XX5**, **XX4**, … — pathway initials + highest approved level (e.g. `PM3` = Presentation Mastery Level 3 approved)
- *(blank)* — no levels approved yet
- Members with `UnpaidMember` status are excluded entirely

## Project structure

```
├── index.ts              # Interactive launcher (npm start)
├── config.ts             # Environment variables and shared constants
├── types.ts              # TypeScript type definitions
├── Dockerfile            # Container image definition
├── .dockerignore         # Files excluded from the Docker image
├── .env                  # Your local credentials (not committed)
├── .env.example          # Template for .env
│
├── services/
│   ├── fetch.ts          # Downloads Basecamp progress data
│   ├── membership.ts     # Downloads TI membership CSV
│   ├── analyze.ts        # Generates summary.csv
│   ├── diff.ts           # Prints change report between the two latest snapshots
│   └── ui.ts             # Local web dashboard (port 3000)
│
├── helpers/
│   ├── api.ts            # Basecamp API calls (fetchAllProgress, fetchDetail)
│   ├── csv.ts            # CSV building utilities (buildCsv, buildDetailCsv)
│   ├── db.ts             # SQLite snapshot read/write (snapshotProgress, snapshotMembership, …)
│   ├── files.ts          # File utilities (findLatestMembershipFile)
│   └── pathway.ts        # Pathway/level logic (pathwayInitials, isLevelDone, …)
│
└── results/              # Generated output files (not committed)
```
