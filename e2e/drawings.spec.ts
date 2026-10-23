import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../src/features/drawings/fixtures/syntheticDrawing";
import {
  centre,
  pinch,
  scrollDocument,
  openTab,
  stageBox,
  startInspection,
  touchTap,
  waitForServiceWorker,
  pinToolOn,
  unlockDeveloperTools,
} from "./helpers";
import { syntheticJpeg } from "./photoFixtures";

const field = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });
// The notes box shows everything in capitals.
const HEADER =
  "NORTHROP INSPECTION | LEVEL 3 SLAB REINFORCEMENT | T. ENGINEER | 01/10/2026";

/** New inspection with the fields the observations box header uses. */
async function setupInspection(page: Page) {
  await page.goto("./");
  await startInspection(page, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
  });
  await field(page, "Item inspected").fill("Level 3 slab reinforcement");
  await field(page, "Inspector").fill("Test Engineer");
  await field(page, "Date").fill("2026-10-01");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await openTab(page, "Inspection");
}

async function uploadDrawings(
  page: Page,
  files: { name: string; buffer: Buffer }[],
) {
  await page
    .getByTestId("drawing-file-input")
    .setInputFiles(files.map((f) => ({ ...f, mimeType: "application/pdf" })));
  await expect(page.getByTestId("drawings-status")).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function typicalPdf(name = "S-101 Level 3.pdf") {
  return {
    name,
    buffer: Buffer.from(await buildSyntheticDrawing(TYPICAL_DRAWING)),
  };
}

/**
 * Shows a drawing in the Inspection step: from the drawings list if it is
 * showing (e.g. after a failed upload), else from the Pages view (its first
 * page).
 */
async function openDrawing(page: Page, name: string, pin = true) {
  const pattern = new RegExp(`^${name}`);
  const inList = page
    .locator(".drawings-empty")
    .getByRole("button", { name: pattern });
  if (await inList.isVisible()) await inList.click();
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible({
    timeout: 20_000,
  });
  // Most tests place pins with taps: the Pin tool on, as before slice 2.
  if (pin) await pinToolOn(page);
  const indicator = page.getByTestId("page-indicator");
  await expect(indicator).not.toHaveAttribute("data-label", "");
  if (pattern.test((await indicator.getAttribute("data-label")) ?? "")) return;
  await openPages(page);
  await page
    .getByRole("dialog", { name: "Pages" })
    .getByRole("button", {
      name: new RegExp(`^Page \\d+: ${name} page 1$`),
    })
    .click();
  await expect(indicator).toHaveAttribute("data-label", pattern);
}

/** Opens the Pages view from the page button. */
async function openPages(page: Page) {
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pages" })).toBeVisible();
}

/**
 * With the Pin tool on, taps at a fraction of a page (closing any open
 * item or panel first). Returns the tap point.
 */
async function addPinAt(page: Page, fx: number, fy: number, pageIndex = 0) {
  await pinToolOn(page);
  const box = await stageBox(page, pageIndex);
  const before = await page.getByTestId("viewer-pin").count();
  const at = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  // A tap closes what's open beside the drawing, one layer at a time.
  for (let i = 0; i < 3; i++) {
    const open = page
      .getByTestId("item-sheet")
      .or(page.getByTestId("items-panel"));
    if ((await open.count()) === 0) break;
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
  }
  await page.mouse.click(at.x, at.y);
  // Wait for the new pin's own sheet (a previous sheet may still be open).
  await expect(page.getByTestId("viewer-pin")).toHaveCount(before + 1);
  await expect(
    page.getByTestId("item-sheet").getByRole("textbox"),
  ).toBeFocused();
  return at;
}

const sheet = (page: Page) => page.getByTestId("item-sheet");
const pinByLetter = (
  page: Page,
  letter: string,
  kind: "instruction" | "observation" = "instruction",
) =>
  page.locator(
    `[data-testid="viewer-pin"][data-kind="${kind}"][data-letter="${letter}"]`,
  );

async function typeItem(page: Page, text: string) {
  await sheet(page).getByRole("textbox").fill(text);
  await expect(page.getByTestId("item-save-state")).toHaveText("Saved");
}

async function deleteOpenItem(page: Page) {
  await sheet(page)
    .getByRole("button", { name: /^Delete (instruction|observation) / })
    .click();
  // No confirm: it goes at once (Undo brings it back).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(sheet(page)).toHaveCount(0);
}

/** Drags with the mouse from one point to another in small steps. */
async function mouseDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

const panelRows = (page: Page) => page.getByTestId("items-panel-row");

/** Opens the Items tab with three instructions on page 1: A, B, C. */
async function threeItemsInPanel(page: Page) {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  for (const [i, fx] of [0.2, 0.4, 0.6].entries()) {
    await addPinAt(page, fx, 0.5);
    await typeItem(page, `Item ${i + 1}`);
  }
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await expect(panelRows(page)).toHaveCount(3);
}

test("the Inspection step opens straight into the drawings", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  const tabs = page.getByRole("navigation", { name: "Inspection sections" });
  await expect(
    tabs.getByRole("link", { name: "Inspection", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-101 Level 3 · page 1 of 3",
  );

  await openTab(page, "Site memo");
  await expect(page).toHaveURL(/\/memo$/);
  await openTab(page, "Inspection");
  await expect(page).toHaveURL(/\/inspection$/);
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible({ timeout: 20_000 });

  // The page button opens the Pages view: every page as a thumbnail.
  await openPages(page);
  await expect(page.getByTestId("page-thumb")).toHaveCount(3);
});

test("adds drawings from Files, rejects non-PDFs and opens them", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [
    await typicalPdf("S-101 Level 3.pdf"),
    { name: "notes.pdf", buffer: Buffer.from("this is not a pdf") },
  ]);
  const card = page.getByRole("listitem").filter({ hasText: "S-101 Level 3" });
  await expect(card).toContainText("3 pages · 0 items");
  await expect(page.getByRole("alert")).toContainText(
    "notes.pdf couldn't be opened as a PDF.",
  );

  await openDrawing(page, "S-101 Level 3");
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-101 Level 3 · page 1 of 3",
  );
});

test("a pin becomes a saved instruction exactly where tapped", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");

  const at = await addPinAt(page, 0.25, 0.4);
  await expect(sheet(page).getByRole("heading")).toHaveText("Instruction A");
  await expect(
    sheet(page).getByRole("button", { name: "Instruction", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page).getByRole("textbox")).toBeFocused();
  await typeItem(page, "Add N12 bar at grid C/4");
  await sheet(page)
    .getByLabel("Photo confirmation required before proceeding")
    .check();

  const pin = pinByLetter(page, "A");
  expect(Number(await pin.getAttribute("data-x"))).toBeCloseTo(0.25, 2);
  expect(Number(await pin.getAttribute("data-y"))).toBeCloseTo(0.4, 2);
  // The pin sits on the tapped page spot (the view may pan when the sheet
  // opens, so compare against the page where it is now).
  expect(at.x).toBeGreaterThan(0);
  const stage = await stageBox(page);
  const placed = await centre(pin);
  const n = {
    x: Number(await pin.getAttribute("data-x")),
    y: Number(await pin.getAttribute("data-y")),
  };
  expect(Math.abs(placed.x - (stage.x + stage.width * n.x))).toBeLessThan(1);
  expect(Math.abs(placed.y - (stage.y + stage.height * n.y))).toBeLessThan(1);

  // The page's notes box shows the header and the instruction.
  const obsBox = page.getByTestId("observation-box");
  await expect(obsBox).toContainText(HEADER);
  await expect(obsBox).toContainText("INSTRUCTIONS:");
  await expect(obsBox).toContainText("A. ADD N12 BAR AT GRID C/4");
  await expect(obsBox).not.toContainText("NOTED FOR INFORMATION:");

  await page.reload();
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible();
  await expect(sheet(page).getByRole("textbox")).toHaveValue(
    "Add N12 bar at grid C/4",
  );
  await expect(
    sheet(page).getByLabel("Photo confirmation required before proceeding"),
  ).toBeChecked();
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await expect(sheet(page)).toHaveCount(0);

  // Tapping the pin reopens its sheet.
  const c = await centre(pin);
  await page.mouse.click(c.x, c.y);
  await expect(sheet(page).getByRole("heading")).toHaveText("Instruction A");
});

test("the notes box lists observations, then instructions", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");

  await addPinAt(page, 0.3, 0.5);
  await typeItem(page, "Add bar");
  await addPinAt(page, 0.5, 0.6);
  await sheet(page)
    .getByRole("button", { name: "Observation", exact: true })
    .click();
  // It becomes observation A, beside instruction A.
  await expect(pinByLetter(page, "A", "observation")).toHaveCount(1);
  await expect(pinByLetter(page, "A")).toHaveCount(1);
  await expect(sheet(page).getByRole("heading")).toHaveText("Observation A");
  await expect(
    sheet(page).getByLabel("Photo confirmation required before proceeding"),
  ).toHaveCount(0);
  await typeItem(page, "Existing crack noted at grid 4");

  const obsBox = page.getByTestId("observation-box");
  await expect(obsBox).toContainText(HEADER);
  await expect(obsBox).toContainText(
    "NOTED FOR INFORMATION:A. EXISTING CRACK NOTED AT GRID 4INSTRUCTIONS:A. ADD BAR",
  );

  await sheet(page)
    .getByRole("button", { name: "Instruction", exact: true })
    .click();
  await expect(obsBox).toContainText(
    "INSTRUCTIONS:A. ADD BARB. EXISTING CRACK NOTED AT GRID 4",
  );
  await expect(obsBox).not.toContainText("NOTED FOR INFORMATION:");
});

test("deleting an item re-letters the rest, and the box goes with the last pin", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");

  for (const fx of [0.2, 0.3, 0.4]) {
    await addPinAt(page, fx, 0.5);
    await typeItem(page, `Pin at ${fx}`);
  }
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  // Delete B: the pin that was C becomes B.
  let c = await centre(pinByLetter(page, "B"));
  await page.mouse.click(c.x, c.y);
  await deleteOpenItem(page);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(2);
  c = await centre(pinByLetter(page, "B"));
  await page.mouse.click(c.x, c.y);
  await expect(sheet(page).getByRole("textbox")).toHaveValue("Pin at 0.4");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await addPinAt(page, 0.5, 0.5);
  await expect(sheet(page).getByRole("heading")).toHaveText("Instruction C");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  // Deleting A each time re-letters the rest down to A.
  for (let i = 0; i < 3; i++) {
    const letter = "A";
    c = await centre(pinByLetter(page, letter));
    await page.mouse.click(c.x, c.y);
    await expect(sheet(page).getByRole("heading")).toHaveText(
      `Instruction ${letter}`,
    );
    await deleteOpenItem(page);
  }
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);
  await expect(page.getByTestId("observation-box")).toHaveCount(0);
});

test("dragged pins and boxes keep their new positions", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.5, 0.5);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  const stage = await stageBox(page);
  const pin = pinByLetter(page, "A");
  const start = await centre(pin);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + stage.width * 0.1, start.y, { steps: 5 });
  await page.mouse.up();

  const obsBox = page.getByTestId("observation-box");
  const b = (await obsBox.boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 5);
  await page.mouse.down();
  await page.mouse.move(stage.x + 20, stage.y + stage.height * 0.8, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(sheet(page)).toHaveCount(0);
  // Let the moves save before reloading.
  await expect
    .poll(async () => Number(await obsBox.getAttribute("data-x")))
    .toBeLessThan(0.05);
  await page.waitForTimeout(300);

  await page.reload();
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible();
  await expect
    .poll(async () => Number(await pin.getAttribute("data-x")))
    .toBeCloseTo(0.6, 2);
  expect(Number(await obsBox.getAttribute("data-x"))).toBeLessThan(0.05);
  expect(Number(await obsBox.getAttribute("data-y"))).toBeGreaterThan(0.7);
});

