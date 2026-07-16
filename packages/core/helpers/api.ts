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

const PROGRESS_CONCURRENCY = 5;

/**
 * Sequential fallback: walk `next` one page at a time, exactly like the
 * original implementation. Used whenever we can't safely predict page URLs
 * up front (unknown count/page size, or a `next` link that doesn't follow
 * the expected `page=N` scheme).
 */
async function fetchRemainingSequentially(
  startUrl: string,
  startPageNum: number,
  count: number,
  allResults: MemberProgress[],
  report: (line: string) => void
): Promise<MemberProgress[]> {
  let url: string | null = startUrl;
  let pageNum = startPageNum;

  while (url !== null) {
    const page = await fetchPage(url);
    allResults.push(...page.results);
    report(`  Page ${pageNum}: ${allResults.length} of ${count} downloaded.`);
    url = page.next;
    pageNum++;
  }

  return allResults;
}

export async function fetchAllProgress(
  report: (line: string) => void = console.log
): Promise<MemberProgress[]> {
  const firstUrl = `${BASE_URL}?club=${CLUB_ID}&page=1`;
  const page1 = await fetchPage(firstUrl);
  const count = page1.count;
  const pageSize = page1.results.length;

  report(`  Found ${count} members; downloading…`);
  report(`  Page 1: ${page1.results.length} of ${count} downloaded.`);

  if (page1.next === null) {
    return page1.results;
  }

  // Validate that we can safely predict the remaining page URLs.
  let secondPageUrl: URL | null = null;
  try {
    secondPageUrl = new URL(page1.next);
  } catch {
    secondPageUrl = null;
  }

  const canParallelize =
    secondPageUrl !== null &&
    secondPageUrl.searchParams.get("page") === "2" &&
    pageSize > 0 &&
    Number.isFinite(count) &&
    count > 0;

  if (!canParallelize) {
    return fetchRemainingSequentially(
      page1.next,
      2,
      count,
      [...page1.results],
      report
    );
  }

  const totalPages = Math.ceil(count / pageSize);
  const pageUrls: string[] = [];
  for (let n = 2; n <= totalPages; n++) {
    const pageUrl = new URL(firstUrl);
    pageUrl.searchParams.set("page", String(n));
    pageUrls.push(pageUrl.toString());
  }

  // pageResults[i] holds the results for page (i + 2); undefined = failed/missing.
  const pageResults: Array<MemberProgress[] | undefined> = new Array(pageUrls.length);

  for (let i = 0; i < pageUrls.length; i += PROGRESS_CONCURRENCY) {
    const batch = pageUrls.slice(i, i + PROGRESS_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((url) => fetchPage(url)));

    for (let j = 0; j < batch.length; j++) {
      const index = i + j;
      const result = settled[j];
      if (result.status === "fulfilled") {
        pageResults[index] = result.value.results;
      } else {
        const pageNum = index + 2;
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        report(`  Warning: could not fetch page ${pageNum}: ${message}`);
      }
    }
  }

  const allResults: MemberProgress[] = [...page1.results];
  for (let index = 0; index < pageResults.length; index++) {
    const pageNum = index + 2;
    const results = pageResults[index];
    if (results !== undefined) {
      allResults.push(...results);
    }
    report(`  Page ${pageNum}: ${allResults.length} of ${count} downloaded.`);
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
