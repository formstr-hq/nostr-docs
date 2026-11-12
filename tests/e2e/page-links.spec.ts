import { test, expect } from "@playwright/test";
import { loginAsGuest, save, unlockAfterReload } from "./helpers";

test("creates and links a new page from the editor", async ({ page }) => {
  await loginAsGuest(page);
  await page.getByRole("button", { name: "All pages" }).click();

  await page.getByRole("button", { name: "New page" }).first().click();
  const picker = page.getByRole("dialog").filter({ hasText: "Start a new page" });
  await picker.getByRole("button", { name: "Start with Blank page" }).click();

  const surface = page.locator(".tiptap").first();
  await surface.click();
  await page.keyboard.type("# Index");
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  // Saved docs open in preview; switch to the visual editor to insert a link.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Link to page" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Link a page" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Page title").fill("Linked page");
  await dialog.getByRole("button", { name: "Create & link" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText("Linked page", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  const indexUrl = page.url();

  await page.reload();
  await unlockAfterReload(page);

  await page.getByText("Linked page", { exact: true }).first().click();
  await expect(page).not.toHaveURL(indexUrl, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Linked page" }).first()).toBeVisible({
    timeout: 20_000,
  });
});
