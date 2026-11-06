// Phone layout (engineer, 2026-11-06; SPEC section 12a): every screen fits
// a phone's width, and an inspection runs end to end. Tagged @phone: runs
// in the iphone-webkit and android-chromium projects only.
import { expect, test, type Page } from "@playwright/test";
import {
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../src/features/drawings/fixtures/syntheticDrawing";
import { openTab, pinToolOn, stageBox, startInspection } from "./helpers";

/** Nothing on the screen is wider than the phone. */
async function expectFits(page: Page, where: string) {
  const wide = await page.evaluate(() => {
    const out: string[] = [];
    const check = (el: Element | null) => {
      if (el && el.scrollWidth > el.clientWidth + 1)
        out.push(`${el.className}: ${el.scrollWidth} > ${el.clientWidth}`);
    };
    check(document.documentElement);
    check(document.querySelector(".shell-main"));
    check(document.querySelector(".app-bar"));
    check(document.querySelector(".rail"));
    return out;
  });
  expect(wide, where).toEqual([]);
}

test("on a phone, every screen fits and an inspection runs end to end @phone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("./");
  const nav = page.getByRole("navigation", { name: "Main" });

  // The main areas are along the bottom.
  const bar = await nav.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bar!.y + bar!.height).toBeGreaterThan(viewport.height - 100);
  await expectFits(page, "Dashboard, empty");
  await expect(
    page.getByText("Everything stays on this device."),
  ).toBeVisible();

  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expectFits(page, "Settings");

  // Pre-inspection.
  await nav.getByRole("link", { name: "Dashboard" }).click();
  await startInspection(page, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
  });
  await page
    .getByLabel("Item inspected", { exact: true })
    .fill("Level 3 slab reinforcement");
  await page.getByLabel("Client name", { exact: true }).fill("Alex Example");
  await page
    .getByLabel("Client company", { exact: true })
    .fill("Example Builders Pty Ltd");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  // The steps fit, Pre-inspection shortened (its full name for screen readers).
  const steps = page.getByRole("navigation", { name: "Inspection sections" });
  await expect(steps).toContainText("Pre-insp.");
  await expect(
    steps.getByRole("link", { name: "Pre-inspection", exact: true }),
  ).toBeVisible();
  await expectFits(page, "Pre-inspection");

  // Inspection: a drawing and a pin.
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
  await sheet.getByRole("textbox").fill("Add N12 bar at grid C/4");
  await expect(page.getByTestId("item-save-state")).toHaveText("Saved");
  await expectFits(page, "Inspection, item sheet");
  await sheet.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByTestId("viewer-pin")).toHaveCount(1);

  // Site memo: recipients stacked, then the PDF.
  await openTab(page, "Site memo");
  await page.getByRole("button", { name: "Create memo" }).click();
  await expect(page.getByLabel("Recipient 1 company")).toHaveValue(
    "Example Builders Pty Ltd",
  );
  await expectFits(page, "Site memo");
  const exportCard = page.getByTestId("export-card");
  await exportCard.getByRole("button", { name: "Export PDF" }).click();
  await expect(exportCard.getByTestId("export-file")).toContainText(
    "SY000001-SIM001-A-Level 3 slab reinforcement.pdf",
    { timeout: 30_000 },
  );
  await expectFits(page, "Site memo, exported");

  // The lists, with the inspection on them.
  await nav.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await expectFits(page, "Dashboard");
  await page.goto("./#/inspections");
  await expect(
    page.getByRole("list", { name: "Recent inspections" }),
  ).toContainText("Level 3 slab reinforcement");
  await expectFits(page, "Inspections");
});