test("the notes box: tap to select, drag a side to resize, S/M/L text, undo", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.4, 0.5);
  await typeItem(page, "Add N12 bar at grid C/4");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  const obsBox = page.getByTestId("observation-box");
  const width = async () => Number(await obsBox.getAttribute("data-width"));
  const before = await width();
  // A tap selects it: handles and the size bar show.
  const b = (await obsBox.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const right = page.getByTestId("box-handle-right");
  await expect(right).toBeVisible();
  const sizes = page.getByRole("toolbar", { name: "Notes box text size" });
  await expect(
    sizes.getByRole("button", { name: "Text size M" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Narrower: drag the right handle in by a third of the box.
  const h = (await right.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - b.width / 3, h.y + h.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect.poll(width).toBeLessThan(before * 0.8);
  const narrow = await width();

  // Large text.
  await sizes.getByRole("button", { name: "Text size L" }).click();
  await expect(obsBox).toHaveAttribute("data-text-size", "L");

  // Undo goes back a step at a time.
  const undo = page.getByRole("button", { name: "Undo" });
  await undo.click();
  await expect(obsBox).toHaveAttribute("data-text-size", "M");
  await undo.click();
  await expect.poll(width).toBeCloseTo(before, 3);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(width).toBeCloseTo(narrow, 3);

  // A tap on the drawing lets go; it's kept after a reload.
  await page.waitForTimeout(300);
  await page.reload();
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible();
  await expect.poll(width).toBeCloseTo(narrow, 3);
  await expect(page.getByTestId("box-handle-right")).toHaveCount(0);
});

test("a pinch moves a snapshot and lays out once, around the fingers", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.4, 0.4);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  const pin = pinByLetter(page, "A");
  const at = await centre(pin);
  const snapshot = page.getByTestId("pinch-snapshot");

  // Fingers down and apart, but not lifted yet: only the snapshot moves;
  // the document isn't scrolled, laid out or transformed.
  const mid = await page.evaluate(async (at) => {
    const el = document.querySelector<HTMLElement>(
      '[data-testid="drawing-viewer"]',
    )!;
    const fire = (type: string, d: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: [
          { clientX: at.x - d / 2, clientY: at.y },
          { clientX: at.x + d / 2, clientY: at.y },
        ],
      });
      el.dispatchEvent(event);
    };
    const stage = el.querySelector<HTMLElement>(".doc-stage")!;
    const sizer = el.querySelector<HTMLElement>(".doc-sizer")!;
    const before = { scrollTop: el.scrollTop, stage: stage.style.transform };
    fire("touchstart", 100);
    for (let d = 110; d <= 200; d += 10) fire("touchmove", d);
    // The preview updates once per frame.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const layer = document.querySelector<HTMLElement>(
      ".viewer-snapshot-layer",
    )!;
    return {
      unchanged:
        el.scrollTop === before.scrollTop &&
        stage.style.transform === before.stage &&
        !sizer.style.transform,
      previewing: layer.style.transform.includes("scale(2)"),
    };
  }, at);
  expect(mid).toEqual({ unchanged: true, previewing: true });
  await expect(snapshot).toHaveAttribute("data-on", "");

  // Lifted: laid out at the new zoom around the fingers, and the snapshot
  // goes once the pages have redrawn.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="drawing-viewer"]')!;
    const event = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: [] });
    el.dispatchEvent(event);
  });
  await expect(snapshot).not.toHaveAttribute("data-on");
  const now = await centre(pin);
  expect(Math.abs(now.x - at.x)).toBeLessThan(3);
  expect(Math.abs(now.y - at.y)).toBeLessThan(3);
});

test("the pinch snapshot shows the page and its pins, zoomed in too", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.4, 0.4);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  const viewer = page.getByTestId("drawing-viewer");
  const snapshot = page.getByTestId("pinch-snapshot");

  /** Fingers down at `at` (d px apart, no zoom yet); colours under the pin. */
  const press = (
    at: { x: number; y: number },
    pinAt: { x: number; y: number },
  ) =>
    page.evaluate(
      ({ at, pinAt }) => {
        const el = document.querySelector('[data-testid="drawing-viewer"]')!;
        const event = new Event("touchstart", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "touches", {
          value: [
            { clientX: at.x - 50, clientY: at.y },
            { clientX: at.x + 50, clientY: at.y },
          ],
        });
        el.dispatchEvent(event);
        const host = document.querySelector<HTMLElement>(
          '[data-testid="pinch-snapshot"]',
        )!;
        const canvas = host.querySelectorAll("canvas")[1];
        const box = host.getBoundingClientRect();
        const k = canvas.width / box.width;
        const pixel = (x: number, y: number) => [
          ...canvas
            .getContext("2d")!
            .getImageData(
              Math.round((x - box.left) * k),
              Math.round((y - box.top) * k),
              1,
              1,
            ).data,
        ];
        // Beside the pin's letter, inside its red disc.
        return { pin: pixel(pinAt.x + 10, pinAt.y) };
      },
      { at, pinAt },
    );
  const lift = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="drawing-viewer"]')!;
      const event = new Event("touchend", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: [] });
      el.dispatchEvent(event);
    });
  const isRed = ([r, g, b]: number[]) => r > 170 && g < 90 && b < 100;

  // At fit width.
  let pinAt = await centre(pinByLetter(page, "A"));
  let seen = await press(await centre(viewer), pinAt);
  expect(isRed(seen.pin)).toBe(true);
  await lift();
  await expect(snapshot).not.toHaveAttribute("data-on");

  // Zoom in around the pin, then press again: still drawn, now larger.
  await pinch(page, pinAt, 100, 300);
  await expect(snapshot).not.toHaveAttribute("data-on");
  pinAt = await centre(pinByLetter(page, "A"));
  seen = await press(pinAt, pinAt);
  expect(isRed(seen.pin)).toBe(true);
  await lift();
  await expect(snapshot).not.toHaveAttribute("data-on");
});

test("pins stay on their spot through a pinch zoom", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.25, 0.4);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  let box = await stageBox(page);
  await pinch(
    page,
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 },
    60,
    240,
  );
  await expect
    .poll(async () => (await stageBox(page)).width)
    .toBeGreaterThan(box.width * 3);

  box = await stageBox(page);
  const pin = pinByLetter(page, "A");
  const n = {
    x: Number(await pin.getAttribute("data-x")),
    y: Number(await pin.getAttribute("data-y")),
  };
  const after = await centre(pin);
  expect(Math.abs(after.x - (box.x + box.width * n.x))).toBeLessThan(1);
  expect(Math.abs(after.y - (box.y + box.height * n.y))).toBeLessThan(1);
});

test("letters follow the pins' order in the document", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");

  // A pin on page 2 first is A...
  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  const second = await stageBox(page, 1);
  await scrollDocument(page, second.y - viewer.y - 20);
  await expect(
    page.locator(
      '[data-testid="doc-page"][data-key$=":2"][data-rendered="true"]',
    ),
  ).toBeVisible();
  await addPinAt(page, 0.5, 0.5, 1);
  await typeItem(page, "On page two");
  await expect(sheet(page).getByRole("heading")).toHaveText("Instruction A");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  // ...until a pin goes on page 1: that becomes A and page 2's becomes B.
  const first = await stageBox(page, 0);
  await scrollDocument(page, first.y - viewer.y - 20);
  await addPinAt(page, 0.3, 0.3, 0);
  await expect(sheet(page).getByRole("heading")).toHaveText("Instruction A");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await expect(
    page.locator('[data-testid="viewer-pin"][data-letter="B"]'),
  ).toHaveAttribute("data-page", /:2$/);
});

test("pins on a later page are lettered per kind", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await typeItem(page, "First");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  // Scroll down to page 2 of the document.
  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  const second = await stageBox(page, 1);
  await scrollDocument(page, second.y - viewer.y - 20);
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-101 Level 3 · page 2 of 3",
  );
  await expect(
    page.locator(
      '[data-testid="doc-page"][data-key$=":2"][data-rendered="true"]',
    ),
  ).toBeVisible();
  await addPinAt(page, 0.4, 0.4, 1);
  await sheet(page)
    .getByRole("button", { name: "Observation", exact: true })
    .click();
  await typeItem(page, "Second on page two");
  await expect(sheet(page).getByRole("heading")).toHaveText("Observation A");
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
  await expect(pinByLetter(page, "A")).toHaveCount(1);
});

test("at fit width the document only scrolls up and down", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const viewer = page.getByTestId("drawing-viewer");
  const start = await stageBox(page);

  // Nothing to scroll sideways, and a sideways drag doesn't move it.
  expect(
    await viewer.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(0);
  const box = (await viewer.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 100, { steps: 6 });
  await page.mouse.up();
  expect((await stageBox(page)).x).toBeCloseTo(start.x, 0);

  // The browser's own scrolling moves the document.
  await viewer.evaluate((el) => el.scrollBy(0, 400));
  await expect
    .poll(async () => Math.round((await stageBox(page)).y))
    .toBe(Math.round(start.y - 400));

  // Zoomed in, it can scroll sideways too.
  await pinch(page, await centre(viewer), 100, 250);
  await expect
    .poll(() => viewer.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(0);
});

test("tapping the drawing closes the Items panel", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await expect(page.getByTestId("items-panel")).toBeVisible();

  // Open the item from the list, then tap the drawing twice: the first tap
  // closes the item, the second the Items panel.
  await page.getByTestId("items-panel-row").first().getByRole("button").click();
  await expect(sheet(page)).toBeVisible();
  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId("items-panel")).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(page.getByTestId("items-panel")).toHaveCount(0);
});

test("a tap on the drawing with nothing open places an instruction pin", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const box = await stageBox(page);

  // With the Pin tool on, a tap places an instruction and opens it.
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(pinByLetter(page, "A")).toBeVisible();
  await expect(sheet(page).getByRole("textbox")).toBeFocused();
  await typeItem(page, "Placed by a tap");

  // A tap away only closes the open item; the next one places another pin.
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(2);
  await expect(pinByLetter(page, "B")).toBeVisible();
});

test("a double-tap places an observation; Undo removes it in one step", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const box = await stageBox(page);

  await page.mouse.dblclick(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toHaveAttribute("title", "Undo: Add observation A");

  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
});

test("a double-tap on a pin switches its kind; Undo switches it back", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await expect(sheet(page)).toHaveCount(0);

  const c = await centre(pinByLetter(page, "A"));
  await page.mouse.dblclick(c.x, c.y);
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
  await expect(sheet(page)).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toHaveAttribute(
    "title",
    "Undo: Switch instruction A to observation",
  );
  await undo.click();
  await expect(pinByLetter(page, "A", "instruction")).toBeVisible();

  // The editor's Instruction | Observation switch is undoable too.
  await pinByLetter(page, "A").click();
  await sheet(page).getByRole("button", { name: "Observation" }).click();
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
  await undo.click();
  await expect(pinByLetter(page, "A", "instruction")).toBeVisible();
});

test("hold then drag: the arrowhead at the press, the pin where it lifts; hold alone just the pin", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const box = await stageBox(page);
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };
  const to = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 };

  // Hold, then drag: the arrowhead stays where pressed, the pin follows.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(pinByLetter(page, "A")).toBeVisible();
  await expect(sheet(page)).toBeVisible();
  const pin = await centre(pinByLetter(page, "A"));
  expect(Math.abs(pin.x - to.x)).toBeLessThan(3);
  expect(Math.abs(pin.y - to.y)).toBeLessThan(3);
  const tip = await centre(page.getByTestId("arrow-handle"));
  expect(Math.abs(tip.x - from.x)).toBeLessThan(3);
  expect(Math.abs(tip.y - from.y)).toBeLessThan(3);
  // One step: Undo removes the pin and its arrow.
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toHaveAttribute("title", "Undo: Add instruction A");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  // Hold without moving: just a pin.
  const still = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.3 };
  await page.mouse.move(still.x, still.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(2);
  await expect(page.getByTestId("arrow-handle")).toHaveCount(0);

  // A quick drag (no hold) still pans; it places nothing.
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await mouseDrag(
    page,
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.7 },
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 },
  );
  await expect(page.getByTestId("viewer-pin")).toHaveCount(2);

  await undo.click();
  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);
});

