import { BASE_URL, CLUB_ID, getSessionId } from "../config";
import { ApiResponse, DetailResponse, MemberProgress } from "../types";

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
  };
  const sessionId = getSessionId();
  if (sessionId) {
    headers["Cookie"] = `sessionid=${sessionId};`;
  }
  return headers;
}

async function fetchPage(url: string): Promise<ApiResponse> {
  const response = await fetch(url, { headers: buildHeaders() });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${url}`
    );
  }

  return (await response.json()) as ApiResponse;
}

export async function fetchAllProgress(
  report: (line: string) => void = console.log
): Promise<MemberProgress[]> {
  const firstUrl = `${BASE_URL}?club=${CLUB_ID}&page=1`;
  const allResults: MemberProgress[] = [];

  let url: string | null = firstUrl;
  let pageNum = 1;

  while (url !== null) {
    const page = await fetchPage(url);
    allResults.push(...page.results);

    if (pageNum === 1) {
      report(`  Found ${page.count} members; downloading…`);
    }
    report(`  Page ${pageNum}: ${allResults.length} of ${page.count} downloaded.`);
    url = page.next;
    pageNum++;
  }

  return allResults;
}

export async function fetchDetail(
  courseId: string,
  username: string
): Promise<DetailResponse> {
  const url = `${BASE_URL}${courseId}/detail?user=${username}&page_size=5000`;
  const response = await fetch(url, { headers: buildHeaders() });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for detail ${courseId} / ${username}`
    );
  }

  return (await response.json()) as DetailResponse;
}
