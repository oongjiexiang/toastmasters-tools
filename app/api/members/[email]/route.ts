import {
  getLatestProgress,
  getLatestMembership,
  getLatestProjects,
} from "@/helpers/db";
import {
  STANDARD_LEVELS,
  nextLevelFromFlags,
  titleFromFlags,
  isOverviewLesson,
} from "@/helpers/pathway";

interface LevelGroup {
  level: string;
  approved: boolean;
  projectsDone: number;
  projectsTotal: number;
  projects: { lesson: string; complete: boolean; type: "Core" | "Elective" }[];
}

interface MemberDetail {
  email: string;
  name: string;
  pathway: string;
  title: string;
  levels: LevelGroup[];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  try {
    const { email: rawEmail } = await params;
    const email = decodeURIComponent(rawEmail);

    const pathway = new URL(request.url).searchParams.get("pathway");
    if (!pathway) {
      return Response.json(
        { error: { code: "SERVER_ERROR", message: "pathway param required" } },
        { status: 400 },
      );
    }

    const progressRows = getLatestProgress();
    if (progressRows === null) {
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

    const progressRow = progressRows.find(
      (p) => p.email === email && p.pathName === pathway,
    );
    if (!progressRow) {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Member not found." } },
        { status: 404 },
      );
    }

    const projectRows = getLatestProjects(email, pathway);

    const membershipRows = getLatestMembership();
    const membershipRow = membershipRows?.find((m) => m.email === email);

    const title = titleFromFlags(
      progressRow,
      pathway,
      membershipRow?.credentials ?? "",
    );

    const allLevels = [...STANDARD_LEVELS, "Path Completion"] as string[];

    const levelApprovedMap: Record<string, boolean> = {
      "Level 1": progressRow.level1,
      "Level 2": progressRow.level2,
      "Level 3": progressRow.level3,
      "Level 4": progressRow.level4,
      "Level 5": progressRow.level5,
      "Path Completion": progressRow.pathDone,
    };

    const levels: LevelGroup[] = allLevels.map((level) => {
      const filtered = projectRows.filter(
        (r) => r.level === level && !isOverviewLesson(r.lesson),
      );
      const projectsDone = filtered.filter((r) => r.complete).length;
      const projectsTotal = filtered.length;
      const projects = filtered.map((r) => ({
        lesson: r.lesson,
        complete: r.complete,
        type: r.type as "Core" | "Elective",
      }));

      return {
        level,
        approved: levelApprovedMap[level] ?? false,
        projectsDone,
        projectsTotal,
        projects,
      };
    });

    const name = `${progressRow.firstName} ${progressRow.lastName}`;

    const detail: MemberDetail = { email, name, pathway, title, levels };

    return Response.json({ data: detail });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: { code: "SERVER_ERROR", message } },
      { status: 500 },
    );
  }
}
