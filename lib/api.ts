export interface PathwaySummary {
  pathway: string;
  title: string;
  nextLevel: string;
  remaining: number;
  status: "completed" | "ready" | "close" | "in-progress" | "not-started";
}

export interface MemberSummary {
  email: string;
  name: string;
  title: string;
  pathways: PathwaySummary[];
}

export interface LevelGroup {
  level: string;
  approved: boolean;
  projectsDone: number;
  projectsTotal: number;
  projects: { lesson: string; complete: boolean; type: "Core" | "Elective" }[];
}

export interface MemberDetail {
  email: string;
  name: string;
  pathway: string;
  title: string;
  levels: LevelGroup[];
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore JSON parse failures
    }
    throw new Error(message);
  }
  const body = await res.json();
  return body.data as T;
}

export async function getMembers(): Promise<MemberSummary[]> {
  const res = await fetch("/api/members");
  return handleResponse<MemberSummary[]>(res);
}

export async function getMember(
  email: string,
  pathway: string,
): Promise<MemberDetail> {
  const res = await fetch(
    `/api/members/${encodeURIComponent(email)}?pathway=${encodeURIComponent(pathway)}`,
  );
  return handleResponse<MemberDetail>(res);
}
