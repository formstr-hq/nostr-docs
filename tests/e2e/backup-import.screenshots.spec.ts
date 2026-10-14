import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { loginAsGuest, typeIntoEditor, save } from "./helpers";

/**
 * Not part of the normal suite — regenerates the reference screenshots for the
 * backup (export) and import flows. Run explicitly:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test backup-import.screenshots
 *
 * Output lands in `Screenshots/backup-import/`.
 */
const capture = process.env.CAPTURE_SCREENSHOTS === "1";
test.skip(!capture, "set CAPTURE_SCREENSHOTS=1 to regenerate screenshots");

const OUT = path.resolve(process.cwd(), "Screenshots/backup-import");

test("capture backup and import flow", async ({ page }, testInfo) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  await loginAsGuest(page);

  // Pin a theme so regenerated screenshots are byte-stable — on a fresh
  // profile the app otherwise picks a random theme.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Theme/ }).click();
  const themeDialog = page.getByRole("dialog").filter({ hasText: "Choose Theme" });
  await expect(themeDialog).toBeVisible({ timeout: 10_000 });
  await themeDialog.getByText("Corpo Docs", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(themeDialog).toBeHidden();

  // Two pages so the backup dialog shows a real, grouped selection.
  await typeIntoEditor(page, "# Product roadmap\n\nQ3 planning notes.");
  await save(page);
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await typeIntoEditor(page, "# Meeting notes\n\nStandup summary.");
  await save(page);

  // ── 01: Backup dialog ──────────────────────────────────────────
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Backup pages/ }).click();
  const backup = page.getByRole("dialog").filter({ hasText: "Backup pages" });
  await expect(backup).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "01-backup-dialog.png") });
  await backup.getByRole("button", { name: "Cancel" }).click();

  // Stage a single .md plus a .zip of two .md files for the import dialog.
  const mdPath = testInfo.outputPath("Release notes.md");
  writeFileSync(mdPath, "# Release notes\n\nWhat shipped this week.");
  const zip = new JSZip();
  zip.file("Design.md", "# Design system\n\nTokens and components.");
  zip.file("specs/API.md", "# API reference\n\nEndpoints and examples.");
  const zipPath = testInfo.outputPath("pages.zip");
  writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

  // ── 02: Import dialog with files staged ────────────────────────
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Import pages/ }).click();
  const importDlg = page.getByRole("dialog").filter({ hasText: "Import pages" });
  await expect(importDlg).toBeVisible({ timeout: 10_000 });
  await importDlg
    .getByLabel("Choose Markdown or zip files")
    .setInputFiles([mdPath, zipPath]);
  await expect(importDlg.getByText("3 pages ready to import")).toBeVisible({
    timeout: 10_000,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "02-import-dialog.png") });

  // ── 03: Imported pages in the workspace ────────────────────────
  await importDlg.getByRole("button", { name: "Import 3 pages" }).click();
  await expect(importDlg.getByText("Imported 3 pages.")).toBeVisible({
    timeout: 30_000,
  });
  await importDlg.getByRole("button", { name: "View pages" }).click();
  await expect(page.getByText("Release notes", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "03-imported-pages.png") });
});
