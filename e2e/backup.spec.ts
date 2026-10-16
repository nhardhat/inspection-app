import { expect, test, type Page } from "@playwright/test";
import {
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../src/features/drawings/fixtures/syntheticDrawing";
import {
  openInspectionsList,
  openTab,
  stageBox,
  startInspection,
  pinToolOn,
  waitForServiceWorker,
} from "./helpers";

/** A stand-in Share sheet that keeps each shared file's name and bytes. */
async function stubShareSheet(page: Page) {
  await page.addInitScript(() => {
    const shared: { name: string; bytes: number[] }[] = [];
    Object.assign(window, { sharedFiles: shared });
    Object.defineProperty(navigator, "canShare", {
      value: (data: { files?: File[] }) => !!data.files?.length,
    });
    Object.defineProperty(navigator, "share", {
      value: async (data: { files: File[] }) => {
        for (const f of data.files)
          shared.push({
            name: f.name,
            bytes: Array.from(new Uint8Array(await f.arrayBuffer())),
          });
      },
    });
  });
}

const sharedFiles = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          sharedFiles: { name: string; bytes: number[] }[];
        }
      ).sharedFiles,
  );

test("back up an inspection, delete it, import it back; importing again asks", async ({
  page,
}) => {
  await stubShareSheet(page);
  await page.goto("./");
  await startInspection(page, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
  });
  await page
    .getByLabel("Item inspected", { exact: true })
    .fill("Level 3 slab reinforcement");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");

  // A drawing and a pin.
  await openTab(page, "Inspection");
  await page.getByTestId("drawing-file-input").setInputFiles({
    name: "S-101 Level 3.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await buildSyntheticDrawing(TYPICAL_DRAWING)),
  });
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  const box = await stageBox(page);
  await pinToolOn(page);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  const sheet = page.getByTestId("item-sheet");
  await sheet.getByRole("textbox").fill("Add N12 bar");
  await expect(page.getByTestId("item-save-state")).toHaveText("Saved");
  await sheet.getByRole("button", { name: "Done" }).first().click();

  // Back up from Pre-inspection.
  await openTab(page, "Pre-inspection");
  const card = page.getByTestId("backup-card");
  await expect(card.getByTestId("backup-status")).toHaveText(
    "Not backed up yet",
  );
  await card.getByRole("button", { name: "Back up now" }).click();
  await expect(card.getByTestId("backup-file")).toContainText(
    "SY000001_Level-3-slab-reinforcement_",
  );
  await card.getByRole("button", { name: "Share…" }).click();
  await expect(card.getByTestId("backup-status")).toHaveText("Backed up");
  const [file] = await sharedFiles(page);
  expect(file.name).toMatch(/\.inspection$/);

  // Delete it, then import the file.
  await page.getByRole("button", { name: "Delete inspection" }).click();
  await page
    .getByRole("dialog", { name: "Delete inspection?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await openInspectionsList(page);
  const input = page.getByTestId("import-file-input");
  const upload = {
    name: file.name,
    mimeType: "application/zip",
    buffer: Buffer.from(file.bytes),
  };
  await input.setInputFiles(upload);
  const dialog = page.getByRole("dialog", {
    name: /Import .Level 3 slab reinforcement./,
  });
  await expect(dialog).toContainText("SY000001 – Example Apartments");
  await expect(dialog).toContainText("1 drawing");
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/details$/);
  await expect(page.getByLabel("Item inspected", { exact: true })).toHaveValue(
    "Level 3 slab reinforcement",
  );
  await expect(page.getByTestId("backup-status")).toHaveText("Backed up");

  // The pin came back with its text.
  await openTab(page, "Inspection");
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1, {
    timeout: 20_000,
  });

  // Importing the same file again asks; Keep both makes a second copy.
  await openInspectionsList(page);
  await input.setInputFiles(upload);
  await expect(dialog.getByTestId("import-exists")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Replace" })).toBeVisible();
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(page).toHaveURL(/\/details$/);
  await openInspectionsList(page);
  await expect(
    page
      .getByRole("list", { name: "Recent inspections" })
      .getByRole("listitem"),
  ).toHaveCount(2);

  // Not an inspection file: a clear message.
  await input.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "This isn't an inspection file.",
  );
});

// Step 10e: everything after the drawings are in works with no network.
// Tagged @offline: runs in the Chromium project only (see playwright.config.ts).
test(
  "offline: export the PDF pack, back up and import",
  { tag: "@offline" },
  async ({ page, context }) => {
    await stubShareSheet(page);
    await page.goto("./");
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.reload();

    await startInspection(page, {
      jobNumber: "SY000001",
      jobName: "Example Apartments",
    });
    await page
      .getByLabel("Item inspected", { exact: true })
      .fill("Level 3 slab reinforcement");
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await openTab(page, "Inspection");
    await page.getByTestId("drawing-file-input").setInputFiles({
      name: "S-101 Level 3.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildSyntheticDrawing(TYPICAL_DRAWING)),
    });
    await expect(
      page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
    ).toBeVisible({ timeout: 20_000 });
    const box = await stageBox(page);
    await pinToolOn(page);
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    const sheet = page.getByTestId("item-sheet");
    await sheet.getByRole("textbox").fill("Add N12 bar");
    await expect(page.getByTestId("item-save-state")).toHaveText("Saved");
    await sheet.getByRole("button", { name: "Done" }).first().click();

    // The memo and the PDF pack.
    await openTab(page, "Site memo");
    await page.getByRole("button", { name: "Create memo" }).click();
    const exportCard = page.getByTestId("export-card");
    await exportCard.getByRole("button", { name: "Export PDF" }).click();
    await expect(exportCard.getByTestId("export-file")).toContainText(
      "SY000001-SIM001-A-Level 3 slab reinforcement.pdf",
      { timeout: 30_000 },
    );
    await exportCard.getByRole("button", { name: "Share…" }).click();

    // The backup.
    await openTab(page, "Pre-inspection");
    const card = page.getByTestId("backup-card");
    await card.getByRole("button", { name: "Back up now" }).click();
    await card.getByRole("button", { name: "Share…" }).click();
    await expect(card.getByTestId("backup-status")).toHaveText("Backed up");
    const files = await sharedFiles(page);
    expect(files.map((f) => f.name)).toEqual([
      "SY000001-SIM001-A-Level 3 slab reinforcement.pdf",
      expect.stringMatching(/\.inspection$/),
    ]);

    // Delete it and import the backup, still offline.
    await page.getByRole("button", { name: "Delete inspection" }).click();
    await page
      .getByRole("dialog", { name: "Delete inspection?" })
      .getByRole("button", { name: "Delete" })
      .click();
    await openInspectionsList(page);
    await page.getByTestId("import-file-input").setInputFiles({
      name: files[1].name,
      mimeType: "application/zip",
      buffer: Buffer.from(files[1].bytes),
    });
    await page
      .getByRole("dialog", { name: /Import .Level 3 slab reinforcement./ })
      .getByRole("button", { name: "Import" })
      .click();
    await expect(page).toHaveURL(/\/details$/);
    await openTab(page, "Inspection");
    await expect(page.getByTestId("viewer-pin")).toHaveCount(1, {
      timeout: 20_000,
    });
  },
);
