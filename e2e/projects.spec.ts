import { expect, test, type Locator, type Page } from "@playwright/test";
import { centre, openTab, startInspection } from "./helpers";

const field = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });

const PROJECT = { jobNumber: "SY000001", jobName: "Example Apartments" };

/** Drags a ≡ handle up to the top of a row, with the mouse in small steps. */
async function dragUp(page: Page, handle: Locator, toRow: Locator) {
  const at = await centre(handle);
  const row = (await toRow.boundingBox())!;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, row.y + 4, { steps: 10 });
  await page.mouse.up();
}

/** The Inspections tab, where Projects sit beside Recent inspections. */
async function openProjects(page: Page) {
  await page.goto("./#/inspections");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("inspections in a project share its details", async ({ page }) => {
  await page.goto("./");
  await startInspection(page, PROJECT);
  await field(page, "Client company").fill("Example Builders Pty Ltd");
  await field(page, "Item inspected").fill("Level 3 slab");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");

  await openProjects(page);
  const projects = page.getByRole("list", { name: "Projects" });
  await expect(projects).toContainText("SY000001 – Example Apartments");
  await expect(projects).toContainText(
    "Example Builders Pty Ltd · 1 inspection",
  );
  await projects.getByRole("link", { name: /^SY000001/ }).click();
  await expect(field(page, "Client company")).toHaveValue(
    "Example Builders Pty Ltd",
  );

  // A second inspection from the project page starts with the same details.
  await page.getByRole("button", { name: "New inspection" }).click();
  await expect(page).toHaveURL(/\/details$/);
  await expect(field(page, "Client company")).toHaveValue(
    "Example Builders Pty Ltd",
  );
  await expect(field(page, "Item inspected")).toHaveValue("");

  // Renaming the job here renames it for both.
  await field(page, "Job name").fill("Example Towers");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByTestId("project-link").click();
  await expect(page.getByTestId("project-title")).toHaveText(
    "SY000001 – Example Towers",
  );
  const listed = page.getByRole("list", { name: "Project inspections" });
  await expect(listed.getByRole("listitem")).toHaveCount(2);
  await expect(listed.getByRole("listitem").first()).toContainText(
    "SY000001 – Example Towers",
  );
});

test("a job number already used offers the existing project", async ({
  page,
}) => {
  await page.goto("./");
  await startInspection(page, PROJECT);
  await page.goto("./");
  await page.getByRole("button", { name: "New inspection" }).click();
  const dialog = page.getByRole("dialog", { name: "New inspection" });
  await dialog.getByLabel("Job number", { exact: true }).fill("sy000001");
  await expect(dialog.getByTestId("duplicate-job")).toContainText(
    "SY000001 – Example Apartments",
  );
  await dialog.getByRole("button", { name: "Use that project" }).click();
  await expect(field(page, "Job name")).toHaveValue("Example Apartments");

  await openProjects(page);
  await expect(
    page.getByRole("list", { name: "Projects" }).getByRole("listitem"),
  ).toHaveCount(1);
});

test("an inspection without a project is flagged until it gets one", async ({
  page,
}) => {
  await page.goto("./");
  await startInspection(page, PROJECT);
  await page.goto("./");
  await startInspection(page, null);
  await expect(page.getByTestId("needs-project")).toContainText(
    "Needs a project",
  );
  await expect(field(page, "Job number")).toHaveCount(0);
  await field(page, "Item inspected").fill("Footings");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");

  // Flagged in Recent; it opens on Pre-inspection.
  await page.goto("./#/inspections");
  const flagged = page
    .getByRole("list", { name: "Recent inspections" })
    .getByRole("listitem")
    .filter({ hasText: "Needs a project" });
  await expect(flagged).toHaveCount(1);
  await flagged.getByRole("link").click();

  // Assign it to the existing project.
  await page.getByRole("button", { name: "Assign to project" }).click();
  await page
    .getByRole("dialog", { name: "Assign to project" })
    .getByRole("button", { name: /^SY000001 – Example Apartments/ })
    .click();
  await expect(page.getByTestId("needs-project")).toHaveCount(0);
  await expect(field(page, "Job number")).toHaveValue("SY000001");
  await expect(field(page, "Item inspected")).toHaveValue("Footings");

  // Another one gets a project of its own.
  await page.goto("./");
  await startInspection(page, null);
  await page.getByRole("button", { name: "Create new project" }).click();
  const dialog = page.getByRole("dialog", { name: "Create new project" });
  await dialog.getByLabel("Job number", { exact: true }).fill("SY000002");
  await dialog.getByLabel("Job name", { exact: true }).fill("Example Shed");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("inspection-title")).toHaveText(
    "SY000002 – Example Shed",
  );

  // And can move to another project later.
  await page.getByRole("button", { name: "Change project" }).click();
  await page
    .getByRole("dialog", { name: "Change project" })
    .getByRole("button", { name: /^SY000001 – Example Apartments/ })
    .click();
  await expect(page.getByTestId("inspection-title")).toHaveText(
    "SY000001 – Example Apartments",
  );
});

