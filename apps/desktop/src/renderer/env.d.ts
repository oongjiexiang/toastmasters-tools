/// <reference types="vite/client" />

import type { ToastmastersBridge } from "../shared/ipc";

declare global {
  interface Window {
    /** Injected by the preload script's contextBridge. */
    toastmasters: ToastmastersBridge;
  }
}

export {};