test("double-tap and hold: an observation dragged out from its arrowhead in one step; an existing pin keeps its place", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const box = await stageBox(page);
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };
  const to = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 };

  // Tap, then press again at once: the pin turns blue straight away; hold
  // and drag the pin out from its arrowhead; the editor waits until the
  // finger lifts.
  await page.mouse.click(from.x, from.y);
  await page.mouse.down();
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
  await page.waitForTimeout(700);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(sheet(page)).toHaveCount(0);
  await page.mouse.up();

  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
  await expect(sheet(page)).toBeVisible();
  await expect(async () => {
    const pin = await centre(pinByLetter(page, "A", "observation"));
    expect(Math.abs(pin.x - to.x)).toBeLessThan(3);
    expect(Math.abs(pin.y - to.y)).toBeLessThan(3);
  }).toPass();
  const tip = await centre(page.getByTestId("arrow-handle"));
  expect(Math.abs(tip.x - from.x)).toBeLessThan(3);
  expect(Math.abs(tip.y - from.y)).toBeLessThan(3);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toHaveAttribute("title", "Undo: Add observation A");
  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);

  // On a pin that was already there: it stays put and the arrow follows.
  await page.mouse.click(from.x, from.y);
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await expect(sheet(page)).toHaveCount(0);
  // Past the moment a pin still counts as just placed.
  await page.waitForTimeout(1100);
  const existing = await centre(pinByLetter(page, "A", "instruction"));
  await page.mouse.click(existing.x, existing.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(pinByLetter(page, "A", "observation")).toBeVisible();
  const kept = await centre(pinByLetter(page, "A", "observation"));
  expect(Math.abs(kept.x - existing.x)).toBeLessThan(3);
  expect(Math.abs(kept.y - existing.y)).toBeLessThan(3);
  const tip2 = await centre(page.getByTestId("arrow-handle"));
  expect(Math.abs(tip2.x - to.x)).toBeLessThan(3);
  expect(Math.abs(tip2.y - to.y)).toBeLessThan(3);
});

test("jumping to an item keeps its pin clear of the panel", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  // Low on the page: in portrait the panel covers the bottom of the view.
  await addPinAt(page, 0.5, 0.9);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await panelRows(page).first().getByRole("button").click();
  await expect(sheet(page)).toBeVisible();
  await expect(async () => {
    const pin = await centre(pinByLetter(page, "A"));
    const panel = (await sheet(page).boundingBox())!;
    expect(pin.y).toBeLessThan(panel.y - 20);
  }).toPass();
});

test("tapping the drawing closes the item editor and keeps the text", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  await sheet(page).getByRole("textbox").fill("Typed then tapped away");

  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);

  const c = await centre(pinByLetter(page, "A"));
  await page.mouse.click(c.x, c.y);
  await expect(sheet(page).getByRole("textbox")).toHaveValue(
    "Typed then tapped away",
  );
});

test("a lost finger-up doesn't stop the Pin tool working", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const viewer = page.getByTestId("drawing-viewer");
  // The middle of the first page (the view's centre can fall between pages).
  const at = await centre(page.getByTestId("doc-page").first());

  // A finger goes down, but its "up" never reaches the viewer (as when the
  // element under it is removed or redrawn mid-touch), nor does touchend.
  await viewer.evaluate((el, at) => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 40,
        pointerType: "touch",
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        cancelable: true,
        isPrimary: true,
      }),
    );
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", {
      value: [
        { clientX: at.x - 40, clientY: at.y },
        { clientX: at.x + 40, clientY: at.y },
      ],
    });
    el.dispatchEvent(start);
  }, at);
  // The lift lands elsewhere in the page.
  await page.evaluate(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 40,
        pointerType: "touch",
        bubbles: true,
      }),
    );
    const end = new Event("touchend", { bubbles: true });
    Object.defineProperty(end, "touches", { value: [] });
    document.body.dispatchEvent(end);
  });

  await touchTap(page, at);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
});

test("a touch while the document scrolls doesn't place a pin", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const viewer = page.getByTestId("drawing-viewer");
  const at = await centre(viewer);

  // The tap lands straight after a scroll (as when stopping momentum).
  await viewer.evaluate(async (el) => {
    el.scrollBy(0, 200);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
  await touchTap(page, at);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);

  // Once it's still, a tap places the pin.
  await page.waitForTimeout(300);
  await touchTap(page, at);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
});

test("all drawings scroll as one document", async ({ page }) => {
  await setupInspection(page);
  const home = page.url();
  await uploadDrawings(page, [
    await typicalPdf("S-101 Level 3.pdf"),
    await typicalPdf("S-102 Level 4.pdf"),
  ]);
  await openDrawing(page, "S-101 Level 3");
  await expect(page.getByTestId("doc-page")).toHaveCount(6);
  // One continuous document: no drawing names over the pages, and the
  // page label counts through every drawing.
  await expect(page.locator(".doc-label")).toHaveCount(0);
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 of 6");

  // Scroll to the second drawing's first page.
  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  const fourth = await stageBox(page, 3);
  await scrollDocument(page, fourth.y - viewer.y - 20);
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-102 Level 4 · page 1 of 3",
  );
  await addPinAt(page, 0.5, 0.5, 3);
  await expect(sheet(page).getByRole("heading")).toHaveText("Instruction A");

  // Opening a drawing from the Drawings panel scrolls straight to it.
  await page.goto(home);
  await openDrawing(page, "S-102 Level 4");
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-102 Level 4 · page 1 of 3",
  );
});

test("the Items tab lists items and jumps to them", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [
    await typicalPdf("S-101 Level 3.pdf"),
    await typicalPdf("S-102 Level 4.pdf"),
  ]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await typeItem(page, "On the first drawing");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  const fourth = await stageBox(page, 3);
  await scrollDocument(page, fourth.y - viewer.y - 20);
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-102 Level 4 · page 1 of 3",
  );
  await addPinAt(page, 0.5, 0.5, 3);
  await sheet(page)
    .getByRole("button", { name: "Observation", exact: true })
    .click();
  await typeItem(page, "On the second drawing");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  await page.getByRole("button", { name: "Items", exact: true }).click();
  const panel = page.getByTestId("items-panel");
  const rows = panel.getByRole("listitem");
  // Observations first, each under its page.
  await expect(rows).toHaveCount(2);
  await expect(panel.getByRole("heading", { level: 4 })).toHaveText([
    "Page 4",
    "Page 1",
  ]);
  await expect(rows.nth(0)).not.toContainText("S-102");

  // Jump back up to instruction A on the first drawing.
  await rows.nth(1).getByRole("button").click();
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-101 Level 3 · page 1 of 3",
  );
  await expect(sheet(page).getByRole("heading")).toHaveText("Instruction A");
  await sheet(page).getByRole("button", { name: "‹ Items" }).click();
  await expect(panel).toBeVisible();

  await rows.nth(0).getByRole("button").click();
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    "S-102 Level 4 · page 1 of 3",
  );
  await expect(sheet(page).getByRole("heading")).toHaveText("Observation A");
});

test("Undo brings back a deleted item with its letter", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeDisabled();

  await addPinAt(page, 0.3, 0.5);
  await typeItem(page, "First");
  await addPinAt(page, 0.5, 0.5);
  await typeItem(page, "Second");
  await deleteOpenItem(page);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);

  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(2);
  const c = await centre(pinByLetter(page, "B"));
  await page.mouse.click(c.x, c.y);
  await expect(sheet(page).getByRole("textbox")).toHaveValue("Second");

  // Redo deletes it again; Undo brings it back again.
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await redo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(2);

  // Then the two pins themselves: undo the adds, newest first.
  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);
  await expect(page.getByTestId("observation-box")).toHaveCount(0);
  await expect(undo).toBeDisabled();

  // Redo puts the first back, with its text and notes box.
  await redo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
  await expect(page.getByTestId("observation-box")).toContainText("A. FIRST");
});

test("the Items tab highlights items whose pins are on screen", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  await typeItem(page, "On page one");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  const third = await stageBox(page, 2);
  await scrollDocument(page, third.y - viewer.y - 20);
  await addPinAt(page, 0.5, 0.3, 2);
  await typeItem(page, "On page three");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  await page.getByRole("button", { name: "Items", exact: true }).click();
  const row = (text: string) => panelRows(page).filter({ hasText: text });
  await expect(row("On page three")).toHaveAttribute("data-in-view", "true");
  await expect(row("On page one")).toHaveAttribute("data-in-view", "false");

  // Scroll back to page 1: the highlight follows.
  const first = await stageBox(page, 0);
  await scrollDocument(page, first.y - viewer.y - 20);
  await expect(row("On page one")).toHaveAttribute("data-in-view", "true");
  await expect(row("On page three")).toHaveAttribute("data-in-view", "false");
});

test("the item sheet's Done button closes it", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  await sheet(page).getByRole("textbox").fill("Typed then done");
  // The Done button sits just above Delete.
  await sheet(page).getByRole("button", { name: "Done" }).last().click();
  await expect(sheet(page)).toHaveCount(0);
  const c = await centre(pinByLetter(page, "A"));
  await page.mouse.click(c.x, c.y);
  await expect(sheet(page).getByRole("textbox")).toHaveValue("Typed then done");
});

test("swiping an item left in the Items tab deletes it", async ({ page }) => {
  await threeItemsInPanel(page);
  const row = panelRows(page).nth(1);
  const box = (await row.boundingBox())!;
  await mouseDrag(
    page,
    { x: box.x + box.width - 60, y: box.y + box.height / 2 },
    { x: box.x + box.width - 200, y: box.y + box.height / 2 },
  );
  await row.getByRole("button", { name: "Delete instruction B" }).click();

  await expect(panelRows(page)).toHaveCount(2);
  await expect(panelRows(page).nth(1)).toContainText("B. Item 3");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(panelRows(page)).toHaveCount(3);
  await expect(panelRows(page).nth(1)).toContainText("B. Item 2");
});

test("dragging the handle reorders items on a page", async ({ page }) => {
  await threeItemsInPanel(page);
  const handle = page.getByRole("button", { name: "Reorder instruction C" });
  const first = (await panelRows(page).nth(0).boundingBox())!;
  await mouseDrag(page, await centre(handle), {
    x: (await centre(handle)).x,
    y: first.y + 4,
  });

  // C moved to the top: it's now A, and the box follows.
  await expect(panelRows(page).nth(0)).toContainText("A. Item 3");
  await expect(panelRows(page).nth(1)).toContainText("B. Item 1");
  await expect(page.getByTestId("observation-box")).toContainText(
    "INSTRUCTIONS:A. ITEM 3B. ITEM 1C. ITEM 2",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(panelRows(page).nth(0)).toContainText("A. Item 1");
});

test("arrows point from a pin to spots on its page", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  await typeItem(page, "Lap at grid C");
  const arrows = page.getByTestId("arrow");
  const handles = page.getByTestId("arrow-handle");
  const box = await stageBox(page);

  // Add arrow, then tap the drawing: an arrow and its tip handle appear.
  await sheet(page).getByRole("button", { name: "Add arrow" }).click();
  await expect(sheet(page).getByRole("status").last()).toHaveText(
    "Tap the drawing where the arrow should point.",
  );
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
  await expect(arrows).toHaveCount(1);
  await expect(handles).toHaveCount(1);
  await expect(handles.first()).toHaveAttribute("data-x", /^0\.(59|60)/);

  // A second arrow from the same pin.
  await sheet(page).getByRole("button", { name: "Add arrow" }).click();
  // The sheet grew, so measure the page again.
  const box2 = await stageBox(page);
  await page.mouse.click(box2.x + box2.width * 0.5, box2.y + box2.height * 0.6);
  await expect(arrows).toHaveCount(2);
  await expect(sheet(page)).toContainText("Arrows (2)");

  // Drag the first tip somewhere else; Undo puts it back.
  const tip = await centre(handles.first());
  await page.mouse.move(tip.x, tip.y);
  await page.mouse.down();
  await page.mouse.move(tip.x - 100, tip.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(handles.first()).not.toHaveAttribute("data-x", /^0\.(59|60)/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  // Undo closes the sheet; reopen the item to see its handles.
  const pin = await centre(pinByLetter(page, "A"));
  await page.mouse.click(pin.x, pin.y);
  await expect(handles.first()).toHaveAttribute("data-x", /^0\.(59|60)/);

  // Select a tip and remove it.
  await handles.first().click();
  await expect(handles.first()).toHaveAttribute("aria-pressed", "true");
  await sheet(page).getByRole("button", { name: "Remove arrow" }).click();
  await expect(arrows).toHaveCount(1);
  await expect(handles.first()).not.toHaveAttribute("data-x", /^0\.(59|60)/);
});

test("an arrow must point to a spot on its pin's page", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await sheet(page).getByRole("button", { name: "Add arrow" }).click();

  // Tap page 2: it keeps waiting, with a hint.
  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  const second = await stageBox(page, 1);
  await scrollDocument(page, second.y - viewer.y - 20);
  const two = await stageBox(page, 1);
  await page.mouse.click(two.x + two.width / 2, two.y + two.height / 2);
  await expect(sheet(page)).toContainText("Tap on page 1, where the pin is.");
  await expect(page.getByTestId("arrow")).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Cancel" }).click();
  await expect(
    sheet(page).getByRole("button", { name: "Add arrow" }),
  ).toBeVisible();
});

test("pages: duplicate, hide, restore, select and hide unmarked", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  const indicator = page.getByTestId("page-indicator");
  await expect(indicator).toHaveText("Page 1 of 3");

  await openPages(page);
  const pages = page.getByRole("dialog", { name: "Pages" });
  const thumbs = pages.getByTestId("page-thumb");
  await expect(thumbs).toHaveCount(3);
  await expect(thumbs.first()).toContainText("1 pin");
  await expect(thumbs.first()).toHaveClass(/page-thumb-current/);

  // A page with pins can't be hidden; any page can be duplicated.
  await pages.getByRole("button", { name: "Page 1 options" }).click();
  await expect(
    pages.getByRole("menuitem", { name: "Hide (has pins)" }),
  ).toBeDisabled();
  await pages.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(thumbs).toHaveCount(4);
  // The copy (page 2) shows the same sheet, without the pin.
  await expect(
    pages.getByRole("button", { name: "Page 2: S-101 Level 3 page 1" }),
  ).not.toContainText("pin");

  // Hide page 3, then restore it from Hidden pages.
  await pages.getByRole("button", { name: "Page 3 options" }).click();
  await pages.getByRole("menuitem", { name: "Hide", exact: true }).click();
  await expect(thumbs).toHaveCount(3);
  await pages
    .getByRole("button", { name: "Restore S-101 Level 3 page 2" })
    .click();
  await expect(thumbs).toHaveCount(4);

  // Select mode: hide two pages at once.
  await pages.getByRole("button", { name: "Select" }).click();
  await thumbs.nth(1).click();
  await thumbs.nth(2).click();
  await expect(
    pages.getByRole("heading", { name: "2 selected" }),
  ).toBeVisible();
  await pages.getByRole("button", { name: "Hide 2 pages" }).click();
  await expect(thumbs).toHaveCount(2);

  // Hide unmarked pages leaves only the page with the pin.
  await pages.getByRole("button", { name: "Hide unmarked pages (1)" }).click();
  await expect(thumbs).toHaveCount(1);
  await pages.getByRole("button", { name: "Done" }).click();

  // The document follows: one page left.
  await thumbs.first().click();
  await expect(pages).toBeHidden();
  await expect(indicator).toHaveText("Page 1 of 1");
  await expect(page.getByTestId("doc-page")).toHaveCount(1);
});

