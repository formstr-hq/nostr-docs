import path from "node:path";
import { test, expect } from "@playwright/test";
import { loginAsGuest, typeIntoEditor, save, unlockAfterReload } from "./helpers";

/**
 * Not part of the normal suite — regenerates the store screenshots referenced by
 * zapstore.yaml. Run explicitly:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test release.screenshots
 */
const capture = process.env.CAPTURE_SCREENSHOTS === "1";
test.skip(!capture, "set CAPTURE_SCREENSHOTS=1 to regenerate screenshots");

const OUT = path.resolve(process.cwd(), "Screenshots");

// Phone-sized, retina captures.
test.use({ deviceScaleFactor: 2 });
const PHONE = { width: 390, height: 844 };

const pinTheme = (page: import("@playwright/test").Page, themeId: string) =>
  page.addInitScript((id) => {
    try {
      localStorage.setItem("formstr:theme", id);
    } catch {
      /* storage disabled */
    }
  }, themeId);

test("app screens (home, editor, menus)", async ({ page }) => {
  // Build a few pages at desktop size (sidebar navigation), then capture on phone.
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinTheme(page, "warmPaper");
  await loginAsGuest(page);

  const pages = [
    { title: "Trip to Kyoto", tag: "travel" },
    { title: "Meeting notes", tag: "work" },
    { title: "Reading list", tag: "books" },
  ];
  for (const p of pages) {
    await page.getByRole("button", { name: "All pages" }).click();
    await page.getByRole("button", { name: "New page" }).first().click();
    await typeIntoEditor(page, `# ${p.title}\n\nA few notes for ${p.title}.`);
    await save(page);
    const tagInput = page.getByPlaceholder(/add tag/i).first();
    await tagInput.click();
    await tagInput.fill(p.tag);
    await tagInput.press("Enter");
  }

  await page.setViewportSize(PHONE);
  await page.goto("/");
  await unlockAfterReload(page);
  await page.waitForTimeout(800);

  // 1 — home
  await page.screenshot({ path: path.join(OUT, "1-home.png") });

  // 5 — workspace bottom sheet
  await page.getByText("Workspaces").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "5-workspaces.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 2 — editor
  await page.getByText("Trip to Kyoto", { exact: true }).first().click();
  await expect(page.getByText("A few notes for Trip to Kyoto.")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "2-editor.png") });

  // 3 — editor actions menu
  await page.getByRole("button", { name: "More actions" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "3-actions.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 4 — share modal
  await page.getByRole("button", { name: "Share" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "4-share.png") });
});

test("signer modal", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await pinTheme(page, "warmPaper");
  await page.goto("/new");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Choose how you'd like to access your documents" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "6-signin.png") });
});
