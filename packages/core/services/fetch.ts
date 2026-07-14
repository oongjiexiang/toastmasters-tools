import { fileURLToPath } from "url";
import { fetchAllProgress, fetchDetail } from "../helpers/api";
import { snapshotProgress, snapshotProjects } from "../helpers/db";
import { SESSION_ID } from "../config";
import { DetailResponse, MemberProgress } from "../types";

const DETAIL_CONCURRENCY = 5;

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

  // Step 1: Fetch all overview data and snapshot to SQLite
  const members = await fetchAllProgress();
  snapshotProgress(members);
  console.log(`Progress snapshotted: ${members.length} members\n`);

  // Step 2: Fetch detail for each member (concurrency-limited)
  console.log(`Fetching lesson details for ${members.length} members (concurrency: ${DETAIL_CONCURRENCY})...`);
  const detailEntries: Array<{ member: MemberProgress; detail: DetailResponse }> = [];
  let completed = 0;

  for (let i = 0; i < members.length; i += DETAIL_CONCURRENCY) {
    const batch = members.slice(i, i + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((member) => fetchDetail(member.course_id, member.user.username))
    );

    for (let j = 0; j < batch.length; j++) {
      const member = batch[j];
      const label = `${member.user.first_name} ${member.user.last_name}`;
      const result = results[j];
      completed++;
      console.log(`  [${completed}/${members.length}] ${label} — ${member.path_name}`);

      if (result.status === "fulfilled") {
        detailEntries.push({ member, detail: result.value });
      } else {
        console.warn(
          `    Warning: could not fetch detail for ${label}: ${
            result.reason instanceof Error ? result.reason.message : result.reason
          }`
        );
      }
    }
  }

  // Step 3: Snapshot project detail to SQLite
  snapshotProjects(detailEntries);
  console.log(`\nProject details snapshotted for ${detailEntries.length} members`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
