import { vi, describe, it, expect, beforeEach } from "vitest";
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../src/shared/ipc";

/**
 * The preload script is the entire attack surface between the renderer and Node.
 * With contextIsolation on and nodeIntegration off, whatever it exposes on
 * `window.toastmasters` is *all* the renderer can reach — so the exposed shape is
 * a security contract, not a convenience.
 */

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn() },
}));

type Bridge = Record<string, (...args: unknown[]) => unknown>;

/** Imports the preload afresh and returns whatever it handed to contextBridge. */
async function loadPreload(): Promise<{ key: string; bridge: Bridge }> {
  vi.resetModules();
  vi.mocked(contextBridge.exposeInMainWorld).mockClear();
  await import("../src/preload/index");

  const calls = vi.mocked(contextBridge.exposeInMainWorld).mock.calls;
  expect(calls).toHaveLength(1);
  const [key, bridge] = calls[0];
  return { key, bridge: bridge as Bridge };
}

beforeEach(() => vi.clearAllMocks());

describe("preload contextBridge surface", () => {
  it("exposes exactly one global, named toastmasters", async () => {
    const { key } = await loadPreload();
    expect(key).toBe("toastmasters");
  });

  it("exposes exactly the six documented functions and nothing else", async () => {
    const { bridge } = await loadPreload();

    // A literal list on purpose: adding a seventh function to the bridge (i.e.
    // widening what the renderer can reach into Node) must fail this test until
    // someone widens the contract deliberately.
    expect(Object.keys(bridge).sort()).toEqual(
      [
        "listMembers",
        "getMember",
        "getDiff",
        "refreshProgress",
        "refreshMembership",
        "downloadMembershipCsv",
      ].sort(),
    );
  });

  it("exposes only functions — no raw Node objects leak across the bridge", async () => {
    const { bridge } = await loadPreload();

    const nonFunctions = Object.entries(bridge)
      .filter(([, value]) => typeof value !== "function")
      .map(([name]) => name);

    expect(nonFunctions).toEqual([]);
  });

  it("declares exactly six IPC channels", () => {
    expect(Object.values(IPC)).toHaveLength(6);
  });

  it("namespaces every channel under toastmasters:", () => {
    const offenders = Object.values(IPC).filter((c) => !c.startsWith("toastmasters:"));
    expect(offenders).toEqual([]);
  });
});

describe("preload bridges each function to its IPC channel", () => {
  it("listMembers invokes the members:list channel", async () => {
    const { bridge } = await loadPreload();

    bridge.listMembers();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.LIST_MEMBERS);
  });

  it("getMember forwards the email and pathway to the members:get channel", async () => {
    const { bridge } = await loadPreload();

    bridge.getMember("alice@example.com", "Presentation Mastery");

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.GET_MEMBER,
      "alice@example.com",
      "Presentation Mastery",
    );
  });

  it("getDiff invokes the diff:get channel", async () => {
    const { bridge } = await loadPreload();

    bridge.getDiff();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.GET_DIFF);
  });

  it("refreshProgress invokes the refresh:progress channel", async () => {
    const { bridge } = await loadPreload();

    bridge.refreshProgress();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.REFRESH_PROGRESS);
  });

  it("refreshMembership invokes the refresh:membership channel", async () => {
    const { bridge } = await loadPreload();

    bridge.refreshMembership();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.REFRESH_MEMBERSHIP);
  });

  it("downloadMembershipCsv invokes the membership:download channel", async () => {
    const { bridge } = await loadPreload();

    bridge.downloadMembershipCsv();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.DOWNLOAD_MEMBERSHIP_CSV);
  });
});