test("recipients typed into a memo become the project's contacts", async ({
  page,
}) => {
  await page.goto("./");
  await startInspection(page, PROJECT);
  await field(page, "Client name").fill("Alex Example");
  await field(page, "Client company").fill("Example Builders Pty Ltd");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await openTab(page, "Site memo");
  await page.getByRole("button", { name: "Create memo" }).click();
  await page.getByRole("button", { name: "Add recipient" }).click();
  await page.getByLabel("Recipient 2 company").fill("Example Certifiers");
  await page.getByLabel("Recipient 2 attention").fill("Sam Sample");
  await page.getByLabel("Salutation").click(); // leave the row
  await expect(page.getByTestId("memo-save-state")).toHaveText("Saved");

  // The project lists the client and the new recipient.
  await page.goto("./");
  await openProjects(page);
  await page.getByRole("link", { name: /^SY000001/ }).click();
  const contacts = page.getByRole("table", { name: "Contacts" });
  await expect(contacts.getByRole("row")).toHaveCount(3); // with the heading
  await expect(page.getByLabel("Contact 2 attention")).toHaveValue(
    "Sam Sample",
  );

  // A memo on another inspection in the project offers them.
  await page.getByRole("button", { name: "New inspection" }).click();
  await openTab(page, "Site memo");
  await page.getByRole("button", { name: "Create memo" }).click();
  await page
    .getByLabel("Add from contacts")
    .selectOption({ label: "Sam Sample, Example Certifiers" });
  await expect(page.getByLabel("Recipient 2 company")).toHaveValue(
    "Example Certifiers",
  );
  await expect(page.getByLabel("Recipient 2 copy")).toBeChecked();

  // Drag ≡ to reorder the memo's recipients.
  const recipients = page.getByRole("table", { name: "Recipients" });
  await dragUp(
    page,
    page.getByLabel("Reorder recipient 2"),
    recipients.getByRole("row").nth(1),
  );
  await expect(page.getByLabel("Recipient 1 company")).toHaveValue(
    "Example Certifiers",
  );
  await expect(page.getByLabel("Recipient 2 company")).toHaveValue(
    "Example Builders Pty Ltd",
  );
  await expect(page.getByTestId("memo-save-state")).toHaveText("Saved");

  // And the project's contacts (the order "Add from contacts" offers).
  await page.goto("./");
  await openProjects(page);
  await page.getByRole("link", { name: /^SY000001/ }).click();
  await dragUp(
    page,
    page.getByLabel("Reorder contact 2"),
    contacts.getByRole("row").nth(1),
  );
  await expect(page.getByLabel("Contact 1 attention")).toHaveValue(
    "Sam Sample",
  );
  await page.reload();
  await expect(page.getByLabel("Contact 1 attention")).toHaveValue(
    "Sam Sample",
  );
});

test("a project's own memo reference letters", async ({ page }) => {
  await page.goto("./");
  await startInspection(page, PROJECT);
  await openProjects(page);
  await page.getByRole("link", { name: /^SY000001/ }).click();
  await expect(page.getByTestId("reference-example")).toContainText(
    "SIM001, SIM002",
  );
  await page.getByLabel("Memo reference letters").fill("ssi");
  await expect(page.getByTestId("reference-example")).toContainText(
    "SSI001, SSI002",
  );
  await page.getByLabel("Memo reference letters").blur();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByRole("button", { name: "New inspection" }).click();
  await openTab(page, "Site memo");
  await page.getByRole("button", { name: "Create memo" }).click();
  await expect(page.getByLabel("Reference", { exact: true })).toHaveValue(
    "SSI001",
  );
});

test("deleting a project says how many inspections go with it", async ({
  page,
}) => {
  await page.goto("./");
  await startInspection(page, PROJECT);
  await page.goto("./");
  await startInspection(page, { ...PROJECT, existing: true });
  await page.getByTestId("project-link").click();
  await page.getByRole("button", { name: "Delete project" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete project?" });
  await expect(dialog).toContainText("2 inspections");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Delete project" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  // Nothing left: the list is empty and the Dashboard shows its start.
  await expect(page.getByText("No projects yet")).toBeVisible();
  await expect(page.getByText("No inspections yet")).toBeVisible();
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Start your first inspection" }),
  ).toBeVisible();
});

test("back returns to the screen an inspection or project was opened from", async ({
  page,
}) => {
  await page.goto("./");
  await startInspection(page, PROJECT);
  // Inspections → project → inspection: back goes to the project, then
  // the Inspections list.
  await page.goto("./#/inspections");
  await page
    .getByRole("link", { name: /Example Apartments/ })
    .last()
    .click();
  await expect(page.getByTestId("project-title")).toBeVisible();
  await page
    .getByRole("list", { name: "Project inspections" })
    .getByRole("link")
    .click();
  await openTab(page, "Site memo");
  await page.getByRole("link", { name: "Back to project" }).click();
  await expect(page.getByTestId("project-title")).toHaveText(
    "SY000001 – Example Apartments",
  );
  await page.getByRole("link", { name: "Back to inspections" }).click();
  await expect(
    page.getByRole("list", { name: "Recent inspections" }),
  ).toBeVisible();

  // Inspection → its project: back goes to the inspection.
  await page
    .getByRole("list", { name: "Recent inspections" })
    .getByRole("link")
    .click();
  await openTab(page, "Pre-inspection");
  await page.getByTestId("project-link").click();
  await page.getByRole("link", { name: "Back to inspection" }).click();
  await expect(page).toHaveURL(/\/details$/);
});

test("Recent shows the last 10 inspections edited", async ({ page }) => {
  test.slow(); // creates 11 inspections
  await page.goto("./");
  for (let i = 0; i < 11; i++) {
    await startInspection(page, null);
    await field(page, "Item inspected").fill(`Item ${i + 1}`);
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await page.goto("./");
  }
  await page.goto("./#/inspections");
  const recent = page.getByRole("list", { name: "Recent inspections" });
  await expect(recent.getByRole("listitem")).toHaveCount(10);
  await expect(recent.getByRole("listitem").first()).toContainText("Item 11");
  await expect(recent.getByText("Item 1", { exact: true })).toHaveCount(0);
  // Older ones still needing a project stay listed underneath.
  await expect(
    page.getByRole("list", { name: "Needs a project" }),
  ).toContainText("Item 1");
});
