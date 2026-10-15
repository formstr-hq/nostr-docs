import { test, expect } from "@playwright/test";
import { nip19 } from "nostr-tools";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  editorSurface,
  queryLocalRelay,
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

  // The editor is read-only until the Yjs session finishes its initial sync;
  // wait for the brief "Connecting…" indicator to clear.
  await expect(editor.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });

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

  // Privacy: the collaboration bus (CRDT ops, presence, session attestations,
  // Yjs checkpoints) is tagged with the capability-derived room, never the
  // public document root — an observer must not be able to link it to the doc.
  const rootNaddr = new URL(shareLink).pathname.split("/doc/")[1].split("/")[0];
  const decodedRoot = nip19.decode(rootNaddr);
  expect(decodedRoot.type).toBe("naddr");
  const p = decodedRoot.data as nip19.AddressPointer;
  const rootAddr = `${p.kind}:${p.pubkey}:${p.identifier}`;
  const collabEvents = [
    ...(await queryLocalRelay({ kinds: [22457] })),
    ...(await queryLocalRelay({ kinds: [24578] })),
    ...(await queryLocalRelay({ kinds: [34581] })),
    ...(await queryLocalRelay({ kinds: [34582] })),
  ];
  expect(collabEvents.length, "expected some collaboration events").toBeGreaterThan(0);
  for (const e of collabEvents) {
    expect(
      e.tags.flat(),
      `collaboration event leaked the document root: ${JSON.stringify(e.tags)}`,
    ).not.toContain(rootAddr);
  }

  // 5. Owner reloads; open-mode resolution by `#a` must surface the newest
  //    version across authors, i.e. the collaborator's edit.
  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByText(collabText)).toBeVisible({ timeout: 20_000 });

  await editorContext.close();
});

test("save in between: a checkpoint survives when a peer leaves", async ({
  page,
  browser,
}) => {
  const unique = `e2e-save-${Date.now()}`;
  const ownerText = `owner-save-${Date.now()}`;
  const editorText = `editor-save-${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${unique}\n\nbody`);
  await save(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = page.url();

  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  await loginAsGuest(editor);
  await editor.goto(shareLink);
  await unlockAfterReload(editor);
  await expect(editor.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  for (const p of [page, editor]) {
    await expect(p.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
  }

  // Owner types…
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  await editorSurface(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(ownerText);

  // …and the collaborator types.
  await editor.getByRole("button", { name: "More actions" }).click();
  await editor.getByRole("menuitem", { name: "Visual editor" }).click();
  await editorSurface(editor).click();
  await editor.keyboard.press("End");
  await editor.keyboard.press("Enter");
  await editor.keyboard.type(editorText);

  // Both must actually have each other's text before the owner saves.
  await expect(page.getByText(editorText)).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByText(ownerText)).toBeVisible({ timeout: 15_000 });

  // Owner saves (durable checkpoint), then the collaborator disappears.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await editorContext.close();

  // Reload with no peers online: both edits must survive.
  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByText(ownerText)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(editorText)).toBeVisible({ timeout: 20_000 });
});

test("flaky network: a reconnecting client converges", async ({
  page,
  browser,
}) => {
  const unique = `e2e-net-${Date.now()}`;
  const ownerText = `owner-offline-${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${unique}\n\nbody`);
  await save(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = page.url();

  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  await loginAsGuest(editor);
  await editor.goto(shareLink);
  await unlockAfterReload(editor);
  await expect(editor.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  for (const p of [page, editor]) {
    await expect(p.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
  }

  // The collaborator drops offline…
  await editorContext.setOffline(true);

  // …while the owner keeps typing.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  await editorSurface(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(ownerText);

  // …then reconnects and must converge without a reload.
  await editorContext.setOffline(false);
  await expect(editor.getByText(ownerText)).toBeVisible({ timeout: 30_000 });

  await editorContext.close();
});

test("live: an edit appears without saving", async ({ page, browser }) => {
  const unique = `e2e-live-${Date.now()}`;
  const ownerText = `owner-live-${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${unique}\n\nowner body`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/);

  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = page.url();

  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  editor.on("console", (m) => {
    const t = m.text();
    if (/collab|Yjs|yjs|sharedDoc|sync/i.test(t)) console.log("EDITOR-CONSOLE", t);
  });
  page.on("console", (m) => {
    const t = m.text();
    if (/collab|Yjs|yjs|sharedDoc|sync/i.test(t)) console.log("OWNER-CONSOLE", t);
  });
  await loginAsGuest(editor);
  await editor.goto(shareLink);
  await unlockAfterReload(editor);

  await expect(editor.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  // Both sides must finish their initial Yjs sync before typing.
  for (const p of [page, editor]) {
    await expect(p.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
  }

  // Owner types live (no save).
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  const ownerSurface = editorSurface(page);
  await ownerSurface.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(ownerText);

  // The collaborator should see it without any save/reload.
  await expect(editor.getByText(ownerText)).toBeVisible({ timeout: 15_000 });

  await editorContext.close();
});
