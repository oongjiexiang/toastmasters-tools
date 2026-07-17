import { BASE_URL, CLUB_ID, getSessionId } from "../config";
import { ApiResponse, DetailResponse, MemberProgress } from "../types";

/**
 * A consistent error type for every failed HTTP call the scrapers make (both
 * `fetchPage`/`fetchDetail` here and the membership download in
 * `services/membership.ts`). Callers that only care about the message (e.g. the
 * renderer's toast, matched via `/HTTP 40[13]/`) see the exact same text as
 * before — `status` is additive, not a message-shape change.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Thrown when an in-flight refresh is cancelled (via `AbortSignal`) rather than
 * failing on its own. Callers (the Electron main process) check `.name` rather
 * than `instanceof` where they must stay statically core-free — see
 * `apps/desktop/src/main/index.ts`'s header comment on `loadCore()`.
 */
export class CancelledError extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

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

async function fetchPage(url: string, signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetch(url, { headers: buildHeaders(), signal });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      `HTTP ${response.status} ${response.statusText} for ${url}`,
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
  report: (line: string) => void,
  signal?: AbortSignal,
): Promise<MemberProgress[]> {
  let url: string | null = startUrl;
  let pageNum = startPageNum;

  while (url !== null) {
    const page = await fetchPage(url, signal);
    allResults.push(...page.results);
    report(`  Page ${pageNum}: ${allResults.length} of ${count} downloaded.`);
    if (signal?.aborted) throw new CancelledError();
    url = page.next;
    pageNum++;
  }

  return allResults;
}

export async function fetchAllProgress(
  report: (line: string) => void = console.log,
  signal?: AbortSignal,
): Promise<MemberProgress[]> {
  const firstUrl = `${BASE_URL}?club=${CLUB_ID}&page=1`;
  const page1 = await fetchPage(firstUrl, signal);
  const count = page1.count;
  const pageSize = page1.results.length;

  report(`  Found ${count} members; downloading…`);
  report(`  Page 1: ${page1.results.length} of ${count} downloaded.`);

  if (signal?.aborted) throw new CancelledError();

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
    return fetchRemainingSequentially(page1.next, 2, count, [...page1.results], report, signal);
  }

  const totalPages = Math.ceil(count / pageSize);
  const pageUrls: string[] = [];
  for (let n = 2; n <= totalPages; n++) {
    const pageUrl = new URL(firstUrl);
    pageUrl.searchParams.set("page", String(n));
    pageUrls.push(pageUrl.toString());
  }

  // pageResults[i] holds the results for page (i + 2); undefined = failed/missing.
  const pageResults = new Array<MemberProgress[] | undefined>(pageUrls.length);

  for (let i = 0; i < pageUrls.length; i += PROGRESS_CONCURRENCY) {
    const batch = pageUrls.slice(i, i + PROGRESS_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((url) => fetchPage(url, signal)));

    for (const [j, result] of settled.entries()) {
      const index = i + j;
      if (result.status === "fulfilled") {
        pageResults[index] = result.value.results;
      } else {
        const pageNum = index + 2;
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        report(`  Warning: could not fetch page ${pageNum}: ${message}`);
      }
    }

    if (signal?.aborted) throw new CancelledError();
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
  username: string,
  signal?: AbortSignal,
): Promise<DetailResponse> {
  const url = `${BASE_URL}${courseId}/detail?user=${username}&page_size=5000`;
  const response = await fetch(url, { headers: buildHeaders(), signal });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      `HTTP ${response.status} ${response.statusText} for detail ${courseId} / ${username}`,
    );
  }

  return (await response.json()) as DetailResponse;
}
