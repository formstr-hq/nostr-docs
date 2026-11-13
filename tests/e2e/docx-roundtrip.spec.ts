import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import {
  LOCAL_BLOSSOM,
  loginAsGuest,
  pubkeyFromDocUrl,
  queryLocalRelay,
  unlockAfterReload,
} from "./helpers";

/**
 * Import a real DOCX through our OOXML adapter, edit the body, export it again,
 * and verify:
 *  - the edit is written into word/document.xml
 *  - header/footer parts from the original package are still present
 */
test("imports, edits and exports a DOCX with headers preserved", async ({ page }) => {
  const fixture = join(process.cwd(), "tests/fixtures/docx/letterhead.docx");
  const blossom = LOCAL_BLOSSOM;
  await fetch(`${blossom}/clear`, { method: "POST" });

  await loginAsGuest(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Import pages/ }).click();

  const importDialog = page.getByRole("dialog").filter({ hasText: "Import pages" });
  await importDialog
    .getByLabel("Choose Markdown or zip files")
    .setInputFiles([fixture]);
  await expect(importDialog.getByText("1 page ready to import")).toBeVisible({
    timeout: 15_000,
  });
  await importDialog.getByRole("button", { name: "Import 1 page" }).click();
  await expect(importDialog.getByText("Imported 1 page.")).toBeVisible({
    timeout: 30_000,
  });
  const blossomStats = await fetch(`${blossom}/stats`).then((response) =>
    response.json(),
  );
  expect(blossomStats.count).toBeGreaterThanOrEqual(2);
  await importDialog.getByRole("button", { name: "View pages" }).click();

  await page.getByText("March 14, 2026", { exact: false }).first().click();
  await expect(
    page.getByText("Thank you for taking the time", { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });

  // The page event must contain refs, not the DOCX package or image data URLs.
  const author = pubkeyFromDocUrl(page.url());
  const documentEvents = await queryLocalRelay({
    kinds: [33458],
    authors: [author],
  });
  const latest = documentEvents.sort(
    (a, b) => a.created_at - b.created_at,
  ).at(-1);
  expect(latest?.content.length ?? Infinity).toBeLessThan(20_000);
  // The original header/footer should be projected into the page layout.
  await expect(page.getByText("NORTHWIND STUDIO", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  // Extracted DOCX images are fetched/decrypted from Blossom, not embedded as
  // data URLs in the event.
  await expect(page.locator('img[alt="Word image"]').first()).toBeVisible({
    timeout: 20_000,
  });

  // Switch to the visual editor and append a marker to a body paragraph.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  await expect(page.locator('.tiptap img[alt="Word image"]').first()).toBeVisible({
    timeout: 20_000,
  });
  const surface = page.locator(".tiptap").first();
  await surface.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" EDITED");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Reload so export has to resolve the package/image refs from the stored
  // envelope rather than in-memory import state.
  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByText("EDITED", { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /Word \(\.docx\)/ }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();

  const zip = await JSZip.loadAsync(readFileSync(filePath as string));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  expect(documentXml).toContain("EDITED");
  expect(documentXml).toContain('w:w="12240"');
  expect(documentXml).toContain('w:h="15840"');
  expect(Object.keys(zip.files).some((name) => name.startsWith("word/media/"))).toBe(true);
  expect(zip.file("word/header1.xml")).toBeTruthy();
  expect(zip.file("word/footer1.xml")).toBeTruthy();

  // HTML export must resolve the Blossom image ref too, not emit a ciphertext
  // URL or drop the image.
  const htmlDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /HTML/ }).click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlPath = await htmlDownload.path();
  expect(htmlPath).toBeTruthy();
  const html = readFileSync(htmlPath as string, "utf8");
  expect(html).toContain("<img");
  expect(html).toContain("data:image/png;base64");
});
