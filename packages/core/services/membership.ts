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

export async function main(report: (line: string) => void = console.log): Promise<void> {
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
  });

  if (!response.ok) {
    throw new HttpError(response.status, `HTTP ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  // RESULTS_DIR is absolute, so the CSV lands in the repo's results/ directory
  // regardless of which workspace the script was invoked from.
  const outputFile = resolve(RESULTS_DIR, `membership-${todayDateString()}.csv`);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(outputFile, csv, "utf-8");
  report("Roster downloaded — saved and recorded.");
  snapshotMembership(csv);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error("membership download failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
