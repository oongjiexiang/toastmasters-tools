# Toastmasters User Retriever

Fetches member progress from the Toastmasters Basecamp learning platform and the club membership roster, then produces a summary CSV for VPE reporting.

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

Presents a numbered menu to choose which script to run.

### Run scripts directly

| Command | Description |
|---|---|
| `npm run fetch` | Download Basecamp progress data → `results/progress.csv` + `results/details.csv` |
| `npm run membership` | Download club membership roster → `results/membership-YYYY-MM-DD.csv` |
| `npm run analyze` | Generate member summary → `results/summary.csv` |

Run **fetch** and **membership** first (in either order), then **analyze**.

## Output files

All files are written to the `results/` folder.

| File | Description |
|---|---|
| `progress.csv` | One row per member per pathway. Includes level completion counts and approval status. |
| `details.csv` | One row per lesson per member per pathway. Captures completion status, type (Core/Elective), and speech details. |
| `membership-YYYY-MM-DD.csv` | Raw export from toastmasters.org. Used to determine paid membership status and earned credentials. |
| `summary.csv` | One row per member per pathway. Columns: Name, Title, Pathways, Next Level to Complete, Next Project, Remaining Projects. |

### Title logic in `summary.csv`

- **DTM** — member holds a DTM credential in the membership roster
- **XX5**, **XX4**, … — pathway initials + highest approved level (e.g. `PM3` = Presentation Mastery Level 3 approved)
- *(blank)* — no levels approved yet
- Members with `UnpaidMember` status are excluded entirely

## Project structure

```
├── index.ts              # Interactive launcher (npm start)
├── config.ts             # Environment variables and shared constants
├── types.ts              # TypeScript type definitions
├── .env                  # Your local credentials (not committed)
├── .env.example          # Template for .env
│
├── services/
│   ├── fetch.ts          # Downloads Basecamp progress data
│   ├── membership.ts     # Downloads TI membership CSV
│   └── analyze.ts        # Generates summary.csv
│
├── helpers/
│   ├── api.ts            # Basecamp API calls (fetchAllProgress, fetchDetail)
│   ├── csv.ts            # CSV building utilities (buildCsv, buildDetailCsv)
│   ├── files.ts          # File utilities (findLatestMembershipFile)
│   └── pathway.ts        # Pathway/level logic (pathwayInitials, isLevelDone, …)
│
└── results/              # Generated output files (not committed)
```
