import { test, expect } from "@playwright/test";
import { loginAsGuest, unlockAfterReload } from "./helpers";

/**
 * The rich resume is the visible payoff of the ProseMirror document kind: a
 * real two-column section (skills sidebar) that survives save + reload.
 */
test("rich resume template keeps its two-column sidebar", async ({ page }) => {
  await loginAsGuest(page);
  await page.getByRole("button", { name: "All pages" }).click();

  await page.getByRole("button", { name: "New page" }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Start a new page" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Start with Resume" }).click();

  await expect(page).toHaveURL(/\/new/, { timeout: 10_000 });
  await expect(page.locator("[data-columns]")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Skills", { exact: true })).toBeVisible();
  await expect(page.getByText("Senior Product Designer", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/doc\/naddr1/);

  await page.reload();
  await unlockAfterReload(page);

  await expect(page.locator("[data-columns]")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Skills", { exact: true })).toBeVisible();

  // The sidebar must not collapse into a single column on a narrow window in
  // fixed-page mode; responsive mode may reflow it.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(500);
  const columnsCount = async () =>
    page
      .locator("[data-columns]")
      .first()
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);

  expect(await columnsCount()).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Switch to responsive layout" }).click();
  await page.waitForTimeout(400);
  expect(await columnsCount()).toBe(1);

  await page.getByRole("button", { name: "Switch to fixed page layout" }).click();
  await page.waitForTimeout(400);
  expect(await columnsCount()).toBeGreaterThan(1);
});
