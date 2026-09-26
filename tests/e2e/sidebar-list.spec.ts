import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
} from "./helpers";

/**
 * Health check for the workspace page-list path: a saved document is synced
 * back from the relay after a reload and can be reopened from the home view.
 *
 * This complements the round-trip spec by covering the list read and
 * open-from-list navigation, rather than opening a known /doc/<naddr> URL.
 */

test("a saved document appears in the workspace and reopens from it", async ({
  page,
}) => {
  const unique = `e2e-list-${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${unique}\n\nlisted document body`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  // Reload: the sidebar repopulates by querying the relay for our documents.
  await page.reload();
  // The restored session is locked (the key is stored NIP-49 encrypted), so
  // answer the passphrase prompt before titles/bodies can be decrypted.
  await unlockAfterReload(page);

  // The new document shows up in the All pages workspace.
  await page.getByRole("button", { name: "All pages" }).click();
  const pageTitle = page.getByText(unique, { exact: true }).first();
  await expect(pageTitle).toBeVisible({ timeout: 20_000 });

  // Open it from the workspace and confirm the body is fetched + decrypted.
  await pageTitle.click();
  await expect(page.getByText("listed document body", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
});

test("workspace sidebar options update the home filter state", async ({ page }) => {
  await page.goto("/");

  const workspaceButtons = [
    { name: "All pages", filter: "all" },
    { name: "Personal", filter: "personal" },
    { name: "Shared with me", filter: "shared" },
    { name: "Published", filter: "published" },
  ];

  for (const { name, filter } of workspaceButtons) {
    await page.getByRole("button", { name }).click();

    if (filter === "all") {
      await expect(page).toHaveURL(/^(?:http:\/\/localhost:\d+\/)?$/, {
        timeout: 10_000,
      });
    } else {
      await expect(page).toHaveURL(new RegExp(`workspace=${filter}`), {
        timeout: 10_000,
      });
    }
  }
});
