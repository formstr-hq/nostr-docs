import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  editorSurface,
} from "./helpers";

/**
 * v2 multi-writer sharing, end to end.
 *
 * Owner creates a document, shares an *open* (anyone-with-the-link) editable
 * link, a second, independent identity opens that link and edits it, and the
 * owner sees the collaborator's version after a reload. This exercises the whole
 * v2 spine: viewKey-encrypted content, the owner control event (roster + mode),
 * `["a", root]` addressing, open-mode resolution by `#a`, and per-author signing
 * (the collaborator writes their OWN replaceable slot).
 */

test("open share: a collaborator edits and the owner sees it", async ({
  page,
  browser,
}) => {
  const unique = `e2e-owner-${Date.now()}`;
  const collabText = `collab-edit-${Date.now()}`;

  // 1. Owner signs in and creates a document.
  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${unique}\n\nowner body`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/);
  await expect(page.getByRole("heading", { name: unique })).toBeVisible({
    timeout: 20_000,
  });

  // 2. Owner shares an open editable link. Generating re-publishes the owner's
  //    content under a viewKey and navigates the owner's own URL to the keyed
  //    share URL, so the current URL *is* the share link.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = page.url();
  expect(shareLink).toContain("/doc/naddr1");

  // The owner's own page must also render after sharing (same open resolution).
  await expect(page.getByRole("heading", { name: unique })).toBeVisible({
    timeout: 20_000,
  });

  // 3. A second, independent identity opens the link.
  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  await loginAsGuest(editor);
  await editor.goto(shareLink);
  await unlockAfterReload(editor);

  // They see the owner's content and (open mode) have edit access.
  await expect(editor.getByRole("heading", { name: unique })).toBeVisible({
    timeout: 20_000,
  });
  await expect(editor.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });

  // Collaboration is intentional: the editor is read-only until the Yjs session
  // finishes its initial sync, so wait for the "connecting" notice to clear.
  await expect(editor.getByText("Connecting to collaborators…")).toBeVisible({
    timeout: 20_000,
  });
  await expect(editor.getByText("Connecting to collaborators…")).toBeHidden({
    timeout: 20_000,
  });

  // 4. Switch to the visual editor and append text.
  await editor.getByRole("button", { name: "More actions" }).click();
  await editor.getByRole("menuitem", { name: "Visual editor" }).click();
  const surface = editorSurface(editor);
  await surface.click();
  await editor.keyboard.press("End");
  await editor.keyboard.press("Enter");
  await editor.keyboard.type(collabText);

  // Ensure the collaborator's version has a strictly newer timestamp than the
  // owner's share snapshot (created_at has 1s granularity).
  await editor.waitForTimeout(1_200);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // 5. Owner reloads; open-mode resolution by `#a` must surface the newest
  //    version across authors, i.e. the collaborator's edit.
  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByText(collabText)).toBeVisible({ timeout: 20_000 });

  await editorContext.close();
});
