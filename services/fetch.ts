import { fileURLToPath } from "url";
import { fetchAllProgress, fetchDetail } from "../helpers/api";
import { snapshotProgress, snapshotProjects } from "../helpers/db";
import { SESSION_ID } from "../config";
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

  // Step 1: Fetch all overview data and snapshot to SQLite
  const members = await fetchAllProgress();
  snapshotProgress(members);
  console.log(`Progress snapshotted: ${members.length} members\n`);

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