test("items: select several to switch kind, set photo confirmation or delete", async ({
  page,
}) => {
  await threeItemsInPanel(page);
  const panel = page.getByTestId("items-panel");
  const undo = page.getByRole("button", { name: "Undo" });

  await panel.getByRole("button", { name: "Select", exact: true }).click();
  await panelRows(page).nth(0).getByRole("button").click();
  await panelRows(page).nth(2).getByRole("button").click();
  await expect(
    panel.getByRole("heading", { name: "2 selected" }),
  ).toBeVisible();

  // Photo confirmation for both instructions at once.
  await panel.getByRole("button", { name: "Photo confirmation on" }).click();
  await expect(undo).toHaveAttribute(
    "title",
    "Undo: Photo confirmation on for 2 items",
  );
  await expect(
    panel.getByRole("button", { name: "Photo confirmation off" }),
  ).toBeEnabled();

  // Both become observations (lettered A and B); one Undo switches back.
  await panel.getByRole("button", { name: "Make observations" }).click();
  await expect(
    page.locator('[data-testid="viewer-pin"][data-kind="observation"]'),
  ).toHaveCount(2);
  await expect(undo).toHaveAttribute(
    "title",
    "Undo: Make 2 items observations",
  );
  await undo.click();
  await expect(
    page.locator('[data-testid="viewer-pin"][data-kind="observation"]'),
  ).toHaveCount(0);

  // Still selecting: swap the third row for the second, then delete both;
  // one Undo brings both back.
  await panelRows(page).nth(2).getByRole("button").click();
  await panelRows(page).nth(1).getByRole("button").click();
  await panel.getByRole("button", { name: "Delete 2" }).click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
  await expect(pinByLetter(page, "A")).toBeVisible();
  await undo.click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(3);
});

test("the Drawings card on Pre-inspection opens the Pages view", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openTab(page, "Pre-inspection");
  await page.getByRole("link", { name: "Pages", exact: true }).click();
  const pages = page.getByRole("dialog", { name: "Pages" });
  await expect(pages).toBeVisible();
  await expect(pages.getByTestId("page-thumb")).toHaveCount(3);
  await pages.getByRole("button", { name: "Close" }).click();
  await expect(pages).toBeHidden();
  await expect(page).toHaveURL(/\/inspection$/);
});

test("deleting a drawing removes its items", async ({ page }) => {
  await setupInspection(page);
  const home = page.url();
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await page.goto(home);
  // Drawings are renamed and deleted on Pre-inspection.
  await openTab(page, "Pre-inspection");

  await page.getByRole("button", { name: "Delete S-101 Level 3" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete drawing?" });
  await expect(dialog).toContainText(
    "S-101 Level 3 and its 1 item will be removed",
  );
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No drawings yet.")).toBeVisible();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);
});

// Tagged @offline: runs in the Chromium project only (see playwright.config.ts).
test(
  "adds a drawing and pins offline",
  { tag: "@offline" },
  async ({ page, context }) => {
    await page.goto("./");
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.reload();

    // No project yet: drawings and pins work all the same.
    await startInspection(page, null);
    await openTab(page, "Inspection");
    await page
      .getByRole("button", { name: "Add synthetic test drawing" })
      .click();
    await openDrawing(page, "Synthetic test drawing");
    await addPinAt(page, 0.3, 0.3);
    await typeItem(page, "Offline item");
    await page.reload();
    await expect(sheet(page).getByRole("textbox")).toHaveValue("Offline item");
  },
);

// --- photos (step 6) ---------------------------------------------------------

const photoSection = (page: Page) =>
  sheet(page).getByRole("group", { name: "Photos" });

async function addPhotos(
  page: Page,
  input: "photo-camera-input" | "photo-library-input",
  files: Buffer[],
) {
  await page.getByTestId(input).setInputFiles(
    files.map((buffer, i) => ({
      name: `image-${i}.jpg`,
      mimeType: "image/jpeg",
      buffer,
    })),
  );
  await expect(page.getByTestId("photos-status")).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function viewerImageSize(page: Page) {
  const img = page.getByTestId("photo-viewer-image");
  await expect(img).toBeVisible();
  return img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    return { width: el.naturalWidth, height: el.naturalHeight };
  });
}

test("a camera photo is shrunk to 1600 px and kept with the item", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);

  await addPhotos(page, "photo-camera-input", [
    await syntheticJpeg(page, 4000, 3000),
  ]);
  await expect(photoSection(page)).toContainText("Photos (1)");
  await page.getByTestId("photo-thumb").click();
  expect(await viewerImageSize(page)).toEqual({ width: 1600, height: 1200 });
});

test("a photo taken on its side comes out upright", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);

  // Stored landscape with "rotate 90°" in its EXIF, like a portrait shot.
  await addPhotos(page, "photo-library-input", [
    await syntheticJpeg(page, 400, 200, 6),
  ]);
  await page.getByTestId("photo-thumb").click();
  expect(await viewerImageSize(page)).toEqual({ width: 200, height: 400 });
});

test("photos: choose several, caption, delete and undo", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);

  await addPhotos(page, "photo-library-input", [
    await syntheticJpeg(page, 800, 600),
    await syntheticJpeg(page, 600, 800),
  ]);
  await expect(page.getByTestId("photo-thumb")).toHaveCount(2);

  // Caption the second photo; it's kept after closing.
  await page.getByTestId("photo-thumb").nth(1).click();
  const viewer = page.getByTestId("photo-viewer");
  await expect(viewer).toContainText("photo 2 of 2");
  await viewer.getByLabel(/Caption/).fill("Lap at grid C");

  // Swipe right for the previous photo, then back with the arrow key.
  const area = (await page.getByTestId("photo-viewer-swipe").boundingBox())!;
  const y = area.y + area.height / 2;
  await page.mouse.move(area.x + area.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.7, y, { steps: 8 });
  await page.mouse.up();
  await expect(viewer).toContainText("photo 1 of 2");
  // The arrow keys work too (when not typing a caption).
  await viewer.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toContainText("photo 2 of 2");
  await expect(viewer.getByLabel(/Caption/)).toHaveValue("Lap at grid C");

  // Save closes the viewer; the caption is kept.
  await viewer.getByLabel(/Caption/).fill("Lap at grid C/4");
  await viewer.getByRole("button", { name: "Save" }).click();
  await expect(viewer).toHaveCount(0);
  await page.getByTestId("photo-thumb").nth(1).click();
  await expect(viewer.getByLabel(/Caption/)).toHaveValue("Lap at grid C/4");

  // Delete it, then Undo brings it back.
  await viewer.getByRole("button", { name: "Delete photo" }).click();
  await expect(page.getByTestId("photo-thumb")).toHaveCount(1);
  await viewer.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const pin = await centre(pinByLetter(page, "A"));
  await page.mouse.click(pin.x, pin.y);
  await expect(page.getByTestId("photo-thumb")).toHaveCount(2);
});

/** Replaces the Share sheet with a stand-in that records what was shared. */
async function stubShareSheet(page: Page) {
  await page.addInitScript(() => {
    const shared: { name: string; size: number }[][] = [];
    Object.assign(window, { sharedBatches: shared });
    // A touch device, as the iPad (WebKit here reports none).
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
    Object.defineProperty(navigator, "canShare", {
      value: (data: { files?: File[] }) => !!data.files?.length,
    });
    Object.defineProperty(navigator, "share", {
      value: async (data: { files: File[] }) => {
        shared.push(data.files.map((f) => ({ name: f.name, size: f.size })));
      },
    });
  });
}

const sharedBatches = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          sharedBatches: { name: string; size: number }[][];
        }
      ).sharedBatches,
  );

test("saving photos shares camera shots at full size, named by job and item", async ({
  page,
}) => {
  await stubShareSheet(page);
  await setupInspection(page);
  const home = page.url();
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  const original = await syntheticJpeg(page, 4000, 3000);
  await addPhotos(page, "photo-camera-input", [original]);
  await addPhotos(page, "photo-library-input", [
    await syntheticJpeg(page, 800, 600),
  ]);

  // From the item.
  await photoSection(page)
    .getByRole("button", { name: "Save to iPad" })
    .click();
  const dialog = page.getByTestId("save-photos-dialog");
  await dialog.getByRole("button", { name: "Save 2 photos" }).click();
  await expect(dialog).toContainText("All 2 photos have been saved.");
  let shared = await sharedBatches(page);
  expect(shared[0].map((f) => f.name)).toEqual([
    "SY000001 Instruction A 1.jpg",
    "SY000001 Instruction A 2.jpg",
  ]);
  // The camera shot is the untouched original.
  expect(shared[0][0].size).toBe(original.length);
  await dialog.getByRole("button", { name: "Done" }).click();

  // From the Site memo step, then free the full-size copy.
  await page.goto(home);
  await openTab(page, "Site memo");
  const section = page.locator('[aria-labelledby="photos-heading"]');
  await expect(page.getByTestId("photos-summary")).toContainText(
    "2 photos · 1 full-size camera copy kept",
  );
  await section.getByRole("button", { name: "Save photos to iPad" }).click();
  await dialog.getByRole("button", { name: "Save 2 photos" }).click();
  await expect(dialog).toContainText("All 2 photos have been saved.");
  await dialog.getByRole("button", { name: "Done" }).click();
  await section.getByRole("button", { name: "Free up space" }).click();
  await page
    .getByRole("dialog", { name: "Free up space?" })
    .getByRole("button", { name: "Free up space" })
    .click();
  await expect(page.getByTestId("photos-summary")).toHaveText("2 photos");
  await expect(section).toContainText("Freed");

  // Saving again now shares the 1600 px copy.
  await section.getByRole("button", { name: "Save photos to iPad" }).click();
  await dialog.getByRole("button", { name: "Save 2 photos" }).click();
  shared = await sharedBatches(page);
  expect(shared[2][0].size).toBeLessThan(original.length);
});

