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

test("accent colour can be changed from the toolbar", async ({ page }) => {
  await loginAsGuest(page);
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "New page" }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Start a new page" });
  await dialog.getByRole("button", { name: "Start with Resume", exact: true }).click();
  await page.waitForTimeout(500);

  const colorInput = page.locator('input[type="color"]').first();
  await expect(colorInput).toBeAttached();
  await colorInput.evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "#ef4444");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(400);

  const color = await page
    .locator("[data-pages-page] h2")
    .first()
    .evaluate((element) => getComputedStyle(element).color);
  expect(color).toBe("rgb(239, 68, 68)");
});

test("text colour applies to a single heading and survives reload", async ({ page }) => {
  await loginAsGuest(page);
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "New page" }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Start a new page" });
  await dialog.getByRole("button", { name: "Start with Resume", exact: true }).click();
  await page.waitForTimeout(500);

  await page.getByText("Summary", { exact: true }).click();
  const colorInput = page
    .getByRole("button", { name: "Text colour" })
    .locator('input[type="color"]');
  await colorInput.evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "#ef4444");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(400);

  const headingColor = async () =>
    page
      .locator("[data-pages-page] h2 span")
      .first()
      .evaluate((element) => getComputedStyle(element).color);
  expect(await headingColor()).toBe("rgb(239, 68, 68)");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await unlockAfterReload(page);

  expect(await headingColor()).toBe("rgb(239, 68, 68)");
});

test("all starter templates open with their starter content", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await loginAsGuest(page);
  await page.getByRole("button", { name: "All pages" }).click();

  const templates: Array<[string, string]> = [
    ["Resume", "Alex Morgan"],
    ["Letterhead", "Brand partnership proposal"],
    ["Cover letter", "Cover letter"],
    ["Invoice", "Invoice"],
    ["Project brief", "Project brief"],
    ["Daily planner", "Daily plan"],
    ["Weekly planner", "Weekly plan"],
    ["Journal", "Journal"],
    ["Journal index", "Journal index"],
    ["Meeting notes", "Meeting notes"],
  ];

  for (const [name, heading] of templates) {
    await page.getByRole("button", { name: "New page" }).first().click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Start a new page" });
    await dialog
      .getByRole("button", { name: `Start with ${name}`, exact: true })
      .click();
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "All pages" }).click();
  }
});
