import { test, expect, type Page } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
} from "./helpers";

/**
 * Share dialog UX. These lock in the fixes for the flow that used to be broken:
 * the dialog closing itself the moment a link was generated (the page remounted
 * on the URL hash change), view-only links that opened to "Document not found"
 * (a same-second replaceable event got dropped by relays), and sharing an
 * unsaved draft erroring with "No document selected".
 */

const shareDialog = (page: Page) =>
  page.getByRole("dialog").filter({ hasText: "Share Page" });

/** Open the Share dialog from the editor toolbar and return its locator. */
async function openShare(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/** The read-only link field inside the dialog. */
const linkField = (dialog: ReturnType<typeof shareDialog>) =>
  dialog.locator("input[readonly]").first();

/** Sign in, write a page and save it. Returns the page's heading text. */
async function createPage(page: Page): Promise<string> {
  const title = `share-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${title}\n\nsome body text`);
  await save(page);
  return title;
}

test("generating a link keeps the dialog open and shows the link", async ({
  page,
}) => {
  await createPage(page);
  const dialog = await openShare(page);

  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });

  // The dialog used to close on its own here (the page remounted on navigate).
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Link ready\./)).toBeVisible();

  const value = await linkField(dialog).inputValue();
  expect(value).toContain("/doc/naddr1");
  expect(value).toContain("#nkeys1");
});

test("the editor stays mounted through the share flow", async ({ page }) => {
  const title = await createPage(page);
  const dialog = await openShare(page);

  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });

  // No reloading flash while the dialog is open. (Role queries skip the
  // aria-hidden background, so use a text/CSS locator here.)
  await expect(page.getByText("Loading document...")).toBeHidden();
  await expect(page.locator("h1", { hasText: title })).toBeVisible();

  // And the dialog is still up a beat later (not just before a remount lands).
  await page.waitForTimeout(1_500);
  await expect(dialog).toBeVisible();

  // Closing the dialog reveals the same editor, still mounted underneath.
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toBeVisible();
});

test("reopening share shows the existing link", async ({ page }) => {
  await createPage(page);
  let dialog = await openShare(page);
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const link = await linkField(dialog).inputValue();

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  dialog = await openShare(page);
  await expect(linkField(dialog)).toHaveValue(link);
  await expect(
    dialog.getByRole("button", { name: "Rotate View Access" }),
  ).toBeVisible();
});

test("sharing an unsaved draft saves the page and opens the dialog", async ({
  page,
}) => {
  const title = `draft-${Date.now()}`;
  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${title}\n\nunsaved body`);

  // No save first — Share should save the page then present the dialog (it
  // used to just show the raw "No document selected" error).
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByRole("button", { name: "Generate Link" }),
  ).toBeVisible();
  await expect(page.getByText("No document selected")).toBeHidden();
});

test("a view-only link opens immediately for a fresh identity", async ({
  page,
  browser,
}) => {
  const title = await createPage(page);

  // Generate right after saving — same wall-clock second. The replaceable
  // share event must still supersede the just-saved version.
  const dialog = await openShare(page);
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const link = page.url();

  const context = await browser.newContext();
  const visitor = await context.newPage();
  await loginAsGuest(visitor);
  await visitor.goto(link);
  await unlockAfterReload(visitor);

  await expect(
    visitor.getByRole("heading", { name: title }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(visitor.getByText("Shared page · view only")).toBeVisible({
    timeout: 20_000,
  });
  await context.close();
});

test("opening and closing share repeatedly is stable", async ({ page }) => {
  await createPage(page);
  for (let i = 0; i < 5; i++) {
    const dialog = await openShare(page);
    await expect(
      dialog.getByRole("button", { name: /Generate Link|Rotate View Access/ }),
    ).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
});

test("copy link puts the URL on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createPage(page);
  const dialog = await openShare(page);
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const link = await linkField(dialog).inputValue();

  await dialog.getByRole("button", { name: "Copy link" }).first().click();
  // The confirmation snackbar renders outside the dialog.
  await expect(page.getByText(/copied to clipboard/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(link);
});
