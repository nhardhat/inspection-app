import { expect, test } from "@playwright/test";
import { waitForServiceWorker } from "./helpers";

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

test("Settings shows storage and the 10 starter snippets", async ({ page }) => {
  await page.goto("./#/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("snippet-count")).toHaveText(
    "10 snippets (4 body, 2 condition, 2 heading, 1 photo line, 1 refer line)",
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
      "10 snippets (4 body, 2 condition, 2 heading, 1 photo line, 1 refer line)",
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
  await expect(page.getByTestId("snippet-count")).toContainText("10 snippets");
  await page.waitForLoadState("networkidle");

  expect(external).toEqual([]);
});
