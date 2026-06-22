/**
 * Toastmasters Basecamp Progress Fetcher
 *
 * Fetches all member progress data from the Basecamp API and exports to CSV.
 *
 * Setup:
 *   1. npm install
 *   2. Copy .env.example to .env and fill in your values
 *   3. npm run fetch
 *
 * How to get your auth cookie:
 *   1. Log in to https://basecamp.toastmasters.org in your browser
 *   2. Open DevTools (F12) → Application → Cookies → basecamp.toastmasters.org
 *   3. Copy the value of the "sessionid" cookie
 *   4. Set it as BASECAMP_SESSIONID in your .env file
 */

import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";
import { fetchAllProgress, fetchDetail } from "../helpers/api";
import { buildCsv, buildDetailCsv } from "../helpers/csv";
import { snapshotProgress } from "../helpers/db";
import {
  DETAIL_OUTPUT_FILE,
  OUTPUT_FILE,
  RESULTS_DIR,
  SESSION_ID,
} from "../config";
import { DetailResponse, MemberProgress } from "../types";

export async function main(): Promise<void> {
  if (!SESSION_ID) {
    throw new Error(
      "BASECAMP_SESSIONID is not set.\n" +
        "  1. Log in to https://basecamp.toastmasters.org\n" +
        "  2. Open DevTools → Application → Cookies\n" +
        "  3. Copy the 'sessionid' cookie value\n" +
        "  4. Add it to your .env file as BASECAMP_SESSIONID=<value>"
    );
  }

  // Step 1: Fetch all overview data
  const members = await fetchAllProgress();
  const overviewCsv = buildCsv(members);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, overviewCsv, "utf-8");
  console.log(`Overview CSV saved to: ${OUTPUT_FILE} (${members.length} rows)\n`);
  snapshotProgress(members);

  // Step 2: Fetch detail for each member
  console.log(`Fetching lesson details for ${members.length} members...`);
  const detailEntries: Array<{ member: MemberProgress; detail: DetailResponse }> = [];

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const label = `${member.user.first_name} ${member.user.last_name}`;
    console.log(`  [${i + 1}/${members.length}] ${label} — ${member.path_name}`);

    try {
      const detail = await fetchDetail(member.course_id, member.user.username);
      detailEntries.push({ member, detail });
    } catch (err) {
      console.warn(
        `    Warning: could not fetch detail for ${label}: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // Step 3: Write detail CSV
  const detailCsv = buildDetailCsv(detailEntries);
  writeFileSync(DETAIL_OUTPUT_FILE, detailCsv, "utf-8");

  const totalLessons = detailEntries.reduce(
    (sum, { detail }) =>
      sum + detail.blocks.children.reduce((s, ch) => s + ch.children.length, 0),
    0
  );
  console.log(
    `\nDetail CSV saved to: ${DETAIL_OUTPUT_FILE} (${totalLessons} lesson rows across ${detailEntries.length} members)`
  );
}

// if (process.argv[1] === fileURLToPath(import.meta.url)) {
//   main().catch((err) => {
//     console.error("Failed:", err instanceof Error ? err.message : err);
//     process.exit(1);
//   });
// }
