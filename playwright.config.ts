import { defineConfig, devices } from "@playwright/test";

const port = 4173;

// Runs against the production build so the service worker is active.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Several WebKit workers rendering PDFs at once starve each other on a dev
  // machine (tests stall past their timeouts); 3 is stable. CI picks its own.
  workers: process.env.CI ? undefined : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}/inspection-app/`,
    trace: "retain-on-failure",
    // Tests start signed in (src/app/signIn.ts); the sign-in screen has its
    // own test. The real username and password stay out of the repo.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${port}`,
          localStorage: [{ name: "hardhat-signed-in", value: "1" }],
        },
      ],
    },
  },
  projects: [
    {
      name: "ipad-webkit",
      use: { ...devices["iPad Pro 11"] },
      // Manual screenshots (@shots) run only when asked for: docs:shots.
      grepInvert: process.argv.some((a) => a.includes("@shots"))
        ? /@offline|@chromium|@phone/
        : /@offline|@chromium|@phone|@shots/,
    },
    {
      // Playwright's WebKit cannot reload a page offline through a service
      // worker, so @offline tests run in Chromium at the iPad viewport.
      // Offline on real iPad Safari is covered by the manual test plan.
      // @chromium tests need what desktop WebKit lacks (OffscreenCanvas in
      // workers, for background page drawing).
      name: "ipad-chromium",
      use: { ...devices["iPad Pro 11"], browserName: "chromium" },
      grep: /@offline|@chromium/,
    },
    // Phone layout (engineer, 2026-11-06): an iPhone (Safari's engine) and
    // an Android phone (Chrome's), @phone tests only.
    {
      name: "iphone-webkit",
      use: { ...devices["iPhone 13"] },
      grep: /@phone/,
    },
    {
      name: "android-chromium",
      use: { ...devices["Pixel 7"] },
      grep: /@phone/,
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}/inspection-app/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
