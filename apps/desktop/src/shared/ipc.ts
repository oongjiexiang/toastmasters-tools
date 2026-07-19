/**
 * The IPC contract between the Electron main process and the renderer.
 *
 * Shared by all three bundles (main, preload, renderer). It must stay free of
 * runtime imports from `@toastmasters/core` — the type-only imports below are
 * erased at build time, so no core code (and no `better-sqlite3`) is ever pulled
 * into the preload or renderer bundle.
 */

import type {
  DiffResult,
  ListMembersResult,
  MemberDetail,
  MemberSummary,
} from "@toastmasters/core/queries";

export const IPC = {
  LIST_MEMBERS: "toastmasters:members:list",
  GET_MEMBER: "toastmasters:members:get",
  GET_DIFF: "toastmasters:diff:get",
  REFRESH_PROGRESS: "toastmasters:refresh:progress",
  REFRESH_MEMBERSHIP: "toastmasters:refresh:membership",
  REFRESH_CANCEL: "toastmasters:refresh:cancel",
  DOWNLOAD_MEMBERSHIP_CSV: "toastmasters:membership:download",
  AUTH_LOGIN: "toastmasters:auth:login",
  AUTH_STATUS: "toastmasters:auth:status",
  AUTH_LOGOUT: "toastmasters:auth:logout",
  // Phase 31: read live from the packaged app's own package.json via
  // Electron's app.getVersion() — never a hand-maintained renderer constant.
  GET_APP_VERSION: "toastmasters:app:version",
  // Main → renderer stream (one-way): a progress line emitted during a refresh.
  REFRESH_LOG: "toastmasters:refresh:log",
} as const;

/** Which session cookies are currently held (non-empty). */
export interface AuthStatus {
  basecamp: boolean;
  ti: boolean;
}

/**
 * {@link AuthStatus}, plus whether the Basecamp login window gave up (Phase
 * 27) after exhausting its auto-reload retries on Basecamp's own third-party
 * crash without ever capturing the `sessionid` cookie. Mirrors
 * `main/auth.ts`'s `LoginResult` (kept as a separate declaration, like
 * `AuthStatus` above, so this file stays free of a runtime import from
 * `main/auth.ts`); only `AUTH_LOGIN` ever returns it.
 */
export interface LoginResult extends AuthStatus {
  basecampGaveUp?: boolean;
}

/**
 * The IPC analogue of the old web app's (removed in Phase 14)
 * `{ data } | { error: { code, message } }` HTTP envelope. `code` mirrors
 * `QueryResult`'s discriminant where one exists.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** The typed surface exposed on `window.toastmasters` by the preload script. */
export interface ToastmastersBridge {
  listMembers(): Promise<IpcResult<ListMembersResult>>;
  getMember(email: string, pathway: string): Promise<IpcResult<MemberDetail>>;
  getDiff(): Promise<IpcResult<DiffResult>>;
  refreshProgress(): Promise<IpcResult<null>>;
  refreshMembership(): Promise<IpcResult<null>>;
  /** Aborts the in-flight refresh (progress or membership), if any is running. */
  cancelRefresh(): Promise<IpcResult<null>>;
  /** Resolves to the saved file path, or null when the user cancels the dialog. */
  downloadMembershipCsv(): Promise<IpcResult<string | null>>;
  /** Runs the in-app login flow; resolves to which credentials were obtained. */
  login(): Promise<IpcResult<LoginResult>>;
  /** Reports which session cookies are currently held (non-empty). */
  authStatus(): Promise<IpcResult<AuthStatus>>;
  /** Clears the Toastmasters session; resolves to the (now-cleared) status. */
  logout(): Promise<IpcResult<AuthStatus>>;
  /**
   * The packaged app's own version (Phase 31), read live from `app.getVersion()`
   * — shown in the window title and the dashboard heading so a bug report can
   * name a build without the user having to dig up the installer filename.
   */
  getAppVersion(): Promise<IpcResult<string>>;
  /**
   * Subscribes to the live progress lines emitted during a refresh. Returns an
   * unsubscribe function. One-way (main → renderer), so it is not an IpcResult.
   */
  onRefreshLog(listener: (line: string) => void): () => void;
}

export type { DiffResult, ListMembersResult, MemberDetail, MemberSummary };
