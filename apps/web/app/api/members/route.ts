import {
  getLatestProgress,
  getLatestMembership,
  getLatestProjects,
  type ProgressSnapshot,
  type MembershipSnapshotRow,
} from "@toastmasters/core/db";
import {
  nextLevelFromFlags,
  titleFromFlags,
  isOverviewLesson,
} from "@toastmasters/core/pathway";

interface PathwaySummary {
  pathway: string;
  title: string;
  nextLevel: string;
  remaining: number;
  status: "completed" | "ready" | "close" | "in-progress" | "not-started";
}

interface MemberSummary {
  email: string;
  name: string;
  title: string;
  pathways: PathwaySummary[];
}

function computeStatus(
  nextLevel: string,
  projectsDone: number,
  projectsTotal: number,
  remaining: number,
): PathwaySummary["status"] {
  if (nextLevel === "Completed") return "completed";
  if (projectsTotal > 0 && projectsDone === projectsTotal) return "ready";
  if (remaining === 1) return "close";
  if (projectsDone > 0) return "in-progress";
  return "not-started";
}

function pickOverallTitle(pathways: PathwaySummary[], credentials: string): string {
  if (/\bDTM\b/.test(credentials)) return "DTM";

  // Collect non-empty titles and pick the "highest" one.
  // Titles look like "PM3", "DL4", etc. — compare by the trailing digit.
  const nonEmpty = pathways
    .map((pw) => pw.title)
    .filter((t) => t.length > 0);

  if (nonEmpty.length === 0) return "";

  // Sort descending by the numeric suffix (last character assumed to be digit or letter).
  nonEmpty.sort((a, b) => {
    const aNum = parseInt(a.slice(-1), 10);
    const bNum = parseInt(b.slice(-1), 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return bNum - aNum;
    return b.localeCompare(a);
  });

  return nonEmpty[0];
}

export async function GET(): Promise<Response> {
  try {
    const progressRows = getLatestProgress();
    const membershipRows = getLatestMembership();

    if (progressRows === null || membershipRows === null) {
      return Response.json(
        {
          error: {
            code: "SNAPSHOT_MISSING",
            message: "Run npm run fetch and npm run membership first.",
          },
        },
        { status: 503 },
      );
    }

    const memByEmail = new Map<string, MembershipSnapshotRow>(
      membershipRows.map((m) => [m.email, m]),
    );

    // Group progress rows by email
    const byEmail = new Map<string, ProgressSnapshot[]>();
    for (const row of progressRows) {
      const list = byEmail.get(row.email) ?? [];
      list.push(row);
      byEmail.set(row.email, list);
    }

    const results: MemberSummary[] = [];

    for (const [email, rows] of byEmail) {
      const membership = memByEmail.get(email);

      // Build pathway summaries, skipping UnpaidMember pathways
      const pathways: PathwaySummary[] = [];

      for (const p of rows) {
        if (membership?.status === "UnpaidMember") continue;

        const nextLevel = nextLevelFromFlags(p);
        const perPathTitle = titleFromFlags(p, p.pathName, membership?.credentials ?? "");
        const projectRows = getLatestProjects(email, p.pathName);

        let remaining = 0;
        let projectsDone = 0;
        let projectsTotal = 0;

        if (nextLevel !== "Completed" && nextLevel !== "Path Completion") {
          const levelProjects = projectRows.filter(
            (pr) => pr.level === nextLevel && !isOverviewLesson(pr.lesson),
          );
          projectsTotal = levelProjects.length;
          projectsDone = levelProjects.filter((pr) => pr.complete).length;
          remaining = levelProjects.filter((pr) => !pr.complete).length;
        }

        const status = computeStatus(nextLevel, projectsDone, projectsTotal, remaining);

        pathways.push({
          pathway: p.pathName,
          title: perPathTitle,
          nextLevel,
          remaining,
          status,
        });
      }

      // Skip members where ALL pathways were skipped (all UnpaidMember)
      if (pathways.length === 0) continue;

      const firstRow = rows[0];
      const name = `${firstRow.firstName} ${firstRow.lastName}`;
      const overallTitle = pickOverallTitle(pathways, membership?.credentials ?? "");

      results.push({ email, name, title: overallTitle, pathways });
    }

    results.sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({ data: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: { code: "SERVER_ERROR", message } },
      { status: 500 },
    );
  }
}
