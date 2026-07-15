import { contextBridge, ipcRenderer } from "electron";
import { IPC, type ToastmastersBridge } from "../shared/ipc";

/**
 * The only channel between the renderer and Node. `contextIsolation` is on and
 * `nodeIntegration` is off (see main/index.ts), so the renderer can reach nothing
 * but the six functions below — each a 1:1 replacement for one `fetch("/api/…")`
 * call in the web app.
 */
const bridge: ToastmastersBridge = {
  listMembers: () => ipcRenderer.invoke(IPC.LIST_MEMBERS),
  getMember: (email, pathway) => ipcRenderer.invoke(IPC.GET_MEMBER, email, pathway),
  getDiff: () => ipcRenderer.invoke(IPC.GET_DIFF),
  refreshProgress: () => ipcRenderer.invoke(IPC.REFRESH_PROGRESS),
  refreshMembership: () => ipcRenderer.invoke(IPC.REFRESH_MEMBERSHIP),
  downloadMembershipCsv: () => ipcRenderer.invoke(IPC.DOWNLOAD_MEMBERSHIP_CSV),
};

contextBridge.exposeInMainWorld("toastmasters", bridge);
