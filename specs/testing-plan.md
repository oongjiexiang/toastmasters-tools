# Testing Plan

## Testing layers

This project uses two complementary testing layers:

| Layer | Framework | Scope | Runs in |
|---|---|---|---|
| Unit / integration | **Vitest** | Pure helper logic, SQLite queries, API route mappers | Node.js (no browser) |
| End-to-end (E2E) | **Playwright** | Browser UI behaviour — element visibility, clicks, toasts, data reload | Real Chromium via Next.js dev server |

The two layers are **independent** — Vitest covers logic that has no browser surface; Playwright covers
the parts that Vitest cannot: toast notifications, spinner state, actual CSS visibility, and
server-triggered data refresh.

---

## Layer 1 — Unit / integration tests (Vitest)

### Framework choice: Vitest

**Why Vitest, not Jest:**

- The project uses `"type": "module"` (ESM) in `package.json`. Jest requires additional transform
  configuration and a Babel or `ts-jest` pipeline to handle ESM + TypeScript. Vitest supports both
  natively with zero extra config.
- Vitest's API is Jest-compatible (`describe`, `it`, `expect`, `beforeEach`, etc.) so migration
  costs are zero if needed.
- Fast: Vitest parallelises test files by default and uses esbuild transforms.

**Configuration file:** `vitest.config.ts`

### What to test vs what to skip

#### Test (unit tests — in `tests/`)

| Module | Reason |
|---|---|
| `helpers/pathway.ts` | Pure functions with no I/O. 100% deterministic. |
| `helpers/db.ts` | SQLite logic. Testable with temp-file databases (no mocking of the DB layer). |

#### Defer to E2E or skip

| Module | Reason |
|---|---|
| `services/fetch.ts` | Makes live HTTP requests to the Toastmasters Basecamp API. Needs real session cookies. Must not be called in CI. |
| `services/membership.ts` | Requires real TI session cookies. Not safe to call in CI. |
| `helpers/files.ts` | Wraps `fs` glob logic; covered implicitly by fetch/membership integration. |
| `helpers/csv.ts` | Thin wrappers over `csv-parse`/`csv-stringify`. Third-party library behaviour; not worth unit testing. |
| Next.js pages / UI components | Visual behaviour, CSS, real HTTP — covered by Playwright E2E. |

### Coverage targets

| Layer | Target | Rationale |
|---|---|---|
| `helpers/pathway.ts` | 100% line + branch | Pure functions; no excuse for gaps |
| `helpers/db.ts` | 90%+ line | All public functions tested; internals covered implicitly |
| `services/**` | Not targeted | Integration tests deferred; see table above |

### Running unit tests

```
npm test                  # run once (CI / pre-commit)
npm run test:watch        # watch mode during development
npm run test:coverage     # with coverage report → coverage/index.html
```

### Database isolation strategy

`helpers/db.ts` functions accept an optional `dbPath` parameter. All unit tests pass a
**temporary file path** (created with `mkdtempSync` from `os.tmpdir()`) and delete it after
each test using `rmSync`. No test reads from or writes to `results/db.sqlite`.

> `:memory:` SQLite is not used because `better-sqlite3` creates a new in-memory database per
> `new Database(":memory:")` call. Since functions like `snapshotProgress` and `getLatestProgress`
> each call `openDb()` internally, they would get different in-memory databases. Temp-file
> databases avoid this entirely.

---

## Layer 2 — E2E tests (Playwright)

### Framework choice: Playwright

**Why Playwright, not Cypress:**

- TypeScript-first with full type inference out of the box.
- Runs against a real Chromium process; CSS visibility, DOM portals (Sonner toasts), and
  focus/disabled states behave exactly as in production.
- `@playwright/test` integrates with Next.js via `webServer` config — the test runner starts
  `next dev`, waits for it to be ready, runs tests, and tears it down. No manual server management.
- Faster than Cypress for headless runs; lower memory overhead.

**Why Playwright over React Testing Library (RTL) for UI tests:**

RTL mounts components in jsdom — it can verify that a button renders, but:
- Sonner toasts render into a `<Toaster>` portal outside the component under test. RTL cannot
  see them without mocking the entire Sonner library.
- CSS `display: none` / `visibility: hidden` is ignored by jsdom — RTL cannot assert actual
  visual visibility.
- Real HTTP calls to API routes are not made — spinner state that depends on network timing
  cannot be tested without extensive mocking.

Playwright avoids all of these by using a real browser against a real server.

### What to test in Playwright

| Feature | What to assert |
|---|---|
| Dashboard header | "Refresh Progress" and "Refresh Membership" buttons visible on every page state (loading, error, empty, populated) |
| Refresh button click | Spinner appears on the clicked button; other button disabled |
| Loading toast | Sonner toast with the loading message is visible while the request is in progress |
| Error toast | When cookies are missing/invalid, an error toast is shown with the first line of the error message |
| Success flow | On success, the toast updates to success and the member table reloads with fresh data |
| CSV download | The "Membership CSV" link is present and triggers a file download |

### E2E test configuration

Playwright config lives in `playwright.config.ts` at the project root. Key settings:

```ts
// playwright.config.ts (target shape — written in Phase 9)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:3000' },
});
```

### Running E2E tests

```
npx playwright test               # run all E2E tests headless
npx playwright test --ui          # Playwright UI mode (interactive, with time-travel)
npx playwright test --headed      # watch tests run in a real browser window
npx playwright show-report        # open last HTML report
```

E2E tests require a running (or auto-started) Next.js server and valid `.env` credentials for
the success-flow tests. The error-flow tests use a deliberately invalid session cookie and do
not require real credentials.

---

## Future test additions

- `helpers/files.ts` — unit test `findLatestMembershipFile` with a temp directory of fixture CSVs.
- E2E: member detail page — verify all six level groups render with correct completion badges.
- E2E: diff section — verify the diff table appears after two fetch runs with different data.
