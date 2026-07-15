import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REPO_ROOT = resolve(__dirname, "../..");
const WEB_DIR = resolve(__dirname, "../web");

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
      // The renderer reuses the web app's components verbatim, and they import
      // through Next's "@/*" alias — so "@" must resolve to apps/web here.
      alias: {
        "@": WEB_DIR,
      },
    },
    plugins: [react(), tailwindcss()],
    server: {
      // apps/web lives outside the renderer root; let the dev server read it.
      fs: { allow: [REPO_ROOT] },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
