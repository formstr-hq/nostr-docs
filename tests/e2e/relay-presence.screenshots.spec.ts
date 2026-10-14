import path from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { loginAsGuest, typeIntoEditor, save, unlockAfterReload, clearRelayEvents, pubkeyFromDocUrl } from "./helpers";

/**
 * Not part of the normal suite — regenerates the reference screenshots for the
 * per-page relay-presence indicator. Run explicitly:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test relay-presence.screenshots
 *
 * Output lands in `Screenshots/relay-presence/`.
 */
const capture = process.env.CAPTURE_SCREENSHOTS === "1";
test.skip(!capture, "set CAPTURE_SCREENSHOTS=1 to regenerate screenshots");

const OUT = path.resolve(process.cwd(), "Screenshots/relay-presence");

test("capture relay presence flow", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  await loginAsGuest(page);
  await typeIntoEditor(page, "# Product roadmap\n\nQ3 planning notes.");
  await save(page);
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await typeIntoEditor(page, "# Meeting notes\n\nStandup summary.");
  await save(page);
  const pubkey = pubkeyFromDocUrl(page.url());

  // ── 01: editor-toolbar indicator (merged dots + broadcast) ──────
  const editorIndicator = page.getByRole("button", { name: /^Relay status:/ });
  await expect(editorIndicator).toBeVisible({ timeout: 20_000 });
  await editorIndicator.click();
  await expect(
    page.getByRole("dialog", { name: "Relay status" }).getByText("1/1"),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "01-editor.png") });
  await page.keyboard.press("Escape");

  // ── 02: relay coverage popover (page is on the relay) ──────────
  await page.getByRole("button", { name: "All pages" }).click();
  const indicator = page.getByRole("button", { name: /^Relay status:/ }).first();
  await expect(indicator).toBeVisible({ timeout: 20_000 });
  await indicator.click();
  const popover = page.getByRole("dialog", { name: "Relay status" });
  await expect(popover.getByText("1/1")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "02-relays-have-it.png") });
  await page.keyboard.press("Escape");

  // ── 03: missing-everywhere warning ─────────────────────────────
  await page.waitForTimeout(2000); // let the local relay flush to disk
  await clearRelayEvents({ authors: [pubkey] });
  await page.reload();
  await unlockAfterReload(page);
  await page.getByRole("button", { name: "All pages" }).click();
  const warn = page.getByRole("button", { name: /Not on any relay/ }).first();
  await expect(warn).toBeVisible({ timeout: 20_000 });
  await warn.click();
  await expect(
    page.getByRole("dialog", { name: "Relay status" }).getByText("None of your relays have this page."),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "03-missing.png") });
});
