import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import {
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../src/features/drawings/fixtures/syntheticDrawing";
import {
  openTab,
  stageBox,
  startInspection,
  waitForServiceWorker,
  pinToolOn,
} from "./helpers";

const field = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });

/** An inspection in project SY000001 (`existing`: already made). */
async function newInspection(page: Page, existing = false) {
  await page.goto("./");
  await startInspection(page, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    existing,
  });
  await field(page, "Item inspected").fill("Level 3 slab reinforcement");
  await field(page, "Client name").fill("Alex Example");
  await field(page, "Client company").fill("Example Builders Pty Ltd");
  await field(page, "Inspector").fill("Test Engineer");
  await field(page, "Date").fill("2026-10-01");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await openTab(page, "Inspection");
  return page.url();
}

/** Site memo tab, then Create memo. */
async function createMemo(page: Page) {
  await openTab(page, "Site memo");
  await page.getByRole("button", { name: "Create memo" }).click();
}

/** Two instructions (A needs photo confirmation) and one observation. */
async function addItems(page: Page) {
  await page.getByTestId("drawing-file-input").setInputFiles({
    name: "S-101 Level 3.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await buildSyntheticDrawing(TYPICAL_DRAWING)),
  });
  await expect(page.getByTestId("drawings-status")).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  const sheet = page.getByTestId("item-sheet");
  for (const [fx, text, kind] of [
    [0.2, "Add N12 bar at grid C/4", "instruction"],
    [0.4, "Prop spacing per shop drawing", "instruction"],
    [0.6, "Existing crack noted at grid 4", "observation"],
  ] as const) {
    const box = await stageBox(page);
    await pinToolOn(page);
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * 0.5);
    await expect(sheet.getByRole("textbox")).toBeFocused();
    if (kind === "observation")
      await sheet
        .getByRole("button", { name: "Observation", exact: true })
        .click();
    await sheet.getByRole("textbox").fill(text);
    if (fx === 0.2)
      await sheet
        .getByLabel("Photo confirmation required before proceeding")
        .check();
    await expect(page.getByTestId("item-save-state")).toHaveText("Saved");
    await sheet.getByRole("button", { name: "Done" }).first().click();
  }
}