test("more than 20 photos save in batches", async ({ page }) => {
  await stubShareSheet(page);
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  const small = await syntheticJpeg(page, 120, 90);
  await addPhotos(
    page,
    "photo-library-input",
    Array.from({ length: 21 }, () => small),
  );
  await expect(photoSection(page)).toContainText("Photos (21)");

  await photoSection(page)
    .getByRole("button", { name: "Save to iPad" })
    .click();
  const dialog = page.getByTestId("save-photos-dialog");
  await expect(dialog).toContainText("Batch 1 of 2: photos 1–20 of 21.");
  await dialog.getByRole("button", { name: "Save 20 photos" }).click();
  await expect(dialog).toContainText("Batch 2 of 2: photos 21–21 of 21.");
  await dialog.getByRole("button", { name: "Save 1 photo" }).click();
  await expect(dialog).toContainText("All 21 photos have been saved.");
  expect((await sharedBatches(page)).map((b) => b.length)).toEqual([20, 1]);
});

test("photo viewer: a quick flick changes photo; neighbours are preloaded", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.5);
  await addPhotos(page, "photo-library-input", [
    await syntheticJpeg(page, 800, 600),
    await syntheticJpeg(page, 600, 800),
  ]);
  await page.getByTestId("photo-thumb").first().click();
  const viewer = page.getByTestId("photo-viewer");
  // The next photo is already in the strip, ready to slide in.
  await expect(viewer.locator(".photo-slide img")).toHaveCount(2);

  // A short, fast flick (well under a quarter of the width).
  const area = (await page.getByTestId("photo-viewer-swipe").boundingBox())!;
  const y = area.y + area.height / 2;
  const x = area.x + area.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 2 });
  await page.mouse.up();
  await expect(viewer).toContainText("photo 2 of 2");
});

test("general photos on the Site memo step save as General and delete with a confirm", async ({
  page,
}) => {
  await stubShareSheet(page);
  await setupInspection(page);
  await openTab(page, "Site memo");
  const section = page.locator('[aria-labelledby="photos-heading"]');
  const general = section.getByRole("group", { name: "General photos" });
  await addPhotos(page, "photo-library-input", [
    await syntheticJpeg(page, 800, 600),
    await syntheticJpeg(page, 600, 800),
  ]);
  await expect(general).toContainText("General photos (2)");

  await general.getByRole("button", { name: "Save to iPad" }).click();
  const dialog = page.getByTestId("save-photos-dialog");
  await dialog.getByRole("button", { name: "Save 2 photos" }).click();
  await expect(dialog).toContainText("All 2 photos have been saved.");
  expect((await sharedBatches(page))[0].map((f) => f.name)).toEqual([
    "SY000001 General 1.jpg",
    "SY000001 General 2.jpg",
  ]);
  await dialog.getByRole("button", { name: "Done" }).click();

  // The viewer names them General; deleting asks first (no Undo here).
  await general.getByTestId("photo-thumb").first().click();
  const viewer = page.getByTestId("photo-viewer");
  await expect(viewer).toContainText("General · photo 1 of 2");
  await viewer.getByRole("button", { name: "Delete photo" }).click();
  await page
    .getByRole("dialog", { name: "Delete this photo?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(general).toContainText("General photos (1)");
});

/** Drags a ≡ handle to the top of a row, with the mouse in small steps. */
async function dragHandle(page: Page, handle: Locator, toRow: Locator) {
  const at = await centre(handle);
  const row = (await toRow.boundingBox())!;
  await mouseDrag(page, at, { x: at.x, y: row.y + 4 });
}

test("pages: tick a page without pins for the export", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  await openPages(page);
  const pages = page.getByRole("dialog", { name: "Pages" });
  // A page with pins is always in.
  await pages.getByRole("button", { name: "Page 1 options" }).click();
  await expect(
    pages.getByRole("menuitemcheckbox", {
      name: "In export (has pins or markup)",
    }),
  ).toBeDisabled();
  await pages.getByRole("heading", { name: /Pages/ }).click();
  await pages.getByRole("button", { name: "Page 2 options" }).click();
  await pages
    .getByRole("menuitemcheckbox", { name: "Include in export" })
    .click();
  await expect(pages.getByTestId("page-included")).toHaveCount(1);
  await expect(pages.getByRole("status")).toHaveText(
    "1 page included in the export.",
  );
  await pages.getByRole("button", { name: "Close" }).click();

  // The Export card counts it.
  await openTab(page, "Site memo");
  await page.getByRole("button", { name: "Create memo" }).click();
  await expect(page.getByTestId("export-card")).toContainText(
    "2 pages (1 without pins)",
  );
});

test("pages: add a sketch page, change its sheet, delete it", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);

  await openPages(page);
  const pages = page.getByRole("dialog", { name: "Pages" });
  await pages.getByRole("button", { name: "Page 1 options" }).click();
  await pages.getByRole("menuitem", { name: "Add sketch page after…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add sketch page" });
  await dialog.getByLabel("Sheet").selectOption("A4");
  await dialog.getByLabel("Orientation").selectOption("portrait");
  await dialog.getByLabel("Scale").selectOption("1:50");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(pages.getByRole("status")).toHaveText("Sketch page added.", {
    timeout: 15_000,
  });
  // Page 2 is the sketch, in the export without pins.
  const sketch = pages.getByRole("button", {
    name: "Page 2: Sketch SK01 page 1",
  });
  await expect(sketch).toBeVisible();
  await expect(pages.getByTestId("page-included")).toHaveCount(1);

  // A bigger sheet, in landscape.
  await pages.getByRole("button", { name: "Page 2 options" }).click();
  await pages
    .getByRole("menuitem", { name: "Sketch sheet and scale…" })
    .click();
  const change = page.getByRole("dialog", { name: "Sketch page sheet" });
  await expect(change.getByLabel("Scale")).toHaveValue("1:50");
  await change.getByLabel("Sheet").selectOption("A1");
  await change.getByLabel("Orientation").selectOption("landscape");
  await change.getByRole("button", { name: "Change" }).click();
  await expect(pages.getByRole("status")).toHaveText("Sketch sheet changed.", {
    timeout: 15_000,
  });

  // It opens in the drawings like any page.
  await pages
    .getByRole("button", { name: "Page 2: Sketch SK01 page 1" })
    .click();
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    /Sketch SK01 · page 1 of 1/,
  );
  // Not a drawing in the Pre-inspection list.
  await openTab(page, "Pre-inspection");
  await expect(page.getByText("Sketch SK01")).toHaveCount(0);

  // Deleted (no pins: no question).
  await openTab(page, "Inspection");
  await openPages(page);
  await pages.getByRole("button", { name: "Page 2 options" }).click();
  await pages.getByRole("menuitem", { name: "Delete sketch page" }).click();
  await expect(pages.getByRole("button", { name: /Sketch SK01/ })).toHaveCount(
    0,
  );
});

test("pages: hold a page and drag it into another drawing", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [
    await typicalPdf("S-101 Level 3.pdf"),
    await typicalPdf("S-102 Level 4.pdf"),
  ]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  await openPages(page);
  const pages = page.getByRole("dialog", { name: "Pages" });
  const from = pages.getByRole("button", {
    name: "Page 1: S-101 Level 3 page 1",
  });
  const onto = pages.getByRole("button", {
    name: "Page 4: S-102 Level 4 page 1",
  });
  await expect(from).toContainText("1 pin");
  // Hold, then drag onto the right half of S-102's first page.
  const start = await centre(from);
  const box = (await onto.boundingBox())!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
    steps: 12,
  });
  await expect(pages.getByTestId("page-drag-label")).toHaveText(
    "Move to S-102 Level 4, after page 4",
  );
  await page.mouse.up();
  await expect(pages.getByRole("status")).toHaveText(
    "Page moved into S-102 Level 4.",
  );
  // It sits after S-102's first page, still its own sheet, with its pin.
  await expect(
    pages.getByRole("button", { name: "Page 1: S-101 Level 3 page 2" }),
  ).toBeVisible();
  await expect(
    pages.getByRole("button", { name: "Page 3: S-102 Level 4 page 1" }),
  ).toBeVisible();
  await expect(
    pages.getByRole("button", { name: "Page 4: S-101 Level 3 page 1" }),
  ).toContainText("1 pin");
  // A plain tap still goes to a page.
  await pages
    .getByRole("button", { name: "Page 4: S-101 Level 3 page 1" })
    .click();
  await expect(pages).toBeHidden();
  await expect(page.getByTestId("page-indicator")).toHaveAttribute(
    "data-label",
    /S-101 Level 3 · page 1 of 3/,
  );
});

test("pages: move a page within its drawing and reorder drawings", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [
    await typicalPdf("S-101 Level 3.pdf"),
    await typicalPdf("S-102 Level 4.pdf"),
  ]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await sheet(page).getByRole("button", { name: "Done" }).first().click();

  await openPages(page);
  const pages = page.getByRole("dialog", { name: "Pages" });

  // Page 1 (with its pin) moves after page 2; the menu follows it.
  await pages.getByRole("button", { name: "Page 1 options" }).click();
  await expect(
    pages.getByRole("menuitem", { name: "Move page earlier" }),
  ).toBeDisabled();
  await pages.getByRole("menuitem", { name: "Move page later" }).click();
  await expect(
    pages.getByRole("button", { name: "Page 2: S-101 Level 3 page 1" }),
  ).toContainText("1 pin");
  await expect(
    pages.getByRole("button", { name: "Page 1: S-101 Level 3 page 2" }),
  ).toBeVisible();
  await expect(pages.getByRole("menu", { name: "Page 2" })).toBeVisible();
  // The last page of a drawing can't move into the next drawing.
  await pages.getByRole("heading", { name: "Pages" }).click();
  await pages.getByRole("button", { name: "Page 3 options" }).click();
  await expect(
    pages.getByRole("menuitem", { name: "Move page later" }),
  ).toBeDisabled();

  // Move the second drawing to the front.
  await pages.getByRole("heading", { name: "Pages" }).click();
  await pages.getByRole("button", { name: "Page 4 options" }).click();
  await pages.getByRole("menuitem", { name: "Move drawing earlier" }).click();
  await expect(
    pages.getByRole("button", { name: "Page 1: S-102 Level 4 page 1" }),
  ).toBeVisible();
  // The menu stays open for another move; now it's first.
  await expect(
    pages.getByRole("menuitem", { name: "Move drawing earlier" }),
  ).toBeDisabled();

  // Reorder drawings… puts it back by dragging.
  await pages.getByRole("menuitem", { name: "Reorder drawings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Reorder drawings" });
  const rows = dialog
    .getByRole("list", { name: "Drawing order" })
    .getByRole("listitem");
  await expect(rows.first()).toContainText("S-102 Level 4");
  await dragHandle(
    page,
    dialog.getByRole("button", { name: "Reorder S-101 Level 3" }),
    rows.first(),
  );
  await expect(rows.first()).toContainText("S-101 Level 3");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    pages.getByRole("button", { name: "Page 1: S-101 Level 3 page 2" }),
  ).toBeVisible();
});

test("pre-inspection: drag a drawing to reorder; letters follow", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [
    await typicalPdf("S-101 Level 3.pdf"),
    await typicalPdf("S-102 Level 4.pdf"),
  ]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await typeItem(page, "On S-101");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await openDrawing(page, "S-102 Level 4");
  await addPinAt(page, 0.6, 0.3, 3);
  await typeItem(page, "On S-102");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await expect(pinByLetter(page, "B")).toHaveCount(1);

  await openTab(page, "Pre-inspection");
  const rows = page
    .getByRole("list", { name: "Drawings" })
    .getByRole("listitem");
  await expect(rows.first()).toContainText("S-101 Level 3");
  await dragHandle(
    page,
    page.getByRole("button", { name: "Reorder S-102 Level 4" }),
    rows.first(),
  );
  await expect(rows.first()).toContainText("S-102 Level 4");

  // S-102's pin is first in the document now, so it is instruction A.
  await openTab(page, "Inspection");
  await openDrawing(page, "S-102 Level 4");
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 of 6");
  await page.getByRole("button", { name: "Items" }).click();
  const itemRows = page.getByTestId("items-panel-row");
  await expect(itemRows.first()).toContainText("A. On S-102");
  await expect(itemRows.nth(1)).toContainText("B. On S-101");
});

