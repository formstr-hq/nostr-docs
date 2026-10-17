import path from "node:path";
import { mkdirSync, copyFileSync, statSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { loginAsGuest, typeIntoEditor, save } from "./helpers";

/**
 * Not part of the normal suite — regenerates reference screenshots and a short
 * screen recording of the Share dialog flow. Run explicitly:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test share-modal.screenshots
 *
 * Output lands in `Screenshots/share-modal/`.
 */
const capture = process.env.CAPTURE_SCREENSHOTS === "1";
test.skip(!capture, "set CAPTURE_SCREENSHOTS=1 to regenerate screenshots");

const OUT = path.resolve(process.cwd(), "Screenshots/share-modal");

// Record the flow so the fixes are demonstrable, not just asserted.
test.use({ video: { mode: "on", size: { width: 1280, height: 900 } } });

test("capture share modal flow", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  await loginAsGuest(page);

  // Pin a theme so regenerated captures are stable — a fresh profile otherwise
  // picks a random theme.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Theme/ }).click();
  const themeDialog = page.getByRole("dialog").filter({ hasText: "Choose Theme" });
  await expect(themeDialog).toBeVisible({ timeout: 10_000 });
  await themeDialog.getByText("Corpo Docs", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(themeDialog).toBeHidden();

  await typeIntoEditor(page, "# Design review\n\nSharing a page is painless now.");
  await save(page);

  // ── 01: default (view link) ─────────────────────────────────────
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "01-view-link.png") });

  // ── 02: edit access with the two access levels ──────────────────
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "02-edit-access.png") });

  // ── 03: generated link (dialog stays open) ──────────────────────
  await dialog
    .getByRole("switch", { name: "Anyone with the link can edit" })
    .click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  await expect(dialog.getByText(/Link ready\./)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "03-generated-link.png") });

  // ── 04: editors (available once the doc has a viewKey) ──────────
  const editorPubkey = getPublicKey(generateSecretKey());
  const editorNpub = nip19.npubEncode(editorPubkey);
  const editorField = dialog.getByLabel("npub1… or hex pubkey");
  await editorField.fill(editorNpub);
  await dialog.getByRole("button", { name: "Add" }).click();
  // The input clears once the roster write lands.
  await expect(editorField).toHaveValue("", { timeout: 20_000 });
  await expect(
    dialog.getByRole("button", { name: /^Remove editor/ }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "04-editors.png") });

  // ── 05: copied confirmation ─────────────────────────────────────
  await dialog.getByRole("button", { name: "Copy link" }).first().click();
  await expect(page.getByText(/copied to clipboard/i)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "05-link-copied.png") });

  // ── Recording ───────────────────────────────────────────────────
  const video = page.video();
  await page.close();
  const videoPath = video ? await video.path() : null;
  if (videoPath) {
    const dest = path.join(OUT, "share-modal-flow.webm");
    copyFileSync(videoPath, dest);
    expect(statSync(dest).size).toBeGreaterThan(0);
  }
});
