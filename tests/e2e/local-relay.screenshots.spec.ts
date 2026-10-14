import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAsGuest, typeIntoEditor, save, unlockAfterReload } from "./helpers";

/**
 * Not part of the normal suite — regenerates the reference screenshots for the
 * local-relay tag flow. Run explicitly:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test local-relay.screenshots
 *
 * Output lands in `Screenshots/local-relay/`.
 */
const capture = process.env.CAPTURE_SCREENSHOTS === "1";
test.skip(!capture, "set CAPTURE_SCREENSHOTS=1 to regenerate screenshots");

const OUT = path.resolve(process.cwd(), "Screenshots/local-relay");

test("capture local-relay tag flow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await loginAsGuest(page);
  await typeIntoEditor(page, "# Local-relay transport\n\nTags now persist locally.");
  await save(page);

  const tagInput = page.getByPlaceholder(/add tag/i).first();
  await tagInput.click();
  await tagInput.fill("design");
  await tagInput.press("Enter");
  await page.getByPlaceholder(/add tag/i).first().fill("release");
  await page.getByPlaceholder(/add tag/i).first().press("Enter");
  await expect(page.getByText("release", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "01-editor-tags.png") });

  await page.getByRole("button", { name: "All pages" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "02-workspace-tags.png") });

  await page.reload();
  await unlockAfterReload(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "03-after-reload.png") });
});