test("copy pin: the same item at several spots, removable one by one", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  await addPinAt(page, 0.3, 0.3);
  await typeItem(page, "Grind back and patch");

  // Copy pin stays on: each tap places a copy until Done.
  await sheet(page).getByRole("button", { name: "Copy pin" }).click();
  await expect(page.locator(".viewer-hint-copy")).toContainText(
    "Tap each spot for a copy of Instruction A",
  );
  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(pinByLetter(page, "A")).toHaveCount(2);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await expect(pinByLetter(page, "A")).toHaveCount(3);
  await page
    .locator(".viewer-hint-copy")
    .getByRole("button", { name: "Done" })
    .click();
  await expect(page.locator(".viewer-hint-copy")).toHaveCount(0);

  // One item: the notes box lists it once; the sheet lists its pins.
  await expect(page.getByTestId("observation-box")).toHaveCount(1);
  await expect(page.getByTestId("observation-box")).toContainText(
    "INSTRUCTIONS:A. GRIND BACK AND PATCH",
  );
  const spots = sheet(page).getByRole("list", { name: "Pin spots" });
  await expect(spots.getByRole("listitem")).toHaveCount(3);

  // Remove one copy; Undo brings it back.
  await spots
    .getByRole("button", { name: "Remove the pin on Page 1" })
    .first()
    .click();
  await expect(pinByLetter(page, "A")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pinByLetter(page, "A")).toHaveCount(3);

  // (Undo closes the sheet.) The Items panel counts it once, with its pins.
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Items" }).click();
  await expect(panelRows(page)).toHaveCount(1);
  await expect(panelRows(page).first()).toContainText("3 pins");
  await page.getByRole("button", { name: "Items" }).click();

  // Tapping a copy opens the same item; editing it changes every pin.
  await pinByLetter(page, "A").nth(2).click();
  await expect(sheet(page).getByRole("textbox")).toHaveValue(
    "Grind back and patch",
  );
  await sheet(page)
    .getByRole("button", { name: "Observation", exact: true })
    .click();
  await expect(pinByLetter(page, "A", "observation")).toHaveCount(3);
});

/** A drag across a fraction of the first page (a mouse draws like a Pencil). */
async function drawLine(
  page: Page,
  from: [number, number],
  to: [number, number],
) {
  const box = await stageBox(page);
  const at = ([fx, fy]: [number, number]) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const a = at(from);
  const b = at(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

test("markup: no tool places nothing; pen draws, eraser erases, both undo", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const tool = (name: string) =>
    toolbar.getByRole("button", { name, exact: true });
  const marks = page.getByTestId("mark");
  await expect(tool("Pin")).toHaveAttribute("aria-pressed", "false");

  // With no tool on, a tap places no pin and a drag draws nothing.
  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);
  await drawLine(page, [0.2, 0.3], [0.5, 0.35]);
  await expect(marks).toHaveCount(0);

  // The pen draws in its colour; the weights and colours show for it.
  await tool("Pen").click();
  await expect(tool("Pen")).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", { name: "Colour #0165FC" }).click();
  await drawLine(page, [0.2, 0.3], [0.5, 0.35]);
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveAttribute("data-colour", "#0165FC");
  // Taps with the pen don't place pins either.
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);

  // The highlighter keeps its own colour.
  await tool("Highlighter").click();
  await drawLine(page, [0.2, 0.6], [0.6, 0.6]);
  await expect(marks).toHaveCount(2);
  await expect(page.locator('[data-tool="highlighter"]')).toHaveAttribute(
    "data-colour",
    "#FFFF00",
  );

  // Undo and Redo the highlight.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(marks).toHaveCount(1);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(marks).toHaveCount(2);

  // The eraser removes the pen line it crosses (one Undo step).
  await tool("Eraser").click();
  await drawLine(page, [0.35, 0.2], [0.35, 0.45]);
  await expect(marks).toHaveCount(1);
  await expect(page.locator('[data-tool="pen"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(marks).toHaveCount(2);

  // Tapping the tool again turns it off; Pin places pins.
  await tool("Eraser").click();
  await expect(tool("Eraser")).toHaveAttribute("aria-pressed", "false");
  await tool("Pin").click();
  await expect(toolbar).toContainText("Tap for an instruction");
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);
});

test("markup colours: the chosen colour's panel recolours it; Add colour goes at the end", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  await toolbar.getByRole("button", { name: "Pen", exact: true }).click();
  // The row's colours (the panel has its own).
  const swatches = toolbar.locator(".markup-toolbar-row > .markup-swatch");
  await expect(swatches).toHaveCount(6);

  // Choose blue, then tap it again: its panel opens.
  await toolbar.getByRole("button", { name: "Colour #0165FC" }).click();
  await toolbar.getByRole("button", { name: "Colour #0165FC" }).click();
  const panel = page.getByRole("group", { name: "Pen colour" });
  await expect(panel).toBeVisible();

  // Add colour: a new slot at the end, chosen; blue stays where it was.
  await panel.getByRole("button", { name: "Add colour" }).click();
  await expect(swatches).toHaveCount(7);
  await expect(swatches.nth(6)).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Use #E64C9A" }).click();
  await expect(swatches.nth(6)).toHaveAttribute("aria-label", "Colour #E64C9A");
  await expect(swatches.nth(1)).toHaveAttribute("aria-label", "Colour #0165FC");

  // Remove takes the chosen one away again.
  await panel.getByRole("button", { name: "Remove" }).click();
  await expect(swatches).toHaveCount(6);
});

test("shapes: a filled cloud, the eraser takes the fill off, arrows, and a held pen line straightens", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const tool = (name: string) =>
    toolbar.getByRole("button", { name, exact: true });
  const box = await stageBox(page);
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  // Each shape is its own button: drag out a cloud's box.
  await tool("Revision cloud").click();
  await drawLine(page, [0.2, 0.2], [0.45, 0.4]);
  const cloud = page.locator('[data-testid="mark"][data-tool="cloud"]');
  await expect(cloud).toHaveAttribute("data-filled", "true");

  // A tap inside it with the eraser takes the fill off; Undo puts it back.
  await tool("Eraser").click();
  const middle = at(0.325, 0.3);
  await page.mouse.click(middle.x, middle.y);
  await expect(cloud).toHaveAttribute("data-filled", "false");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cloud).toHaveAttribute("data-filled", "true");

  // An arrow, in any direction; tapping it again turns it off.
  await tool("Arrow").click();
  await expect(tool("Revision cloud")).toHaveAttribute("aria-pressed", "false");
  await drawLine(page, [0.6, 0.6], [0.75, 0.48]);
  await expect(
    page.locator('[data-testid="mark"][data-tool="arrow"]'),
  ).toHaveCount(1);

  // A pen stroke held still at its end becomes a straight line.
  await tool("Pen").click();
  const a = at(0.2, 0.7);
  const b = at(0.4, 0.75);
  const c = at(0.5, 0.65);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.waitForTimeout(800);
  await page.mouse.move(c.x, c.y, { steps: 5 });
  await page.mouse.up();
  await expect(
    page.locator('[data-testid="mark"][data-tool="line"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("mark")).toHaveCount(3);
  await tool("Pen").click();
  await expect(tool("Pen")).toHaveAttribute("aria-pressed", "false");
});

test("text callouts: hold and drag for a leader, tap for a box, select then edit, resize", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const textTool = toolbar.getByRole("button", { name: "Text", exact: true });
  const editor = page.getByRole("textbox", { name: "Callout text" });
  const callouts = page.getByTestId("callout");
  const box = await stageBox(page);
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  // Hold at the point referred to, drag the box out, and type.
  await textTool.click();
  await expect(toolbar.getByRole("button", { name: "Medium" })).toBeVisible();
  await expect(toolbar).toContainText("hold and drag for an arrow");
  const point = at(0.5, 0.42);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  const lift = at(0.25, 0.3);
  await page.mouse.move(lift.x, lift.y, { steps: 8 });
  await page.mouse.up();
  await expect(editor).toBeFocused();
  // Up and left of the point: the box hangs up and left from the lift (its
  // corner nearest the arrowhead there), growing away from the arrow.
  const typing = (await editor.boundingBox())!;
  expect(Math.abs(typing.x + typing.width - lift.x)).toBeLessThan(3);
  expect(Math.abs(typing.y + typing.height - lift.y)).toBeLessThan(3);
  await editor.pressSequentially("lap 600 min");
  // Turning the tool off finishes typing.
  await textTool.click();
  await expect(editor).toHaveCount(0);
  await expect(callouts).toHaveCount(1);
  await expect(callouts.first()).toHaveAttribute("aria-label", "LAP 600 MIN");
  // The point is to the right: a dog leg out of the box's right side.
  const leader = callouts.first().locator("polyline");
  await expect(leader).toHaveCount(1);
  expect((await leader.getAttribute("points"))!.split(" ")).toHaveLength(3);

  // A quick drag with Text on (no hold) places nothing.
  await textTool.click();
  await drawLine(page, [0.2, 0.6], [0.3, 0.65]);
  await expect(editor).toHaveCount(0);
  await expect(callouts).toHaveCount(1);
  await textTool.click();

  // With no tool on, a tap selects it and turns Text on; a second tap edits.
  const boxHit = callouts.first().getByTestId("callout-box");
  await boxHit.click();
  await expect(textTool).toHaveAttribute("aria-pressed", "true");
  await expect(callouts.first()).toHaveAttribute("data-selected", "true");
  await expect(editor).toHaveCount(0);
  await boxHit.click();
  await expect(editor).toHaveValue("LAP 600 MIN");
  await editor.fill("lap 900 min");
  // A tap on open space closes the editor and turns Text off altogether
  // (no new callout).
  const off = at(0.5, 0.75);
  await page.mouse.click(off.x, off.y);
  await expect(editor).toHaveCount(0);
  await expect(textTool).toHaveAttribute("aria-pressed", "false");
  await expect(callouts).toHaveCount(1);
  await expect(callouts.first()).toHaveAttribute("aria-label", "LAP 900 MIN");

  // Tapped with Pen on, a callout turns Text on; a tap on open space lets
  // it go and Pen comes back.
  const pen = toolbar.getByRole("button", { name: "Pen", exact: true });
  await pen.click();
  // A finger (the Pencil and mouse draw with Pen on).
  const hitBox = (await boxHit.boundingBox())!;
  await touchTap(page, {
    x: hitBox.x + hitBox.width / 2,
    y: hitBox.y + hitBox.height / 2,
  });
  await expect(textTool).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(off.x, off.y);
  await expect(callouts.first()).not.toHaveAttribute("data-selected", "true");
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await pen.click();

  // The side handle sets the width: the text wraps, the box gets taller.
  await boxHit.click();
  const height = Number(await boxHit.getAttribute("height"));
  const handle = (await callouts
    .first()
    .getByTestId("callout-resize")
    .boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 200,
    handle.y + handle.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await boxHit.getAttribute("height")))
    .toBeGreaterThan(height);
  // Its width stays when the text changes.
  const width = await boxHit.getAttribute("width");
  await boxHit.click();
  await editor.fill("lap 900 min c/c");
  await page.mouse.click(off.x, off.y);
  await expect(callouts.first()).toHaveAttribute(
    "aria-label",
    "LAP 900 MIN C/C",
  );
  await expect(boxHit).toHaveAttribute("width", width!);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => Number(await boxHit.getAttribute("height")))
    .toBe(height);

  // Dragging the box moves it; dragging the tip re-points the arrow.
  const before = (await leader.getAttribute("points"))!;
  const boxX = (await boxHit.getAttribute("x"))!;
  const grab = (await boxHit.boundingBox())!;
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grab.x + grab.width / 2 + 80,
    grab.y + grab.height / 2 + 40,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(boxHit).not.toHaveAttribute("x", boxX);
  const moved = (await leader.getAttribute("points"))!;
  expect(moved).not.toBe(before);
  const tip = (await callouts
    .first()
    .getByTestId("callout-tip")
    .boundingBox())!;
  await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    tip.x + tip.width / 2 - 60,
    tip.y + tip.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(leader).not.toHaveAttribute("points", moved);

  // With Text on from the toolbar, a finger tap places a box (no leader).
  // Left empty, it's dropped.
  await expect(textTool).toHaveAttribute("aria-pressed", "false");
  await textTool.click();
  await touchTap(page, at(0.2, 0.7));
  await expect(editor).toBeFocused();
  await textTool.click();
  await expect(callouts).toHaveCount(1);

  // Emptied, a callout goes; Undo brings it back.
  await textTool.click();
  await boxHit.click();
  await boxHit.click();
  await editor.fill("");
  await textTool.click();
  await expect(callouts).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(callouts).toHaveCount(1);

  // Like a pin, with no tool on: drag to move.
  await expect(textTool).toHaveAttribute("aria-pressed", "false");
  const x = (await boxHit.getAttribute("x"))!;
  const r = (await boxHit.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 60, r.y + r.height / 2 + 30, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(boxHit).not.toHaveAttribute("x", x);
  // No pin was placed by any of that.
  await expect(page.getByTestId("viewer-pin")).toHaveCount(0);
});

