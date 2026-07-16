import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REPO_ROOT = resolve(__dirname, "../..");
const UI_DIR = resolve(__dirname, "../../packages/ui");

export default defineConfig({
  main: {
    // Externalises everything in `dependencies` — i.e. better-sqlite3, whose native
    // binding must be require()d from the packaged app, not bundled.
    //
    // @toastmasters/core is a *devDependency* precisely so it is NOT externalised:
    // it ships raw .ts with no build step, so `require("@toastmasters/core/db")` at
    // runtime would fail. Vite transpiles and bundles it instead.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      // The renderer reuses packages/ui's components verbatim, and they import
      // through a Next-style "@/*" alias — so "@" must resolve to packages/ui here.
      alias: {
        "@": UI_DIR,
      },
    },
    plugins: [react(), tailwindcss()],
    server: {
      // packages/ui lives outside the renderer root; let the dev server read it.
      fs: { allow: [REPO_ROOT] },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
