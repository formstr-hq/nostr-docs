import { test, expect } from "@playwright/test";
import { loginAsGuest, typeIntoEditor, save, unlockAfterReload } from "./helpers";

/**
 * Document tags live in kind-34579 metadata, a parameterised-replaceable event.
 * These cover the tag read/write path through the local-relay transport,
 * including the regression where renaming and tagging in the same second made
 * the relay drop the tag (created_at collision).
 */

test("a document tag persists across reload and appears in the workspace", async ({
  page,
}) => {
  const body = `tag-body-${Date.now()}`;
  await loginAsGuest(page);
  await typeIntoEditor(page, body);
  await save(page);

  const tagInput = page.getByPlaceholder(/add tag/i).first();
  await expect(tagInput).toBeVisible({ timeout: 15_000 });
  await tagInput.click();
  await tagInput.fill("e2etag");
  await tagInput.press("Enter");
  await expect(page.getByText("e2etag", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  // Full reload + unlock: the tag must come back (cache-first local relay).
  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByText("e2etag", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  // And it is offered in the workspace tag list.
  await page.getByRole("button", { name: "All pages" }).click();
  await expect(page.getByText("#e2etag", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("a title and a tag set in the same second both persist", async ({ page }) => {
  const body = `title-tag-body-${Date.now()}`;
  await loginAsGuest(page);
  await typeIntoEditor(page, body);
  await save(page);

  // Rename, then add a tag immediately (same second) — the collision case.
  await page.locator(".edit-icon").first().click({ force: true });
  const titleInput = page.getByPlaceholder("Enter document title...");
  await titleInput.fill("Regression Title");
  await titleInput.press("Enter");

  const tagInput = page.getByPlaceholder(/add tag/i).first();
  await tagInput.click();
  await tagInput.fill("regresstag");
  await tagInput.press("Enter");

  await page.reload();
  await unlockAfterReload(page);

  await expect(page.getByText("Regression Title", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("regresstag", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
});
