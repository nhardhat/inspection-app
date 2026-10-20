import { expect, test, type Page } from "@playwright/test";
import {
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../src/features/drawings/fixtures/syntheticDrawing";
import {
  openInspectionsList,
  openTab,
  startInspection,
  waitForServiceWorker,
} from "./helpers";

const field = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });

async function newInspection(page: Page) {
  await page.goto("./");
  // A new inspection opens on its job details.
  await startInspection(page, { jobNumber: "SY000001", jobName: "" });
  await expect(page).toHaveURL(/#\/inspections\/[0-9a-f-]{36}\/details$/);
  await expect(field(page, "Job number")).toHaveValue("SY000001");
}

async function fillJob(page: Page) {
  await field(page, "Job number").fill("SY000001");
  await field(page, "Job name").fill("Example Apartments");
  await field(page, "Item inspected").fill("Level 3 slab reinforcement");
  await field(page, "Client name").fill("Alex Example");
  await field(page, "Client company").fill("Example Builders Pty Ltd");
  await field(page, "Address line 1").fill("1 Sample Street");
  await field(page, "Address line 2").fill("Exampleville NSW 2000");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
}

test("creates an inspection, autosaves every field and keeps it after reload", async ({
  page,
}) => {
  await newInspection(page);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await expect(field(page, "Date")).toHaveValue(today);
  await expect(page.getByTestId("missing-fields")).toHaveText(
    "Job name is needed before a memo can be created.",
  );

  await fillJob(page);
  await expect(page.getByTestId("inspection-title")).toHaveText(
    "SY000001 – Example Apartments",
  );
  await expect(page.getByTestId("missing-fields")).toHaveCount(0);

  await page.reload();
  await expect(field(page, "Job number")).toHaveValue("SY000001");
  await expect(field(page, "Client company")).toHaveValue(
    "Example Builders Pty Ltd",
  );
  await expect(field(page, "Address line 2")).toHaveValue(
    "Exampleville NSW 2000",
  );
  await expect(field(page, "Item inspected")).toHaveValue(
    "Level 3 slab reinforcement",
  );

  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await openInspectionsList(page);
  const card = page
    .getByRole("list", { name: "Recent inspections" })
    .getByRole("listitem")
    .filter({ hasText: "SY000001 – Example Apartments" });
  await expect(card).toContainText("Example Builders Pty Ltd");
  // The Dashboard's Continue tile shows when it was edited.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Dashboard" })
    .click();
  const continueTile = page.getByRole("region", {
    name: "Continue where you left off",
  });
  await expect(continueTile).toContainText(/Edited (just now|\d+ min ago)/);
  // Any step opens from the tile; the suggested next one is marked.
  const steps = continueTile.getByRole("navigation", { name: "Open a step" });
  await expect(steps.getByRole("link")).toHaveText([
    "Pre-inspection",
    "Inspection",
    "Site memo",
  ]);
  await expect(steps.locator(".suggested")).toHaveCount(1);
  await steps.getByRole("link", { name: "Site memo" }).click();
  await expect(page).toHaveURL(/\/memo/);
});

test("saves an edit made just before leaving the screen", async ({ page }) => {
  await newInspection(page);
  const url = page.url();
  await field(page, "Job name").fill("Quick edit");
  // Leave immediately, before the autosave delay has passed.
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await openInspectionsList(page);
  await expect(
    page.getByRole("list", { name: "Recent inspections" }),
  ).toContainText("Quick edit");
  await page.goto(url);
  await expect(field(page, "Job name")).toHaveValue("Quick edit");
});

test("deletes an inspection only after confirming", async ({ page }) => {
  await newInspection(page);
  await fillJob(page);

  // Deleting lives on Pre-inspection (not on the home screen's rows).
  const deleteButton = page.getByRole("button", { name: "Delete inspection" });
  await deleteButton.click();
  const dialog = page.getByRole("dialog", { name: "Delete inspection?" });
  await expect(dialog).toContainText("SY000001 – Example Apartments");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await openInspectionsList(page);
  await expect(
    page
      .getByRole("list", { name: "Recent inspections" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /^Delete SY000001/ }),
  ).toHaveCount(0);

  await page
    .getByRole("list", { name: "Recent inspections" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Inspection sections" })
    .getByRole("link", { name: "Pre-inspection", exact: true })
    .click();
  await deleteButton.click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  // The project is still there, so Recent says it's empty.
  await expect(page.getByText("No inspections yet")).toBeVisible();
});

test("swiping a recent inspection left deletes it after a confirm", async ({
  page,
}) => {
  await newInspection(page);
  await fillJob(page);
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await openInspectionsList(page);
  const rows = page
    .getByRole("list", { name: "Recent inspections" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(1);

  // Drag the row left with the mouse: Delete shows (and the row's link
  // doesn't open).
  const box = (await rows.first().boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 200, y, { steps: 10 });
  await page.mouse.up();
  await expect(page).toHaveURL(/#\/inspections$/);
  const remove = page.getByRole("button", {
    name: "Delete Level 3 slab reinforcement",
  });
  await expect(remove).toBeVisible();

  // It asks first; Cancel keeps it.
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Delete inspection?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(rows).toHaveCount(1);

  await page.mouse.move(box.x + box.width - 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 200, y, { steps: 10 });
  await page.mouse.up();
  await remove.click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No inspections yet")).toBeVisible();
});

test("deletes from the inspection screen", async ({ page }) => {
  await newInspection(page);
  await page.getByRole("button", { name: "Delete inspection" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page).toHaveURL(/#\/inspections$/);
  await expect(page.getByText("No inspections yet")).toBeVisible();
});

test("new inspections take the inspector from My details", async ({ page }) => {
  await page.goto("./#/settings");
  await field(page, "Inspector name").fill("Test Engineer");
  await field(page, "Title").fill("Structural Engineer");
  await expect(page.getByTestId("settings-save-state")).toHaveText("Saved");

  await page.reload();
  await expect(field(page, "Inspector name")).toHaveValue("Test Engineer");

  await newInspection(page);
  await expect(field(page, "Inspector")).toHaveValue("Test Engineer");
});

test("an inspection has Pre-inspection, Inspection and Site memo tabs", async ({
  page,
}) => {
  await newInspection(page);
  await fillJob(page);
  const tabs = page.getByRole("navigation", { name: "Inspection sections" });
  const tab = (name: string) => tabs.getByRole("link", { name, exact: true });
  await expect(tab("Pre-inspection")).toHaveAttribute("aria-current", "page");

  // Opening it again goes to the Inspection tab.
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await openInspectionsList(page);
  await page
    .getByRole("list", { name: "Recent inspections" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/inspection$/);
  await expect(tab("Inspection")).toHaveAttribute("aria-current", "page");
  // No drawings yet: the step starts by adding them.
  await expect(page.getByRole("heading", { name: "Drawings" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add drawings" }),
  ).toBeVisible();
  await expect(field(page, "Job number")).toHaveCount(0);

  await openTab(page, "Site memo");
  await expect(tab("Site memo")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Create memo" })).toBeEnabled();
  // Photos live here, grouped as in the appendix.
  await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();

  await openTab(page, "Pre-inspection");
  await expect(field(page, "Job number")).toHaveValue("SY000001");
  await expect(
    page.getByRole("button", { name: "Delete inspection" }),
  ).toBeVisible();
});

// Tagged @offline: runs in the Chromium project only (see playwright.config.ts).
test(
  "creates and saves an inspection offline",
  { tag: "@offline" },
  async ({ page, context }) => {
    await page.goto("./");
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.reload();

    await startInspection(page, { jobNumber: "SY000001", jobName: "" });
    await fillJob(page);
    await page.reload();
    await expect(field(page, "Job number")).toHaveValue("SY000001");
  },
);

test("the Inspections tab returns to where you left off", async ({ page }) => {
  await newInspection(page);
  await openTab(page, "Site memo");
  const rail = page.getByRole("navigation", { name: "Main" });
  await rail.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  // Back to Inspections: the same inspection and step.
  await rail.getByRole("link", { name: "Inspections" }).click();
  await expect(page).toHaveURL(/\/memo$/);
  // Tapped again while in Inspections: the list.
  await rail.getByRole("link", { name: "Inspections" }).click();
  await expect(page).toHaveURL(/#\/inspections$/);
});

test("drawings can be added on Pre-inspection, before going to site", async ({
  page,
}) => {
  await newInspection(page);
  await expect(page.getByRole("heading", { name: "Drawings" })).toBeVisible();
  await page.getByTestId("drawing-file-input").setInputFiles({
    name: "S-101 Level 3.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await buildSyntheticDrawing(TYPICAL_DRAWING)),
  });
  const list = page.getByRole("list", { name: "Drawings" });
  await expect(list).toContainText("S-101 Level 3", { timeout: 20_000 });
  // Tapping it opens the drawings at it.
  await list.getByRole("button", { name: /^S-101 Level 3/ }).click();
  await expect(page).toHaveURL(/\/inspection\?drawing=/);
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });
});

test("inspection types add their general notes; removing asks if edited", async ({
  page,
}) => {
  await page.goto("./");
  await startInspection(page, { jobNumber: "SY000001", jobName: "Example" });
  const types = page.getByRole("group", { name: "Inspection type" });
  const concrete = types.getByRole("button", { name: "General concrete" });
  await concrete.click();
  await expect(concrete).toHaveAttribute("aria-pressed", "true");

  // Its note is a general note on the inspection.
  await openTab(page, "Inspection");
  await page
    .getByRole("button", { name: "Add synthetic test drawing" })
    .click();
  await page.getByRole("button", { name: /^Items/ }).click();
  const note = page.getByRole("listitem").filter({
    hasText: "[Add general concrete notes in Settings]",
  });
  await expect(note).toHaveCount(1);

  // Removed again: the note goes (it wasn't edited).
  await openTab(page, "Pre-inspection");
  await concrete.click();
  await expect(concrete).toHaveAttribute("aria-pressed", "false");
  await openTab(page, "Inspection");
  await page.getByRole("button", { name: /^Items/ }).click();
  await expect(note).toHaveCount(0);
});

test("Settings, About: version, documents (bundled) and what's new", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" })
    .click();
  const about = page.getByRole("region", { name: "About" });
  await expect(about).toContainText("Northrop Hardhat");
  await expect(about).toContainText("Built by David Samson");
  await expect(about).toContainText(/Version \d+\.\d+\.\d+/);
  for (const name of ["User guide", "Features and limitations"]) {
    const button = about.getByRole("button", { name: new RegExp(`^${name}`) });
    const href = (await button.getAttribute("data-href"))!;
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
  }
  // Opened in the app's viewer, with Back to return.
  await about.getByRole("button", { name: /^User guide/ }).click();
  const viewer = page.getByRole("dialog", { name: "User guide" });
  await expect(viewer.getByRole("img", { name: "Page 1" })).toBeVisible({
    timeout: 20_000,
  });
  // Zoomed in, the part on screen is redrawn sharp, at true screen size.
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByTestId("pdf-viewer-zoom")).toHaveText("225%");
  const sharp = viewer.locator("canvas.pdf-viewer-sharp").first();
  await expect(sharp).toBeAttached({ timeout: 15_000 });
  const { cssWidth, pixels, dpr } = await sharp.evaluate((c) => ({
    cssWidth: (c as HTMLCanvasElement).getBoundingClientRect().width,
    pixels: (c as HTMLCanvasElement).width,
    dpr: window.devicePixelRatio,
  }));
  expect(Math.abs(cssWidth * dpr - pixels)).toBeLessThan(dpr * 2);
  // Back to fit: no sharp copy needed.
  await viewer.getByRole("button", { name: "Zoom out" }).click();
  await viewer.getByRole("button", { name: "Zoom out" }).click();
  await expect(viewer.getByTestId("pdf-viewer-zoom")).toHaveText("100%");
  await expect(viewer.locator("canvas.pdf-viewer-sharp")).toHaveCount(0);
  await viewer.getByRole("button", { name: "Back" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(
    about.getByRole("heading", { name: "What's new" }),
  ).toBeVisible();
});
