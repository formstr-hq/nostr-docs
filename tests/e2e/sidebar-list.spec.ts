import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
} from "./helpers";

/**
 * Health check for the document-list path: a saved document is synced back from
 * the relay into the sidebar after a reload, and can be reopened from there.
 *
 * This complements the round-trip spec by covering the *list* read (the app
 * queries the relay for the user's own documents on load) and the open-from-list
 * navigation, rather than opening a known /doc/<naddr> URL directly.
 */

test("a saved document appears in the sidebar and reopens from it", async ({
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

  // The new document shows up in the list (its title is the heuristic first line).
  const listItem = page.getByRole("button", { name: new RegExp(unique) });
  await expect(listItem).toBeVisible({ timeout: 20_000 });

  // Open it from the list and confirm the body is fetched + decrypted for display.
  await listItem.click();
  await expect(page.getByText("listed document body", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
});