test("create a memo from the instructions, with a live preview", async ({
  page,
}) => {
  const home = await newInspection(page);
  await addItems(page);
  await page.goto(home);

  await createMemo(page);
  await expect(page).toHaveURL(/\/memo$/);
  await expect(field(page, "Reference")).toHaveValue("SIM001");
  await expect(
    page.locator('[data-testid="memo-preview"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });

  // Defaults from the client and recipients.
  await expect(field(page, "Salutation")).toHaveValue("Dear Alex,");
  await expect(field(page, "Site visit requested by")).toHaveValue(
    "Alex Example, Example Builders Pty Ltd",
  );
  await expect(page.getByTestId("memo-paragraph-1")).toHaveText(
    "We confirm having inspected the Level 3 slab reinforcement as highlighted on the drawing attached.",
  );

  // Conditions: standard first. A needs photos: A is marked *, the lead-in
  // says what * means, and the general photo condition stays off.
  await expect(page.getByTestId("memo-lead-in")).toHaveText(
    "Ok to proceed subject to the following. Items marked * to be closed out with photos:",
  );
  await expect(
    page.getByLabel("Complete items A–B listed below."),
  ).toBeChecked();
  await expect(
    page.getByLabel(
      "Confirm completion of items via photos prior to proceeding.",
    ),
  ).not.toBeChecked();
  const instructions = page.getByRole("list", { name: "Instructions" });
  await expect(instructions.getByRole("listitem")).toHaveCount(2);
  await expect(instructions.getByTestId("memo-photo-mark")).toHaveCount(1);

  // Reword A for the memo only, then go back to the item's text.
  const a = page.getByLabel("Instruction A in the memo");
  await expect(a).toHaveValue("Add N12 bar at grid C/4");
  await a.fill("Add N16 bar at grid C/4");
  await expect(instructions).toContainText("reworded for this memo");
  await page.getByRole("button", { name: "Use item text" }).click();
  await expect(a).toHaveValue("Add N12 bar at grid C/4");

  // Refer to drawings: one line instead of the list; the lead-in keeps *.
  await page.getByLabel(/Refer to drawings/).check();
  await expect(instructions).toHaveCount(0);
  await expect(page.getByTestId("memo-refer-line")).toHaveText(
    "Complete the instructions marked on the attached drawings (items A–B).",
  );
  await expect(page.getByTestId("memo-lead-in")).toHaveText(
    "Ok to proceed subject to the following. Items marked * to be closed out with photos:",
  );
  await page.getByLabel(/Refer to drawings/).uncheck();
  await expect(instructions.getByRole("listitem")).toHaveCount(2);

  // Job details are shared with the inspection; they fold to a summary.
  await expect(field(page, "Item inspected")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit job details" }).click();
  await field(page, "Item inspected").fill("Level 3 slab");
  await expect(page.getByTestId("memo-paragraph-1")).toContainText(
    "the Level 3 slab as",
  );
  await expect(page.getByTestId("memo-save-state")).toHaveText("Saved", {
    // The PDF preview redraws after each edit, slow on a busy test machine.
    timeout: 15_000,
  });
  await openTab(page, "Pre-inspection");
  await expect(field(page, "Item inspected")).toHaveValue("Level 3 slab");

  // Edits are kept; the tab opens the memo once there is one.
  await openTab(page, "Site memo");
  await expect(
    page.getByRole("heading", { name: "Site Instruction Memo · SIM001" }),
  ).toBeVisible();
  await field(page, "Salutation").fill("Hi Alex,");
  await expect(page.getByTestId("memo-save-state")).toHaveText("Saved", {
    // The PDF preview redraws after each edit, slow on a busy test machine.
    timeout: 15_000,
  });
  await page.reload();
  await expect(field(page, "Salutation")).toHaveValue("Hi Alex,");
});

test("a memo needs a job number and name; references count per job", async ({
  page,
}) => {
  // No project yet: no memo.
  await page.goto("./");
  await startInspection(page, null);
  await openTab(page, "Site memo");
  await expect(
    page.getByRole("button", { name: "Create memo" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Put this inspection in a project"),
  ).toBeVisible();

  await newInspection(page);
  await createMemo(page);
  await expect(field(page, "Reference")).toHaveValue("SIM001");
  // No instructions: the memo says Ok to proceed.
  await expect(page.getByTestId("memo-lead-in")).toHaveText("Ok to proceed.");

  await newInspection(page, true);
  await createMemo(page);
  await expect(field(page, "Reference")).toHaveValue("SIM002");
});

// Tagged @offline: runs in the Chromium project only (see playwright.config.ts).
test(
  "the memo and its preview work offline",
  { tag: "@offline" },
  async ({ page, context }) => {
    await page.goto("./");
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.reload();

    await newInspection(page);
    await createMemo(page);
    // Fonts and images come from the precache.
    await expect(
      page.locator('[data-testid="memo-preview"][data-ready="true"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("memo-preview")).toHaveAttribute(
      "data-pages",
      "1",
    );
  },
);

test("prefilled messages are edited in Settings and offered in the memo", async ({
  page,
}) => {
  await page.goto("./#/settings");
  const bodies = page.getByRole("region", { name: "Memo messages" });
  await expect(bodies.getByTestId("snippet-row")).toHaveCount(4);
  await bodies.getByRole("button", { name: "Add" }).click();
  await expect(bodies.getByTestId("snippet-row")).toHaveCount(5);
  // The new message opens ready to type (wherever it sits in the list).
  const added = bodies.locator('[data-testid="snippet-row"][data-new="true"]');
  await added.getByLabel(/^Name of/).fill("Partly complete");
  await added
    .getByLabel(/^Text of/)
    .fill("At the time of the inspection the works were partly complete.");
  await expect(added).toContainText("Saved");

  // Reword a standard condition.
  const conditions = page.getByRole("region", { name: "Standard conditions" });
  const photo = conditions.getByTestId("snippet-row").nth(1);
  await photo.locator("summary").click();
  await photo
    .getByLabel(/^Text of/)
    .fill("Provide photos of completed items before proceeding.");
  await expect(photo).toContainText("Saved");

  // The memo offers the new message, and ticks the reworded condition.
  await newInspection(page);
  await createMemo(page);
  await page
    .getByLabel("Prefilled message")
    .selectOption({ label: "Partly complete" });
  await expect(page.getByLabel("Message text (for this memo)")).toHaveValue(
    "At the time of the inspection the works were partly complete.",
  );
  await expect(
    page.getByLabel("Provide photos of completed items before proceeding."),
  ).toBeVisible();

  // Deleting asks first.
  await page.goto("./#/settings");
  const last = bodies
    .getByTestId("snippet-row")
    .filter({ hasText: "Partly complete" });
  await last.locator("summary").click();
  await last.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: /^Delete "Partly complete"/ })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(bodies.getByTestId("snippet-row")).toHaveCount(4);
});

test("prefilled message boxes use body-size text and grow to fit", async ({
  page,
}) => {
  await page.goto("./#/settings");
  // Messages are folded: open the first.
  await page.getByTestId("snippet-row").first().locator("summary").click();
  const text = page.getByLabel(/^Text of/).first();
  await expect(text).toHaveCSS("font-size", "16px");
  const before = (await text.boundingBox())!.height;
  await text.fill("A long message. ".repeat(40));
  await expect
    .poll(async () => (await text.boundingBox())!.height)
    .toBeGreaterThan(before);
  // All of the text shows without scrolling inside the box.
  expect(
    await text.evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThanOrEqual(1);
});

/** Signs the open signing pad with a mouse scribble. */
async function scribble(page: Page) {
  const box = (await page.getByTestId("signature-pad").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++)
    await page.mouse.move(
      box.x + box.width * (0.2 + i * 0.03),
      box.y + box.height * (0.6 - 0.3 * Math.sin(i / 2)),
    );
  await page.mouse.up();
}

test("a signature drawn in Settings goes on new memos; a memo can upload its own or leave it off", async ({
  page,
}) => {
  await page.goto("./#/settings");
  const mine = page.getByRole("group", { name: "My signature" });
  await mine.getByRole("button", { name: "Draw signature" }).click();
  const dialog = page.getByRole("dialog", { name: "Draw your signature" });
  await scribble(page);
  await expect(page.getByTestId("signature-pad")).toHaveAttribute(
    "data-ink",
    "true",
  );
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(mine.getByRole("img", { name: "My signature" })).toBeVisible();

  await newInspection(page);
  await createMemo(page);
  const onMemo = page.getByRole("group", { name: "Signature on this memo" });
  await expect(
    onMemo.getByRole("img", { name: "Signature on this memo" }),
  ).toBeVisible();
  await expect(page.getByLabel("Include signature")).toBeChecked();

  // Upload a photo of a signature on white paper instead.
  const drawnSrc = await onMemo
    .getByRole("img", { name: "Signature on this memo" })
    .getAttribute("src");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 100;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 300, 100);
    ctx.strokeStyle = "#123";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(40, 70);
    ctx.bezierCurveTo(90, 10, 160, 90, 260, 30);
    ctx.stroke();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("signature-file-input").setInputFiles({
    name: "signature.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const img = onMemo.getByRole("img", { name: "Signature on this memo" });
  await expect(img).not.toHaveAttribute("src", drawnSrc!);
  // The white paper was made see-through and cropped away.
  const corner = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const c = document.createElement("canvas");
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(el, 0, 0);
    return {
      alpha: ctx.getImageData(0, 0, 1, 1).data[3],
      width: el.naturalWidth,
    };
  });
  expect(corner.alpha).toBe(0);
  expect(corner.width).toBeLessThan(300);

  await expect(
    page.locator('[data-testid="memo-preview"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Include signature").uncheck();
  await expect(page.getByTestId("memo-save-state")).toHaveText("Saved", {
    // The PDF preview redraws after each edit, slow on a busy test machine.
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByLabel("Include signature")).not.toBeChecked();
  await expect(
    onMemo.getByRole("img", { name: "Signature on this memo" }),
  ).toBeVisible();
});

test("export the defect register (Excel)", async ({ page }) => {
  await page.addInitScript(() => {
    const shared: { name: string; size: number }[] = [];
    Object.assign(window, { sharedFiles: shared });
    Object.defineProperty(navigator, "canShare", {
      value: (data: { files?: File[] }) => !!data.files?.length,
    });
    Object.defineProperty(navigator, "share", {
      value: async (data: { files: File[] }) => {
        for (const f of data.files) shared.push({ name: f.name, size: f.size });
      },
    });
  });
  const home = await newInspection(page);
  await addItems(page);
  await page.goto(home);
  await createMemo(page);
  const register = page.getByTestId("defect-register");
  await register
    .getByRole("button", { name: "Export defect register" })
    .click();
  await expect(register).toContainText(
    "SY000001-SIM001-A-Level 3 slab reinforcement - Defect register.xlsx",
    { timeout: 30_000 },
  );
  await register.getByRole("button", { name: "Share register…" }).click();
  const shared = await page.evaluate(
    () =>
      (window as unknown as { sharedFiles: { name: string; size: number }[] })
        .sharedFiles,
  );
  expect(shared).toHaveLength(1);
  expect(shared[0].size).toBeGreaterThan(3000);
});

test("export the PDF pack: memo then the marked-up page; warns when letters change after", async ({
  page,
}) => {
  // Stand-in Share sheet that keeps the shared PDF's bytes.
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
  const home = await newInspection(page);
  await addItems(page);
  await page.goto(home);
  await createMemo(page);

  const card = page.getByTestId("export-card");
  await expect(card).toContainText("1 page with pins");
  await expect(card).toContainText("No photos");
  await card.getByRole("button", { name: "Export PDF" }).click();
  const file = card.getByTestId("export-file");
  await expect(file).toContainText(
    "SY000001-SIM001-A-Level 3 slab reinforcement.pdf",
    { timeout: 30_000 },
  );
  await expect(file).toContainText("2 pages");
  await card.getByRole("button", { name: "Share…" }).click();
  const shared = await page.evaluate(
    () =>
      (
        window as unknown as {
          sharedFiles: { name: string; bytes: number[] }[];
        }
      ).sharedFiles,
  );
  expect(shared).toHaveLength(1);
  const pdf = await PDFDocument.load(Uint8Array.from(shared[0].bytes));
  expect(pdf.getPages().map((p) => Math.round(p.getSize().width))).toEqual([
    595, 2384,
  ]);

  // Preview shows the pages at their sizes relative to each other (the A4
  // memo a quarter as wide as the A1 drawing), labelled, with Share.
  await card.getByRole("button", { name: "Preview" }).click();
  const viewer = page.getByTestId("pdf-viewer");
  await expect(viewer.locator("figcaption")).toHaveText([
    /Page 1 · A4 \(210 × 297 mm\)/,
    /Page 2 · A1 \(841 × 594 mm\)/,
  ]);
  const [memoPage, drawingPage] = await viewer
    .locator("figure")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(memoPage / drawingPage).toBeCloseTo(595 / 2384, 2);
  await expect(viewer.getByRole("button", { name: "Share…" })).toBeEnabled();
  await viewer.getByRole("button", { name: "Back" }).click();
  await expect(viewer).toHaveCount(0);

  // Deleting instruction A re-letters B: the viewer says so once, and the
  // Export card lists the change until it is exported again.
  await openTab(page, "Inspection");
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("button", { name: "Instruction pin A", exact: true })
    .click();
  await page
    .getByTestId("item-sheet")
    .getByRole("button", { name: /^Delete instruction / })
    .click();
  await expect(page.getByTestId("letters-changed-notice")).toBeVisible();
  await page.getByTestId("letters-changed-notice").click();
  await expect(page.getByTestId("letters-changed-notice")).toHaveCount(0);

  await openTab(page, "Site memo");
  await expect(page.getByTestId("letters-changed")).toContainText(
    "Instruction A was deleted; Instruction B is now Instruction A",
  );
  await page
    .getByTestId("export-card")
    .getByRole("button", { name: "Export PDF" })
    .click();
  await expect(page.getByTestId("export-file")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("letters-changed")).toHaveCount(0);
});
