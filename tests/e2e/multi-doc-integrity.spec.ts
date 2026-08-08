import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
} from "./helpers";

/**
 * Guards the invariant behind a reported overwrite bug: creating a second page
 * must never clobber the content of an existing one. Creates two distinct
 * documents back-to-back, then reopens the first from the sidebar and asserts
 * it still holds its own content (and not the second document's).
 *
 * This is a regression net for the doc-identity / save-target race — each save
 * must land on its own address, and switching documents must not bleed editor
 * content across pages.
 */

test("creating a new page does not overwrite an existing one", async ({ page }) => {
  const a = `e2e-A-${Date.now()}`;
  const b = `e2e-B-${Date.now()}`;

  await loginAsGuest(page);

  // Page A
  await typeIntoEditor(page, `# ${a}\n\nAAA body ${a}`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });
  const urlA = page.url();

  // Page B (fresh draft)
  await page.getByRole("button", { name: "New Document" }).click();
  await typeIntoEditor(page, `# ${b}\n\nBBB body ${b}`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });
  expect(page.url()).not.toBe(urlA);

  // Reopen A from the sidebar and confirm it kept its own content.
  await page.getByRole("button", { name: new RegExp(a) }).click();
  await expect(page.getByText(`AAA body ${a}`, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`BBB body ${b}`, { exact: false })).toHaveCount(0);

  // And B still holds B's content.
  await page.getByRole("button", { name: new RegExp(b) }).click();
  await expect(page.getByText(`BBB body ${b}`, { exact: false })).toBeVisible({ timeout: 20_000 });
});
