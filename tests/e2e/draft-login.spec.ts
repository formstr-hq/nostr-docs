import { test, expect } from "@playwright/test";
import { createAccountFromOpenModal, editorSurface } from "./helpers";

/**
 * A draft typed while logged out must not vanish when you log in. Logging in
 * remounts the account-scoped subtree (which is what keeps one account's data
 * from bleeding into the next), and that used to discard the in-progress draft.
 */

test("a draft typed while logged out survives login and can be saved", async ({
  page,
}) => {
  await page.goto("/new");
  await editorSurface(page).click();
  await page.keyboard.type("# My draft\n\nstill here after login");

  // While logged out the primary action is "Login".
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await createAccountFromOpenModal(page);

  // Same page, same draft — and now a "Save" action.
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator("h1", { hasText: "My draft" })).toBeVisible();
  await expect(page.getByText("still here after login")).toBeVisible();

  // The draft can be saved under the new account.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "My draft" })).toBeVisible({
    timeout: 20_000,
  });
});

test("an unsaved draft survives a reload", async ({ page }) => {
  await page.goto("/new");
  await editorSurface(page).click();
  await page.keyboard.type("# Reload me\n\npersisted draft");
  await expect(page.locator("h1", { hasText: "Reload me" })).toBeVisible();
  // Let the debounced draft write land.
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.locator("h1", { hasText: "Reload me" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("persisted draft")).toBeVisible();
});

test("saving a draft clears it so a fresh page starts empty", async ({ page }) => {
  await page.goto("/new");
  await editorSurface(page).click();
  await page.keyboard.type("# Saved away\n\nbody");
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: "Login", exact: true }).click();
  await createAccountFromOpenModal(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  // A new page must not resurrect the saved draft.
  await page.goto("/new");
  await expect(page.locator("h1", { hasText: "Saved away" })).toBeHidden();
  await expect(editorSurface(page)).toHaveText("");
});
