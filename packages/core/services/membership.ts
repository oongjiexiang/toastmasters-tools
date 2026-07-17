/**
 * Toastmasters Membership CSV Downloader
 *
 * Downloads the club membership export from www.toastmasters.org
 * and saves it locally as membership-<YYYY-MM-DD>.csv.
 *
 * Setup:
 *   1. npm install
 *   2. Copy .env.example to .env and fill in your TI_COOKIE
 *   3. npm run membership
 */

import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { snapshotMembership } from "../helpers/db";
import { RESULTS_DIR, getTiCookie } from "../config";
import { HttpError } from "../helpers/api";
import { logger } from "../logger";

const MEMBERSHIP_URL =
  "https://www.toastmasters.org/api/sitecore/ClubMembershipLanding/ExportClubMembershipToCSVDownload";

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function main(
  report: (line: string) => void = console.log,
  signal?: AbortSignal,
): Promise<void> {
  if (!getTiCookie()) {
    throw new Error(
      "TI_COOKIE is not set.\n" +
        "  Add it to your .env file as TI_COOKIE=<value>\n" +
        "  How to get it:\n" +
        "    1. Log in to https://www.toastmasters.org\n" +
        "    2. Open DevTools (F12) → Application → Cookies → www.toastmasters.org\n" +
        "    3. Copy all cookies as a single semicolon-separated string",
    );
  }

  report("Downloading the membership roster from Toastmasters…");

  const response = await fetch(MEMBERSHIP_URL, {
    headers: {
      Accept: "text/csv,*/*",
      "User-Agent": "Mozilla/5.0",
      Cookie: getTiCookie(),
    },
    signal,
  });

  if (!response.ok) {
    throw new HttpError(response.status, `HTTP ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();

  // An expired/invalid TI_COOKIE doesn't fail this endpoint with a 401/403 —
  // Toastmasters answers 200 OK with an HTML login/error page instead. Left
  // unchecked, that "csv" gets written to disk and handed to csv-parse, which
  // fails with a cryptic parser error ("Invalid Opening Quote...") instead of
  // a recognizable auth failure. Detect it up front and surface it in the same
  // "HTTP 40x" shape the renderer's AUTH_ERROR check already looks for, so the
  // cookie-expiry UX (toast hint + full detail in the log console) applies
  // here too — before anything is written or reported as a success.
  if (looksLikeHtml(csv)) {
    throw new HttpError(
      401,
      "HTTP 401 — TI_COOKIE appears to be expired or invalid (Toastmasters returned an HTML " +
        "page instead of the CSV export). Log out and log in again.",
    );
  }

  // RESULTS_DIR is absolute, so the CSV lands in the repo's results/ directory
  // regardless of which workspace the script was invoked from.
  const outputFile = resolve(RESULTS_DIR, `membership-${todayDateString()}.csv`);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(outputFile, csv, "utf-8");
  report("Roster downloaded — saved and recorded.");
  snapshotMembership(csv);
}

/** True if `body` is an HTML document rather than the expected CSV export. */
function looksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 100).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error("membership download failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
