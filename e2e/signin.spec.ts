// Local sign-in (engineer, 2026-11-27; SPEC section 12b). The other tests
// start signed in (playwright.config.ts); these start signed out. The real
// username and password stay out of the repo, so only a wrong pair is typed.
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("signed out, the app asks to sign in; a wrong pair is refused", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Northrop Hardhat" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  const signIn = page.getByRole("button", { name: "Sign in" });
  await expect(signIn).toBeDisabled();

  await page.getByLabel("Username").fill("someone");
  await page.getByLabel("Password").fill("not it");
  await signIn.click();
  await expect(page.getByRole("alert")).toContainText(
    "That username or password isn’t right.",
  );
  await expect(page.getByLabel("Password")).toHaveValue("");
  // A route behind it shows the sign-in screen too.
  await page.goto("./#/settings");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("Sign out in Settings goes back to the sign-in screen", async ({
  page,
}) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.setItem("hardhat-signed-in", "1"));
  await page.goto("./#/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