test("select: tap or loop to pick marks, move, recolour, weight, resize, duplicate, delete", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const tool = (name: string) =>
    toolbar.getByRole("button", { name, exact: true });
  const marks = page.getByTestId("mark");
  const selection = page.getByTestId("selection");
  const bar = page.getByRole("toolbar", { name: "Selection" });
  const box = await stageBox(page);
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const undo = page.getByRole("button", { name: "Undo" });

  // A pen stroke and a rectangle.
  await tool("Pen").click();
  await drawLine(page, [0.2, 0.4], [0.3, 0.45]);
  await tool("Rectangle").click();
  await drawLine(page, [0.4, 0.4], [0.5, 0.5]);
  await expect(marks).toHaveCount(2);

  // Select: a tap on the stroke picks it alone.
  await tool("Select").click();
  await expect(toolbar).toContainText("draw a loop round several");
  const onStroke = at(0.25, 0.425);
  await page.mouse.click(onStroke.x, onStroke.y);
  await expect(selection).toHaveAttribute("data-count", "1");
  // A tap on open space lets go; Select stays on.
  const off = at(0.8, 0.8);
  await page.mouse.click(off.x, off.y);
  await expect(selection).toHaveCount(0);
  await expect(tool("Select")).toHaveAttribute("aria-pressed", "true");

  // A loop round part of each picks both.
  const loop = [at(0.27, 0.35), at(0.45, 0.35), at(0.45, 0.47), at(0.27, 0.47)];
  await page.mouse.move(loop[0].x, loop[0].y);
  await page.mouse.down();
  for (const p of [...loop.slice(1), loop[0]])
    await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  await expect(selection).toHaveAttribute("data-count", "2");
  await expect(bar).toBeVisible();

  // Dragging inside the box moves both; Undo puts them back.
  const before = await marks.locator("path").first().getAttribute("d");
  const inside = at(0.45, 0.45);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(inside.x + 60, inside.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(marks.locator("path").first()).not.toHaveAttribute("d", before!);
  await undo.click();
  await expect(marks.locator("path").first()).toHaveAttribute("d", before!);

  // Recolour and thicken both (one Undo step each).
  await bar.getByRole("button", { name: "Colour" }).click();
  await page.getByRole("button", { name: "Use #1E9E4A" }).click();
  await expect(marks.nth(0)).toHaveAttribute("data-colour", "#1E9E4A");
  await expect(marks.nth(1)).toHaveAttribute("data-colour", "#1E9E4A");
  const width = await marks
    .locator("path")
    .first()
    .getAttribute("stroke-width");
  await bar.getByRole("button", { name: "Thick" }).click();
  await expect(marks.locator("path").first()).not.toHaveAttribute(
    "stroke-width",
    width!,
  );
  await undo.click();
  await undo.click();
  await expect(marks.nth(0)).not.toHaveAttribute("data-colour", "#1E9E4A");

  // Duplicate: copies become the selection; Delete removes them.
  await bar.getByRole("button", { name: "Duplicate" }).click();
  await expect(marks).toHaveCount(4);
  await expect(selection).toHaveAttribute("data-count", "2");
  await bar.getByRole("button", { name: "Delete" }).click();
  await expect(marks).toHaveCount(2);
  await expect(selection).toHaveCount(0);

  // One shape: its corner handle resizes it.
  const onRect = at(0.45, 0.45);
  await page.mouse.click(onRect.x, onRect.y);
  await expect(selection).toHaveAttribute("data-count", "1");
  const rect = page.locator('[data-tool="rect"] path').first();
  const shape = await rect.getAttribute("d");
  const corner = (await page.getByTestId("handle-se").boundingBox())!;
  await page.mouse.move(
    corner.x + corner.width / 2,
    corner.y + corner.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(corner.x + 80, corner.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(rect).not.toHaveAttribute("d", shape!);
  await undo.click();
  await expect(rect).toHaveAttribute("d", shape!);

  // Turning Select off lets go.
  await tool("Select").click();
  await expect(selection).toHaveCount(0);
});

test("draw and hold: a closed pen stroke becomes its shape; the highlighter's isn't filled", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const marks = page.getByTestId("mark");
  const box = await stageBox(page);
  /** Draws through the points (page fractions), holds still, then lifts. */
  async function drawAndHold(points: [number, number][]) {
    const at = ([fx, fy]: [number, number]) => ({
      x: box.x + box.width * fx,
      y: box.y + box.height * fy,
    });
    await page.mouse.move(at(points[0]).x, at(points[0]).y);
    await page.mouse.down();
    for (const p of points.slice(1))
      await page.mouse.move(at(p).x, at(p).y, { steps: 10 });
    await page.waitForTimeout(800);
    await page.mouse.up();
  }

  // A rectangle with the pen: the Rectangle shape, filled lightly.
  await toolbar.getByRole("button", { name: "Pen", exact: true }).click();
  await drawAndHold([
    [0.2, 0.3],
    [0.4, 0.3],
    [0.4, 0.45],
    [0.2, 0.45],
    [0.201, 0.305],
  ]);
  const kind = (tool: string) => page.locator(`[data-tool="${tool}"]`);
  await expect(marks).toHaveCount(1);
  await expect(kind("rect")).toHaveAttribute("data-filled", "true");

  // A triangle: a polygon through its corners.
  await drawAndHold([
    [0.5, 0.6],
    [0.6, 0.35],
    [0.7, 0.6],
    [0.502, 0.598],
  ]);
  await expect(kind("polygon")).toHaveCount(1);

  // An open stroke held: a straight line, as before.
  await drawAndHold([
    [0.2, 0.7],
    [0.3, 0.75],
    [0.4, 0.7],
  ]);
  await expect(kind("line")).toHaveCount(1);

  // With the highlighter: a box, not filled; Undo takes it away.
  await toolbar
    .getByRole("button", { name: "Highlighter", exact: true })
    .click();
  await drawAndHold([
    [0.75, 0.2],
    [0.9, 0.2],
    [0.9, 0.35],
    [0.75, 0.35],
    [0.751, 0.205],
  ]);
  await expect(marks).toHaveCount(4);
  await expect(kind("rect")).toHaveCount(2);
  await expect(
    kind("rect").and(page.locator('[data-filled="false"]')),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(marks).toHaveCount(3);
});

test("select: a callout tapped again opens for typing; its tip and width handles work", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const tool = (name: string) =>
    toolbar.getByRole("button", { name, exact: true });
  const editor = page.getByRole("textbox", { name: "Callout text" });
  const callout = page.getByTestId("callout");
  const box = await stageBox(page);
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  // A callout with an arrow (hold, drag), typed and finished.
  await tool("Text").click();
  const point = at(0.3, 0.55);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  const lift = at(0.5, 0.4);
  await page.mouse.move(lift.x, lift.y, { steps: 8 });
  await page.mouse.up();
  await editor.pressSequentially("check lap 600 min");
  await tool("Text").click();
  await expect(callout).toHaveCount(1);

  // With Select: a tap picks it, a second tap opens it; Select stays on.
  await tool("Select").click();
  const r = (await callout.getByTestId("callout-box").boundingBox())!;
  const centre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByTestId("selection")).toHaveAttribute(
    "data-count",
    "1",
  );
  await page.mouse.click(centre.x, centre.y);
  await expect(editor).toHaveValue("CHECK LAP 600 MIN");
  await editor.fill("check lap 900 min");
  const off = at(0.85, 0.85);
  await page.mouse.click(off.x, off.y);
  await expect(editor).toHaveCount(0);
  await expect(callout).toHaveAttribute("aria-label", "CHECK LAP 900 MIN");
  await expect(tool("Select")).toHaveAttribute("aria-pressed", "true");

  // Still picked: the width handle narrows it (the text wraps, taller).
  await expect(page.getByTestId("selection")).toHaveAttribute(
    "data-count",
    "1",
  );
  const hit = callout.getByTestId("callout-box");
  const height = Number(await hit.getAttribute("height"));
  const w = (await page.getByTestId("handle-width").boundingBox())!;
  await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2);
  await page.mouse.down();
  await page.mouse.move(w.x - 120, w.y + w.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await hit.getAttribute("height")))
    .toBeGreaterThan(height);

  // The tip handle re-points the arrow.
  const leader = callout.locator("polyline");
  const before = (await leader.getAttribute("points"))!;
  const tip = (await page.getByTestId("handle-tip").boundingBox())!;
  await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height / 2);
  await page.mouse.down();
  await page.mouse.move(tip.x - 40, tip.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(leader).not.toHaveAttribute("points", before);
});

test("draw and hold: dragging on after the shape snaps makes it bigger", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  await toolbar.getByRole("button", { name: "Pen", exact: true }).click();
  const box = await stageBox(page);
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const corners = [
    at(0.3, 0.3),
    at(0.4, 0.3),
    at(0.4, 0.4),
    at(0.3, 0.4),
    at(0.301, 0.303),
  ];
  await page.mouse.move(corners[0].x, corners[0].y);
  await page.mouse.down();
  for (const p of corners.slice(1))
    await page.mouse.move(p.x, p.y, { steps: 10 });
  await page.waitForTimeout(800);
  // Snapped: drag out, away from the middle, then lift.
  const out = at(0.2, 0.2);
  await page.mouse.move(out.x, out.y, { steps: 10 });
  await page.mouse.up();
  const rect = page.locator('[data-tool="rect"]');
  await expect(rect).toHaveCount(1);
  const drawn = (await rect.boundingBox())!;
  expect(drawn.width).toBeGreaterThan(box.width * 0.15);
});

test("two fingers double-tapped undo; a pinch doesn't", async ({ page }) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  await toolbar.getByRole("button", { name: "Pen", exact: true }).click();
  await drawLine(page, [0.2, 0.4], [0.5, 0.45]);
  await drawLine(page, [0.2, 0.6], [0.5, 0.65]);
  const marks = page.getByTestId("mark");
  await expect(marks).toHaveCount(2);
  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  const at = {
    x: viewer.x + viewer.width / 2,
    y: viewer.y + viewer.height / 2,
  };
  /** Two fingers down and straight up, `times` in a row. */
  const twoFingerTaps = (times: number) =>
    page.evaluate(
      ({ at, times }) => {
        const el = document.querySelector('[data-testid="drawing-viewer"]')!;
        const fire = (type: string, down: boolean) => {
          const touches = down
            ? [
                { clientX: at.x - 30, clientY: at.y },
                { clientX: at.x + 30, clientY: at.y },
              ]
            : [];
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, "touches", { value: touches });
          el.dispatchEvent(event);
        };
        for (let i = 0; i < times; i++) {
          fire("touchstart", true);
          fire("touchend", false);
        }
      },
      { at, times },
    );

  // One two-finger tap does nothing; two undo the last line.
  await twoFingerTaps(1);
  await page.waitForTimeout(600);
  await expect(marks).toHaveCount(2);
  await twoFingerTaps(2);
  await expect(marks).toHaveCount(1);
  await expect(page.locator(".viewer-toast")).toHaveText("Undo: Draw");

  // Pinching (fingers moving) never undoes.
  await pinch(page, at, 100, 160);
  await pinch(page, at, 160, 100);
  await page.waitForTimeout(300);
  await expect(marks).toHaveCount(1);
});

test("select: the rotate handle turns a shape (handles still resize it) and a group", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const tool = (name: string) =>
    toolbar.getByRole("button", { name, exact: true });
  const box = await stageBox(page);
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const undo = page.getByRole("button", { name: "Undo" });
  await tool("Rectangle").click();
  await drawLine(page, [0.35, 0.4], [0.55, 0.5]);
  await tool("Pen").click();
  await drawLine(page, [0.2, 0.7], [0.3, 0.75]);
  const rect = page.locator('[data-tool="rect"] path').first();
  const level = (await rect.getAttribute("d"))!;

  // One shape: drag its rotate handle a quarter turn.
  await tool("Select").click();
  const onRect = at(0.45, 0.45);
  await page.mouse.click(onRect.x, onRect.y);
  const handle = page.getByTestId("handle-rotate").locator("circle");
  const h = (await handle.boundingBox())!;
  const centre = at(0.45, 0.45);
  const grab = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  const r = centre.y - grab.y;
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (const a of [0.4, 0.8, 1.2, Math.PI / 2])
    await page.mouse.move(
      centre.x + r * Math.sin(a),
      centre.y - r * Math.cos(a),
      { steps: 4 },
    );
  await page.mouse.up();
  await expect(rect).not.toHaveAttribute("d", level);
  // Turned, it still resizes from its handles.
  await expect(page.getByTestId("handle-se")).toBeVisible();
  const turned = (await rect.getAttribute("d"))!;
  const se = (await page.getByTestId("handle-se").boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x - 30, se.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(rect).not.toHaveAttribute("d", turned);
  await undo.click();
  await undo.click();
  await expect(rect).toHaveAttribute("d", level);

  // A group: a loop round both, then turn them together.
  const pen = page.locator('[data-tool="pen"] path').first();
  const penBefore = (await pen.getAttribute("d"))!;
  const loop = [at(0.15, 0.35), at(0.6, 0.35), at(0.6, 0.8), at(0.15, 0.8)];
  await page.mouse.move(loop[0].x, loop[0].y);
  await page.mouse.down();
  for (const p of [...loop.slice(1), loop[0]])
    await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("selection")).toHaveAttribute(
    "data-count",
    "2",
  );
  const g = (await handle.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 120, g.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(pen).not.toHaveAttribute("d", penBefore);
  await expect(rect).not.toHaveAttribute("d", level);
});

