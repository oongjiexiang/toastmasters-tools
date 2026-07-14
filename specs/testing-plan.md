# Testing Plan

## Testing layers

This project uses two complementary testing layers:

| Layer | Framework | Scope | Runs in |
|---|---|---|---|
| Unit / integration | **Vitest** | Pure helper logic, SQLite queries, workspace/path invariants, API route mappers | Node.js (no browser) |
| End-to-end (E2E) | **Playwright** | Browser UI behaviour — element visibility, clicks, toasts, data reload | Real Chromium via Next.js dev server |

The two layers are **independent** — Vitest covers logic that has no browser surface; Playwright covers
the parts that Vitest cannot: toast notifications, spinner state, actual CSS visibility, and
server-triggered data refresh.

### Where tests live (monorepo, Phase 10)

Each workspace owns its own tests and its own Vitest config. The root `npm test` runs core first,
then web.

| Location | Config | Contents |
|---|---|---|
| `packages/core/tests/` | `packages/core/vitest.config.ts` | `pathway.test.ts`, `db.test.ts`, `workspace.test.ts`, `paths.test.ts` |
| `apps/web/tests/api/` | `apps/web/vitest.config.ts` | One smoke test per Next.js API route |
| `apps/web/tests/e2e/` | `apps/web/playwright.config.ts` | `dashboard.spec.ts` (Playwright) |

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

**Configuration files:** `packages/core/vitest.config.ts` and `apps/web/vitest.config.ts` (one per
workspace — the web config carries the `@` alias used to mock API route imports).

### What to test vs what to skip

Paths below are relative to `packages/core/` unless stated otherwise.

#### Test (unit tests)

| Module | Reason |
|---|---|
| `helpers/pathway.ts` | Pure functions with no I/O. 100% deterministic. |
| `helpers/db.ts` | SQLite logic. Testable with temp-file databases (no mocking of the DB layer). |
| `paths.ts` | Repo-root anchoring. Regression-tested **out of process**: the suite spawns `tsx` with the cwd set to each workspace and asserts `REPO_ROOT` / `DATA_DIR` / `DEFAULT_DB_PATH` still land at the repo root. Includes negative controls that fail if the cwd-independence guard is weakened. |
| Workspace invariants | `workspace.test.ts` asserts the `exports` map, that every subpath resolves, that no core source imports `next`/`react`, and that no source uses the dead pre-monorepo `@/` alias. |
| `apps/web/app/api/**` | One smoke test per route — status code plus response shape. |

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
| `apps/web/app/api/**` | Smoke coverage per route | Enforced by a 75% line/function threshold in the web Vitest config |
| `services/**` | Not targeted | Integration tests deferred; see table above |

### Running unit tests

Only `npm test` exists at the root; watch and coverage are workspace scripts, run with `-w`.

```bash
npm test                                        # both workspaces, once (CI / pre-commit)
npm test -w @toastmasters/core                  # core only
npm run test:coverage -w @toastmasters/core     # coverage → packages/core/coverage/index.html
npm run test:watch -w @toastmasters/web         # watch mode (web only — core has no watch script)
npm run test:coverage -w @toastmasters/web      # coverage → apps/web/coverage/index.html
```

### Database isolation strategy

`helpers/db.ts` functions accept an optional `dbPath` parameter, defaulting to `DEFAULT_DB_PATH`
(`<repo>/results/db.sqlite`, resolved via `paths.ts` — see
[`tech-stack.md`](tech-stack.md) Layer 0). All unit tests pass a
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

Playwright config lives in `apps/web/playwright.config.ts` (it moved out of the repo root in the
Phase 10 monorepo restructure — Playwright belongs to the workspace that owns the dev server).
Key settings:

```ts
// apps/web/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://localhost:3000" },
});
```

### Running E2E tests

```bash
npm run test:e2e                  # from the repo root — delegates to the web workspace
```

Or from `apps/web/` for the interactive flags:

```bash
npx playwright test               # run all E2E tests headless
npx playwright test --ui          # Playwright UI mode (interactive, with time-travel)
npx playwright test --headed      # watch tests run in a real browser window
npx playwright show-report        # open last HTML report
```

Playwright auto-starts the Next.js dev server via `webServer`. The suite mocks API responses with
`page.route()`, so no real Basecamp or TI credentials are needed — including for the success flow.

---

## Future test additions

- `packages/core/helpers/files.ts` — unit test `findLatestMembershipFile` with a temp directory of
  fixture CSVs.
- E2E: member detail page — verify all six level groups render with correct completion badges.
- E2E: diff section — verify the diff table appears after two fetch runs with different data.
