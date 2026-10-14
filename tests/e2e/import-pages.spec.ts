import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { loginAsGuest } from "./helpers";

/**
 * Import feature: single Markdown files and zips of Markdown files are read
 * from disk and each becomes a new page. Covers both sources at once, the
 * "skipped non-Markdown" notice, and that an imported page's content survives
 * the encrypt → publish → reopen round trip.
 */

test("imports single markdown files and a zip of markdown files", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const singleTitle = `Imported Single ${stamp}`;
  const zipATitle = `Imported Zip A ${stamp}`;
  const zipBTitle = `Imported Zip B ${stamp}`;
  const singleBody = `single body ${stamp}`;
  const zipABody = `zip a body ${stamp}`;
  const zipBBody = `zip b body ${stamp}`;

  // Fixtures: a plain .md, a .zip with two .md files (one nested), and a
  // non-Markdown file that must be reported as skipped.
  const mdPath = testInfo.outputPath("Gamma.md");
  writeFileSync(mdPath, `# ${singleTitle}\n\n${singleBody}`);

  const zip = new JSZip();
  zip.file("Alpha.md", `# ${zipATitle}\n\n${zipABody}`);
  zip.file("nested/Beta.md", `# ${zipBTitle}\n\n${zipBBody}`);
  const zipPath = testInfo.outputPath("pages.zip");
  writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

  const junkPath = testInfo.outputPath("notes.json");
  writeFileSync(junkPath, `{"format":"not markdown"}`);

  await loginAsGuest(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Import pages/ }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Import pages" });
  await expect(dialog).toBeVisible();

  await dialog
    .getByLabel("Choose Markdown or zip files")
    .setInputFiles([mdPath, zipPath, junkPath]);

  await expect(dialog.getByText(/Skipped 1 file/)).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("3 pages ready to import")).toBeVisible();

  await dialog.getByRole("button", { name: "Import 3 pages" }).click();
  await expect(dialog.getByText("Imported 3 pages.")).toBeVisible({ timeout: 30_000 });

  await dialog.getByRole("button", { name: "View pages" }).click();

  // Each imported page shows up in the workspace under its content heading.
  await expect(page.getByText(singleTitle, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(zipATitle, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(zipBTitle, { exact: true }).first()).toBeVisible();

  // Open one and confirm the Markdown body round-tripped through encryption.
  await page.getByText(singleTitle, { exact: true }).first().click();
  await expect(page.getByText(singleBody, { exact: false })).toBeVisible({
    timeout: 20_000,
  });
});

test("importing can keep pages on this device only", async ({ page }, testInfo) => {
  const stamp = Date.now();
  const title = `Device Only Import ${stamp}`;

  const mdPath = testInfo.outputPath("Local.md");
  writeFileSync(mdPath, `# ${title}\n\nnever published ${stamp}`);

  await loginAsGuest(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Import pages/ }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Import pages" });
  await expect(dialog).toBeVisible();

  // Opt out of publishing — imported pages become device-only.
  await dialog.getByRole("checkbox", { name: /Publish to relays/ }).uncheck();
  await dialog.getByLabel("Choose Markdown or zip files").setInputFiles(mdPath);

  await dialog.getByRole("button", { name: "Import 1 page" }).click();
  await expect(dialog.getByText(/Imported 1 page on this device/)).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByRole("button", { name: "View pages" }).click();

  // It is classified as a Device page and is absent from Personal.
  await page.getByRole("button", { name: "Device", exact: true }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeHidden({ timeout: 5_000 });
});
