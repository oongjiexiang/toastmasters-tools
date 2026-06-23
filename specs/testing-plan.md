# Testing Plan

## Framework choice: Vitest

**Why Vitest, not Jest:**

- The project uses `"type": "module"` (ESM) in `package.json`. Jest requires additional transform configuration and a Babel or `ts-jest` pipeline to handle ESM + TypeScript. Vitest supports both natively with zero extra config.
- The project already uses `tsx` for development. Vitest's internal transform layer is powered by Vite/esbuild and handles TypeScript directly — no separate `ts-jest` or `babel-jest` package is needed.
- Vitest's API is Jest-compatible (`describe`, `it`, `expect`, `beforeEach`, etc.) so migration costs are zero if we ever need to switch.
- Fast: Vitest parallelises test files by default and uses esbuild transforms, giving sub-second runs for the pure-function unit tests.

**Configuration file:** `vitest.config.ts` (required because the project's `tsconfig.json` uses `"moduleResolution": "bundler"`, which Vitest needs to be told about via the config rather than inferring from `tsconfig`).

---

## What to test vs what to skip

### Test (unit tests — in `tests/`)

| Module | Reason |
|---|---|
| `helpers/pathway.ts` | Pure functions with no I/O. 100% deterministic. Ideal unit test targets. |
| `helpers/db.ts` | SQLite logic. Testable in isolation using temp-file SQLite databases (no mocking of the DB layer itself). |

### Defer to integration / manual tests

| Module | Reason to defer |
|---|---|
| `services/fetch.ts` | Makes live HTTP requests to the Toastmasters Basecamp API. Needs real session cookies. Must not be called in CI. |
| `services/membership.ts` | Reads CSV files from `results/` produced by a manual export step. Requires real data fixtures and file I/O setup. |
| `services/analyze.ts` | Orchestrates CSV reading + writing; integration-level concern. |
| `services/diff.ts` | Thin CLI wrapper around `helpers/db.ts` diff functions; covered indirectly by db tests. |
| `services/ui.ts` | HTTP server (built on Node's `http` module). Requires a live server and browser or HTTP client. Integration/e2e scope. |
| `helpers/files.ts` | Wraps `fs` glob logic for finding the latest membership CSV. Needs a real filesystem fixture. |
| `helpers/csv.ts` | Thin wrappers over `csv-parse`/`csv-stringify`. Third-party library behaviour; not worth unit testing. |

---

## Coverage targets

| Layer | Target | Rationale |
|---|---|---|
| `helpers/pathway.ts` | 100% line + branch | Pure functions; no excuse for gaps |
| `helpers/db.ts` | 90%+ line | All public functions tested; internal helpers like `twoLatestDates` and `fmtDate` covered implicitly via their callers |
| `services/**` | Not targeted | Integration tests deferred; see "defer" table above |

---

## Running tests

### Run all tests once (CI / pre-commit)

```
npm test
```

This executes `vitest run` — runs all files matching `tests/**/*.test.ts` and exits with a non-zero code on any failure.

### Run in watch mode (development)

```
npm run test:watch
```

Vitest re-runs affected tests on every file save — useful during active development.

### Run with coverage report

```
npm run test:coverage
```

Executes `vitest run --coverage` using the `@vitest/coverage-v8` provider. Outputs:
- A text summary to the terminal
- An HTML report at `coverage/index.html` (open in a browser for line-by-line detail)

---

## Database isolation strategy

`helpers/db.ts` functions accept an optional `dbPath` parameter that defaults to `results/db.sqlite`. All unit tests pass a **temporary file path** (created with `mkdtempSync` from `os.tmpdir()`) and delete it after each test using `rmSync`. This means:

- No test ever reads from or writes to `results/db.sqlite`
- Tests are fully isolated from one another
- No `beforeEach`/`afterEach` database reset is needed — each test creates a fresh file

> Note: `:memory:` SQLite is not used for round-trip tests because `better-sqlite3` creates a new in-memory database on every `new Database(":memory:")` call. Since `snapshotProgress` and `getLatestProgress` each call `openDb()` internally, they would get different in-memory databases. Temp-file databases avoid this entirely.

---

## Future test additions (not yet written)

- `helpers/files.ts` — unit test `findLatestMembershipFile` by creating a temp directory with fixture CSV files.
- `services/membership.ts` — integration test using a fixture membership CSV file.
- `services/ui.ts` — HTTP integration test that starts the server on a random port, sends GET requests, and asserts on the JSON response shape.
