import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAsGuest, typeIntoEditor } from "./helpers";

/**
 * Not part of the normal suite — regenerates the store screenshots referenced by
 * zapstore.yaml (Screenshots/1.png … 3.png). Run explicitly:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test release.screenshots
 */
const capture = process.env.CAPTURE_SCREENSHOTS === "1";
test.skip(!capture, "set CAPTURE_SCREENSHOTS=1 to regenerate screenshots");

const OUT = path.resolve(process.cwd(), "Screenshots");

// Phone-sized captures; the app picks a random theme on a fresh profile, so we
// pin one for reproducible images.
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const pinTheme = (page: import("@playwright/test").Page, themeId: string) =>
  page.addInitScript((id) => {
    try {
      localStorage.setItem("formstr:theme", id);
    } catch {
      /* storage disabled — fall back to the random theme */
    }
  }, themeId);

const SAMPLE = "# My shopping list\n\nGet Groceries\nGet a gift for JJ's birthday";

test("editor — light theme", async ({ page }) => {
  await pinTheme(page, "warmPaper");
  await loginAsGuest(page);
  await typeIntoEditor(page, SAMPLE);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "1.png") });
});

test("editor — dark theme", async ({ page }) => {
  await pinTheme(page, "candlelit");
  await loginAsGuest(page);
  await typeIntoEditor(page, SAMPLE);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "2.png") });
});

test("signer modal", async ({ page }) => {
  await pinTheme(page, "warmPaper");
  await page.goto("/new");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Choose how you'd like to access your documents" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "3.png") });
});
