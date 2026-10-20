import { expect, test } from "@playwright/test";
import {
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../src/features/drawings/fixtures/syntheticDrawing";
import { openTab, startInspection, waitForServiceWorker } from "./helpers";

test("loads the shell with Inspections and Settings only", async ({ page }) => {
  await page.goto("./");

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText([
    "Dashboard",
    "Inspections",
    "Settings",
  ]);
  await expect(
    page.getByRole("heading", { name: "Start your first inspection" }),
  ).toBeVisible();
  await expect(page.getByText(/^Version \d+\.\d+\.\d+ \(.+\)$/)).toBeVisible();
  await expect(page.getByTestId("net-status")).toHaveText("Online");
});

test("Settings shows storage and the 13 starter snippets", async ({ page }) => {
  await page.goto("./#/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("snippet-count")).toHaveText(
    "13 snippets (4 body, 2 condition, 2 heading, 1 photo line, 1 refer line, 3 inspection type)",
  );
  await expect(page.getByTestId("storage-used")).not.toHaveText("Checking…");
  // Back up all appears once there are inspections to back up.
  await expect(page.getByText("No inspections to back up yet.")).toBeVisible();
});

// Tagged @offline: runs in the Chromium project only (see playwright.config.ts).
test(
  "still loads after going offline and reloading",
  { tag: "@offline" },
  async ({ page, context }) => {
    await page.goto("./");
    await waitForServiceWorker(page);

    await context.setOffline(true);
    await page.reload();

    await expect(
      page.getByRole("heading", { name: "Start your first inspection" }),
    ).toBeVisible();
    await expect(page.getByTestId("net-status")).toHaveText("Offline");

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByTestId("snippet-count")).toHaveText(
      "13 snippets (4 body, 2 condition, 2 heading, 1 photo line, 1 refer line, 3 inspection type)",
    );

    await context.setOffline(false);
    await expect(page.getByTestId("net-status")).toHaveText("Online");
  },
);

test("makes no requests to other origins", async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL!).origin;
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== appOrigin) {
      external.push(request.url());
    }
  });

  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Start your first inspection" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("snippet-count")).toContainText("13 snippets");
  await page.waitForLoadState("networkidle");

  expect(external).toEqual([]);
});

test("storage: a nearly full iPad is flagged on the Dashboard", async ({
  page,
}) => {
  // Pretend 90% of the app's storage is used.
  await page.addInitScript(() => {
    StorageManager.prototype.estimate = async () => ({
      usage: 900_000_000,
      quota: 1_000_000_000,
    });
  });
  await page.goto("./");
  await startInspection(page, { jobNumber: "SY000001", jobName: "Example" });
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Dashboard" })
    .click();
  await expect(page.getByTestId("storage-warning")).toContainText(
    "Nearly full (90%)",
  );
});

test("storage: when the iPad is full, adding a drawing says so", async ({
  page,
}) => {
  await page.goto("./");
  await startInspection(page, { jobNumber: "SY000001", jobName: "Example" });
  await openTab(page, "Inspection");
  // From now on, saving a file runs out of space.
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "blobs")
        throw new DOMException("full", "QuotaExceededError");
      return add.apply(this, args);
    };
  });
  await page.getByTestId("drawing-file-input").setInputFiles({
    name: "S-101 Level 3.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await buildSyntheticDrawing(TYPICAL_DRAWING)),
  });
  await expect(page.getByRole("alert").first()).toContainText(
    "There isn't enough space on this iPad",
  );
});
