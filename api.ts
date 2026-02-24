import { BASE_URL, CLUB_ID, SESSION_ID } from "./config";
import { ApiResponse, DetailResponse, MemberProgress } from "./types.js";

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
  };
  if (SESSION_ID) {
    headers["Cookie"] = `sessionid=${SESSION_ID};`;
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

export async function fetchAllProgress(): Promise<MemberProgress[]> {
  const firstUrl = `${BASE_URL}?club=${CLUB_ID}&page=1`;
  const allResults: MemberProgress[] = [];

  console.log(`Fetching progress data for club: ${CLUB_ID}`);

  let url: string | null = firstUrl;
  let pageNum = 1;

  while (url !== null) {
    console.log(`  Fetching page ${pageNum}...`);
    const page = await fetchPage(url);
    allResults.push(...page.results);

    if (pageNum === 1) {
      console.log(`  Total members expected: ${page.count}`);
    }
    console.log(`  Total fetched so far: ${allResults.length}`);
    url = page.next;
    pageNum++;
  }

  console.log(`  Done — retrieved ${allResults.length} records.\n`);
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
