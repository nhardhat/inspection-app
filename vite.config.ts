import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { pdfjsAssets } from "./pdfjs-assets.plugin.ts";
import { northrop } from "./src/brand/northrop.ts";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  // GitHub Pages serves the app from /inspection-app/. The manifest and
  // service worker scope are derived from this, so keep them relative.
  base: "/inspection-app/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
  },
  build: {
    // pdf-lib + fontkit form one ~1.1 MB chunk, loaded only when a PDF is
    // generated (and precached for offline use).
    chunkSizeWarningLimit: 1200,
  },
  plugins: [
    react(),
    pdfjsAssets(),
    VitePWA({
      strategies: "generateSW",
      // Never reload on its own: an update could interrupt an inspection.
      registerType: "prompt",
      // public/ is already matched by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        // Northrop Hardhat (engineer, 2026-10-07); "Hardhat" fits under
        // the home-screen icon (iOS cuts labels at about 12 letters).
        name: "Northrop Hardhat",
        short_name: "Hardhat",
        description: "Offline site inspection and Site Instruction Memo tool",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "any",
        theme_color: northrop.colours.red,
        background_color: northrop.colours.cream,
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache everything the app needs, including fonts, so it runs
        // with no network at all. TTFs are the fonts embedded in exported PDFs;
        // mjs/bcmap/pfb/wasm/icc are the pdf.js worker and its runtime data.
        globPatterns: [
          "**/*.{js,mjs,css,html,ico,png,svg,woff2,woff,ttf,json,bcmap,pfb,wasm,icc,pdf}",
        ],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        // Workbox skips files over 2 MiB by default, silently: the main
        // bundle is about 1.9 MB, so a little growth would have dropped it
        // from the precache and broken offline use (found 2026-10-20).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
});
