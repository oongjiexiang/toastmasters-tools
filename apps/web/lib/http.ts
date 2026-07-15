import type { QueryErrorCode, QueryResult } from "@toastmasters/core/queries";

/**
 * HTTP transport mapping for `@toastmasters/core/queries`.
 *
 * The queries themselves are transport-agnostic (the Electron main process maps
 * the same `QueryResult` onto IPC replies). This module owns the *web* half of
 * that mapping and nothing else, so the observable API contract lives in one
 * place: `{ data }` on success, `{ error: { code, message } }` on failure.
 */

const STATUS_BY_CODE: Record<QueryErrorCode, number> = {
  SNAPSHOT_MISSING: 503,
  NOT_FOUND: 404,
};

/** Maps a QueryResult onto the JSON envelope every /api route returns. */
export function respond<T>(result: QueryResult<T>): Response {
  if (!result.ok) {
    return Response.json(
      { error: { code: result.code, message: result.message } },
      { status: STATUS_BY_CODE[result.code] },
    );
  }
  return Response.json({ data: result.data });
}

/** Maps an unexpected throw onto the 500 envelope. */
export function serverError(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: { code: "SERVER_ERROR", message } }, { status });
}