test("general notes: no pin, lettered first, listed in every notes box; export keeps only marked pages", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3");
  const boxes = page.getByTestId("observation-box");
  // A pinned observation on page 1.
  await addPinAt(page, 0.4, 0.5);
  await sheet(page)
    .getByRole("button", { name: "Observation", exact: true })
    .click();
  await sheet(page).getByRole("textbox").fill("Crack at grid 4");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await expect(boxes).toHaveCount(1);

  // A general note from the Items panel: lettered A, the pin moves to B.
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await page.getByRole("button", { name: "Add general note" }).click();
  await expect(sheet(page)).toContainText("General note: no pin");
  await expect(
    sheet(page).getByRole("group", { name: "Item kind" }),
  ).toHaveCount(0);
  await sheet(page).getByRole("textbox").fill("Inspection limited to the roof");
  await expect(page.getByTestId("item-save-state")).toHaveText("Saved");
  await sheet(page).getByRole("button", { name: "Done" }).first().click();
  await expect(boxes.first()).toContainText(
    /A\. INSPECTION LIMITED TO THE ROOF[\s\S]*B\. CRACK AT GRID 4/,
  );
  // Every page shows a notes box now (all three pages of the drawing).
  await expect(boxes).toHaveCount(3);

  // The Items panel lists it under General.
  const panel = page.getByTestId("items-panel");
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "Items", exact: true }).click();
  await expect(panel).toContainText("General (every notes box)");
  await page.getByRole("button", { name: "Items", exact: true }).click();

  // Undo removes the general note, and the extra boxes go.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(boxes).toHaveCount(1);
  await expect(boxes.first()).toContainText("A. CRACK AT GRID 4");
});

test("a tap on a drawn mark picks it with no tool on; drawing tools keep drawing", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  const tool = (name: string) =>
    toolbar.getByRole("button", { name, exact: true });
  const selection = page.getByTestId("selection");
  const box = await stageBox(page);
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  // A pen stroke, then a tap right on it with the Pen still on (as when
  // writing): it makes a dot and selects nothing (engineer, 2026-10-20).
  await tool("Pen").click();
  await drawLine(page, [0.35, 0.45], [0.55, 0.45]);
  await expect(page.getByTestId("mark")).toHaveCount(1);
  const on = at(0.45, 0.45);
  await page.mouse.click(on.x, on.y);
  await expect(page.getByTestId("mark")).toHaveCount(2);
  await expect(selection).toHaveCount(0);
  await expect(tool("Pen")).toHaveAttribute("aria-pressed", "true");

  // A shape tool's tap on it doesn't pick it either.
  await tool("Rectangle").click();
  await page.mouse.click(on.x, on.y);
  await expect(selection).toHaveCount(0);
  await expect(tool("Rectangle")).toHaveAttribute("aria-pressed", "true");

  // With no tool on, a tap picks it and Select comes on; letting go goes
  // back to no tool.
  await tool("Rectangle").click();
  await touchTap(page, on);
  await expect(tool("Select")).toHaveAttribute("aria-pressed", "true");
  await expect(selection).toHaveAttribute("data-count", "1");
  const off = at(0.85, 0.85);
  await page.mouse.click(off.x, off.y);
  await expect(selection).toHaveCount(0);
  await expect(tool("Select")).toHaveAttribute("aria-pressed", "false");
});

test("diagnostics: off by default, switched on in Settings, shows each page on screen", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const panel = page.getByTestId("diagnostics");
  await expect(panel).toHaveCount(0);

  const rail = page.getByRole("navigation", { name: "Main" });
  await unlockDeveloperTools(page);
  await rail.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel(/Show diagnostics/).check();
  // The Inspections tab returns to the drawing.
  await rail.getByRole("link", { name: "Inspections" }).click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/Zoom 1\.0× fit/);
  await expect(panel).toContainText(/Page 1 · A1 \(841 × 594 mm\)/);
  await expect(panel).toContainText(/Base \d\.\d\d/);
  // WebKit here can't draw in the background: the main thread takes over.
  await expect(panel).toContainText(
    /Drawing on the (background|main thread \(not supported\))/,
  );
  await expect(panel).toContainText("Errors none");

  // Hide folds it to a chip; the chip opens it again.
  await panel.getByRole("button", { name: "Hide diagnostics" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(panel).toBeVisible();
});

test("saved page images: drawn from the PDF once, then shown from the saved image", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  // Saved after drawing (the pages on screen) and ahead (the rest).
  const savedCount = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("inspection-app");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const req = open.result
              .transaction("pageImages")
              .objectStore("pageImages")
              .count();
            req.onsuccess = () => {
              resolve(req.result);
              open.result.close();
            };
          };
        }),
    );
  await expect.poll(savedCount, { timeout: 15_000 }).toBe(3);

  // Opened again: from the saved images, no PDF drawing.
  const rail = page.getByRole("navigation", { name: "Main" });
  await unlockDeveloperTools(page);
  await rail.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel(/Show diagnostics/).check();
  await rail.getByRole("link", { name: "Inspections" }).click();
  const panel = page.getByTestId("diagnostics");
  await expect(panel).toContainText("from saved image");
  await expect(panel).not.toContainText("Preview");
  await expect(
    page.locator('[data-testid="drawing-viewer"][data-ready="true"]'),
  ).toBeVisible();
});

test("zoomed in and still, the markup shows from a crisp copy at screen size", async ({
  page,
}) => {
  await setupInspection(page);
  await uploadDrawings(page, [await typicalPdf()]);
  await openDrawing(page, "S-101 Level 3", false);
  const toolbar = page.getByRole("toolbar", { name: "Markup tools" });
  await toolbar.getByRole("button", { name: "Pen", exact: true }).click();
  await drawLine(page, [0.45, 0.45], [0.55, 0.5]);
  await toolbar.getByRole("button", { name: "Pen", exact: true }).click();
  await expect(page.getByTestId("mark")).toHaveCount(1);
  const crisp = page.getByTestId("crisp-overlay").first();
  // At fit width the page is shown as it is.
  await expect(crisp).toBeHidden();

  const box = await stageBox(page);
  await pinch(
    page,
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.47 },
    100,
    400,
  );
  // Settled: the copy holds the mark (display only: no test ids twice).
  await expect(crisp).toBeVisible();
  await expect(crisp.locator('[data-tool="pen"]')).toHaveCount(1);
  await expect(page.getByTestId("mark")).toHaveCount(1);
  await expect(page.locator(".page-overlay").first()).toHaveCSS("opacity", "0");

  // Touching the page shows the original; letting go brings the copy back.
  const viewer = (await page.getByTestId("drawing-viewer").boundingBox())!;
  await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + 200);
  await page.mouse.down();
  await expect(crisp).toBeHidden();
  await expect(page.locator(".page-overlay").first()).toHaveCSS("opacity", "1");
  await page.mouse.up();
  await expect(crisp).toBeVisible();
});

// Tagged @chromium: Playwright's desktop WebKit has no OffscreenCanvas in
// workers, so there (and in every other test) pages draw on the main
// thread, the fallback. Background drawing on the iPad is in the test plan.
test(
  "pages draw in the background and their saved images come from there",
  { tag: "@chromium" },
  async ({ page }) => {
    await setupInspection(page);
    await uploadDrawings(page, [await typicalPdf()]);
    await openDrawing(page, "S-101 Level 3", false);
    const rail = page.getByRole("navigation", { name: "Main" });
    await unlockDeveloperTools(page);
    await rail.getByRole("link", { name: "Settings" }).click();
    await page.getByLabel(/Show diagnostics/).check();
    await rail.getByRole("link", { name: "Inspections" }).click();
    const panel = page.getByTestId("diagnostics");
    await expect(panel).toContainText("Drawing on the background");
    await expect(
      page.locator('[data-testid="doc-page"][data-rendered="true"]').first(),
    ).toBeVisible();
    // Saved from the background drawings' PNGs (on screen and ahead).
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<number>((resolve, reject) => {
                const open = indexedDB.open("inspection-app");
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                  const req = open.result
                    .transaction("pageImages")
                    .objectStore("pageImages")
                    .count();
                  req.onsuccess = () => {
                    resolve(req.result);
                    open.result.close();
                  };
                };
              }),
          ),
        { timeout: 15_000 },
      )
      .toBe(3);

    // Zoomed in, the sharp image comes from the background too.
    const box = await stageBox(page);
    await pinch(
      page,
      { x: box.x + box.width * 0.5, y: box.y + box.height * 0.47 },
      100,
      400,
    );
    await expect(page.locator("canvas[data-x]").first()).toBeAttached({
      timeout: 10_000,
    });
    await expect(panel).toContainText(/Sharp \d\.\d\d/);
    // Then the areas round the view, drawn ahead and kept.
    await expect
      .poll(() => page.locator("canvas[data-x]").count(), { timeout: 15_000 })
      .toBeGreaterThan(2);
    await expect(panel).toContainText(/Sharp kept \d+ images/);
    await expect(panel).toContainText("Drawing on the background");
    await expect(panel).toContainText("Errors none");
  },
);

test("Settings, Developer: locked by a password; diagnostics and the lab inside", async ({
  page,
}) => {
  await page.goto("./#/settings");
  const card = page.locator("#developer");
  await expect(card.getByRole("heading", { name: "Developer" })).toBeVisible();
  await expect(page.getByLabel(/Show diagnostics/)).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Drawing lab" })).toHaveCount(0);
  await card.getByLabel("Password").fill("not it");
  await card.getByRole("button", { name: "Unlock" }).click();
  await expect(card.getByRole("alert")).toHaveText("Wrong password.");
  await expect(page.getByLabel(/Show diagnostics/)).toHaveCount(0);
  // The lab can't be reached by its address while locked.
  await page.goto("./#/lab/drawing");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await unlockDeveloperTools(page);
  await page.reload();
  await expect(page.getByLabel(/Show diagnostics/)).toBeVisible();
  await card.getByRole("link", { name: "Drawing lab" }).click();
  await expect(
    page.getByRole("heading", { name: "Drawing lab" }),
  ).toBeVisible();
  await page.goBack();
  await card.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByLabel(/Show diagnostics/)).toHaveCount(0);
  await expect(card.getByLabel("Password")).toBeVisible();
});

// @chromium: the background half needs OffscreenCanvas in workers.
test(
  "drawing lab: times a page on the main thread and in the background",
  { tag: "@chromium" },
  async ({ page }) => {
    await setupInspection(page);
    await uploadDrawings(page, [await typicalPdf()]);
    await openDrawing(page, "S-101 Level 3", false);
    await unlockDeveloperTools(page);
    await page.goto("./#/lab/drawing");
    await page.getByRole("button", { name: "Draw on main thread" }).click();
    const results = page.getByTestId("lab-results");
    await expect(results).toContainText(
      /Main thread 2× · \d+ ms · longest freeze \d+ ms/,
    );
    await page.getByRole("button", { name: "Draw in background" }).click();
    await expect(results).toContainText(
      /Background 2× · \d+ ms · longest freeze \d+ ms/,
    );
    await page
      .getByRole("button", { name: "Two areas: one drawer, then two" })
      .click();
    await expect(results).toContainText(
      /Two areas, one drawer 2× · \d+ ms · longest freeze \d+ ms/,
    );
    await expect(results).toContainText(
      /Two areas, two drawers 2× · \d+ ms · longest freeze \d+ ms/,
    );
    // Copied results never hold the drawing's name.
    await expect(results).not.toContainText("S-101");
  },
);
