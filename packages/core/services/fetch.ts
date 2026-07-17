import { fileURLToPath } from "url";
import { CancelledError, fetchAllProgress, fetchDetail } from "../helpers/api";
import { snapshotProgress, snapshotProjects } from "../helpers/db";
import { getSessionId } from "../config";
import { DetailResponse, MemberProgress } from "../types";
import { logger } from "../logger";

const DETAIL_CONCURRENCY = 5;

/**
 * Receives a human-readable progress line. Defaults to `console.log` for the CLI;
 * the Electron main process passes a reporter that streams each line to the
 * renderer's live output panel over IPC. Kept as a plain callback so core stays
 * framework-agnostic (no Electron import).
 */
export type ProgressReporter = (line: string) => void;

export async function main(
  report: ProgressReporter = console.log,
  signal?: AbortSignal,
): Promise<void> {
  if (!getSessionId()) {
    throw new Error(
      "BASECAMP_SESSIONID is not set.\n" +
        "  1. Log in to https://basecamp.toastmasters.org\n" +
        "  2. Open DevTools → Application → Cookies\n" +
        "  3. Copy the 'sessionid' cookie value\n" +
        "  4. Add it to your .env file as BASECAMP_SESSIONID=<value>",
    );
  }

  // Step 1: Fetch all overview data and snapshot to SQLite
  report("Step 1/3 — gathering the member overview list…");
  const members = await fetchAllProgress(report, signal);
  snapshotProgress(members);
  report(`Step 1/3 done — ${members.length} members found.`);

  // Step 2: Fetch detail for each member (concurrency-limited)
  report(
    `Step 2/3 — fetching lesson details for ${members.length} members (${DETAIL_CONCURRENCY} at a time)…`,
  );
  const detailEntries: Array<{ member: MemberProgress; detail: DetailResponse }> = [];
  let completed = 0;

  for (let i = 0; i < members.length; i += DETAIL_CONCURRENCY) {
    const batch = members.slice(i, i + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((member) => fetchDetail(member.course_id, member.user.username, signal)),
    );

    for (const [j, member] of batch.entries()) {
      const result = results[j];
      if (!result) continue; // results has the same length as batch by construction

      const label = `${member.user.first_name} ${member.user.last_name}`;
      completed++;
      report(`  [${completed}/${members.length}] ${label} — ${member.path_name}`);

      if (result.status === "fulfilled") {
        detailEntries.push({ member, detail: result.value });
      } else {
        report(
          `    Warning: could not fetch detail for ${label}: ${
            result.reason instanceof Error ? result.reason.message : result.reason
          }`,
        );
      }
    }

    if (signal?.aborted) throw new CancelledError();
  }

  if (signal?.aborted) throw new CancelledError();

  // Step 3: Snapshot project detail to SQLite
  snapshotProjects(detailEntries);
  report(`Step 3/3 done — saved project details for ${detailEntries.length} members.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error("fetch failed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
