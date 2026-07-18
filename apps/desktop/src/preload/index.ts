import { contextBridge, ipcRenderer } from "electron";
import { IPC, type ToastmastersBridge } from "../shared/ipc";

/**
 * The only channel between the renderer and Node. `contextIsolation` is on and
 * `nodeIntegration` is off (see main/index.ts), so the renderer can reach nothing
 * but the functions below — the six web-parity data calls, `cancelRefresh`
 * (Phase 22), the three Electron-only auth calls (`login` / `authStatus` added
 * in Phase 12, `logout` added in Phase 17), and the one-way `onRefreshLog`
 * subscription that streams live refresh progress to the renderer.
 */
const bridge: ToastmastersBridge = {
  listMembers: () => ipcRenderer.invoke(IPC.LIST_MEMBERS),
  getMember: (email, pathway) => ipcRenderer.invoke(IPC.GET_MEMBER, email, pathway),
  getDiff: () => ipcRenderer.invoke(IPC.GET_DIFF),
  refreshProgress: () => ipcRenderer.invoke(IPC.REFRESH_PROGRESS),
  refreshMembership: () => ipcRenderer.invoke(IPC.REFRESH_MEMBERSHIP),
  cancelRefresh: () => ipcRenderer.invoke(IPC.REFRESH_CANCEL),
  downloadMembershipCsv: () => ipcRenderer.invoke(IPC.DOWNLOAD_MEMBERSHIP_CSV),
  downloadProgressCsv: () => ipcRenderer.invoke(IPC.DOWNLOAD_PROGRESS_CSV),
  login: () => ipcRenderer.invoke(IPC.AUTH_LOGIN),
  authStatus: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
  logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
  onRefreshLog: (listener) => {
    // Wrap so the renderer's callback never receives Electron's IpcRendererEvent.
    const handler = (_event: unknown, line: string) => listener(line);
    ipcRenderer.on(IPC.REFRESH_LOG, handler);
    return () => ipcRenderer.removeListener(IPC.REFRESH_LOG, handler);
  },
};

contextBridge.exposeInMainWorld("toastmasters", bridge);
