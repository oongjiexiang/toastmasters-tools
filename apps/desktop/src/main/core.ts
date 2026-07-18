/**
 * The single entry point through which the main process reaches @toastmasters/core.
 *
 * ⚠️ This module must only ever be reached via `await import("./core")` from
 * `index.ts` — never a static import.
 *
 * Core freezes filesystem- and credential-derived values in module-level consts
 * at import time:
 *
 *   paths.ts   DATA_DIR         <- process.env.TOASTMASTERS_DATA_DIR
 *   db.ts      DEFAULT_DB_PATH  <- DATA_DIR
 *   config.ts  SESSION_ID       <- process.env.BASECAMP_SESSIONID
 *              TI_COOKIE        <- process.env.TI_COOKIE
 *
 * ESM `import` statements are hoisted and evaluated before any function body
 * runs, so a static import of core at the top of `index.ts` would evaluate all
 * of the above *before* the main process can set those environment variables.
 * In a packaged app that means the database resolves to a junk path inside the
 * asar (there is no workspace `package.json` above a packaged app, so core's
 * `resolveRepoRoot()` falls through to its last-resort branch) and the scrapers
 * see empty credentials.
 *
 * Collecting every core import in one module also guarantees the bundler emits a
 * single lazily-evaluated chunk: importing any one core subpath cannot
 * accidentally evaluate another one early through a shared chunk.
 */

export { DEFAULT_DB_PATH } from "@toastmasters/core/db";
export { RESULTS_DIR } from "@toastmasters/core/config";
export { findLatestMembershipFile } from "@toastmasters/core/files";
export { main as runFetch } from "@toastmasters/core/fetch";
export { main as runMembership } from "@toastmasters/core/membership";
export {
  buildProgressReportCsv,
  getDiff,
  getMemberDetail,
  listMembers,
} from "@toastmasters/core/queries";
