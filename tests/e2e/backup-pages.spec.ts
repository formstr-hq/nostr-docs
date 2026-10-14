import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { loginAsGuest, typeIntoEditor, save } from "./helpers";

/**
 * Backup/export feature: any selection of pages can be downloaded as a single
 * zip of raw Markdown files. This drives the real dialog from the account menu,
 * exercises the selectable list, and unzips the download to prove every chosen
 * page made it in with its own content under a title-derived filename.
 */

test("backs up selected pages as a zip of markdown files", async ({ page }) => {
  const stamp = Date.now();
  const titleA = `Backup Alpha ${stamp}`;
  const titleB = `Backup Beta ${stamp}`;
  const bodyA = `alpha body ${stamp}`;
  const bodyB = `beta body ${stamp}`;

  await loginAsGuest(page);

  // Page A
  await typeIntoEditor(page, `# ${titleA}\n\n${bodyA}`);
  await save(page);

  // Page B
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await typeIntoEditor(page, `# ${titleB}\n\n${bodyB}`);
  await save(page);

  // Open the account menu in the sidebar, then the backup dialog.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Backup pages/ }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Backup pages" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const checkboxA = dialog.getByRole("checkbox", { name: titleA, exact: true });
  const checkboxB = dialog.getByRole("checkbox", { name: titleB, exact: true });
  await expect(checkboxA).toBeChecked();
  await expect(checkboxB).toBeChecked();
  await expect(dialog.getByText("2 of 2 selected")).toBeVisible();

  // Deselecting a page is reflected in the count and the action label.
  await checkboxB.uncheck();
  await expect(dialog.getByText("1 of 2 selected")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export 1 page" })).toBeVisible();

  // Re-select both and export.
  await checkboxB.check();
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export 2 pages" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^pages-backup-\d{4}-\d{2}-\d{2}\.zip$/,
  );

  const filePath = await download.path();
  expect(filePath).toBeTruthy();

  const zip = await JSZip.loadAsync(readFileSync(filePath as string));
  const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  expect(files).toHaveLength(2);

  const contents = await Promise.all(
    files.map((name) => zip.files[name].async("string")),
  );
  const joined = contents.join("\n");
  expect(joined).toContain(bodyA);
  expect(joined).toContain(bodyB);

  // File names are derived from the page titles.
  expect(files.some((name) => name.includes("backup-alpha"))).toBe(true);
  expect(files.some((name) => name.includes("backup-beta"))).toBe(true);
});

test("exporting with nothing selected keeps the action disabled", async ({ page }) => {
  const title = `Backup Empty ${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${title}\n\ncontent`);
  await save(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Backup pages/ }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Backup pages" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.getByRole("button", { name: "Clear" }).click();
  await expect(dialog.getByText("0 of 1 selected")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export 0 pages" })).toBeDisabled();
});
