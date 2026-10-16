import { test, expect, type Browser, type Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44 } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  editorSurface,
  queryLocalRelay,
  publishToLocalRelay,
} from "./helpers";
import { encodeNKeys } from "../../src/utils/nkeys";

/** Switch a page's editor to WYSIWYG (the shared doc opens in preview). */
async function becomeVisualEditor(page: Page) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
}

/** Owner creates a doc and shares an open (anyone-with-link) editable link. */
async function ownerCreateAndShareOpen(
  page: Page,
): Promise<{ shareLink: string; title: string }> {
  const title = `e2e-${Date.now()}`;
  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${title}\n\nbody`);
  await save(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  return { shareLink: page.url(), title };
}

/** A fresh identity opens the share link, connected and in edit mode. */
async function openSharedAsWriter(browser: Browser, shareLink: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsGuest(page);
  await page.goto(shareLink);
  await unlockAfterReload(page);
  await expect(page.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
  await becomeVisualEditor(page);
  return { context, page };
}

/** Append a new line of text to the document in the visual editor. */
async function appendLine(page: Page, text: string) {
  await editorSurface(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

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
  // Yjs ops) is tagged with the capability-derived room, never the
  // public document root — an observer must not be able to link it to the doc.
  const rootNaddr = new URL(shareLink).pathname.split("/doc/")[1].split("/")[0];
  const decodedRoot = nip19.decode(rootNaddr);
  expect(decodedRoot.type).toBe("naddr");
  const p = decodedRoot.data as nip19.AddressPointer;
  const rootAddr = `${p.kind}:${p.pubkey}:${p.identifier}`;
  const collabEvents = [
    ...(await queryLocalRelay({ kinds: [33457] })),
    ...(await queryLocalRelay({ kinds: [22457] })),
    ...(await queryLocalRelay({ kinds: [24578] })),
    ...(await queryLocalRelay({ kinds: [34581] })),
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

test("save captures the merged state when a peer then leaves", async ({
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

  // Owner saves (writes the merged Markdown snapshot), then the collaborator
  // disappears.
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

test("concurrent writers: both edits merge live", async ({ page, browser }) => {
  const { shareLink } = await ownerCreateAndShareOpen(page);
  await becomeVisualEditor(page);
  const { context, page: other } = await openSharedAsWriter(browser, shareLink);

  const a = `A-${Date.now()}`;
  const b = `B-${Date.now()}`;
  // Both write without saving or waiting for each other.
  await appendLine(page, a);
  await appendLine(other, b);

  // Yjs merges both, so each side must see the other's text.
  await expect(page.getByText(b)).toBeVisible({ timeout: 15_000 });
  await expect(other.getByText(a)).toBeVisible({ timeout: 15_000 });

  await context.close();
});

test("offline writer: edits merge on reconnect", async ({ page, browser }) => {
  const { shareLink } = await ownerCreateAndShareOpen(page);
  await becomeVisualEditor(page);
  const { context, page: other } = await openSharedAsWriter(browser, shareLink);

  const ownerText = `owner-${Date.now()}`;
  const editorText = `editor-${Date.now()}`;

  // The collaborator drops offline and writes…
  await context.setOffline(true);
  await appendLine(other, editorText);
  // …while the owner keeps writing.
  await appendLine(page, ownerText);

  // On reconnect both sides must converge (no reload, no save).
  await context.setOffline(false);
  await expect(page.getByText(editorText)).toBeVisible({ timeout: 30_000 });
  await expect(other.getByText(ownerText)).toBeVisible({ timeout: 30_000 });

  await context.close();
});

test("three parties converge", async ({ page, browser }) => {
  const { shareLink } = await ownerCreateAndShareOpen(page);
  await becomeVisualEditor(page);
  const p2 = await openSharedAsWriter(browser, shareLink);
  const p3 = await openSharedAsWriter(browser, shareLink);

  const t1 = `p1-${Date.now()}`;
  const t2 = `p2-${Date.now()}`;
  const t3 = `p3-${Date.now()}`;
  await appendLine(page, t1);
  await appendLine(p2.page, t2);
  await appendLine(p3.page, t3);

  const cases: Array<[Page, string[]]> = [
    [page, [t2, t3]],
    [p2.page, [t1, t3]],
    [p3.page, [t1, t2]],
  ];
  for (const [p, texts] of cases) {
    for (const t of texts) {
      await expect(p.getByText(t)).toBeVisible({ timeout: 20_000 });
    }
  }

  await p2.context.close();
  await p3.context.close();
});

test("legacy edit-key link still opens, displays and edits", async ({ page }) => {
  const unique = `legacy-${Date.now()}`;

  // Forge a legacy share exactly as the old model did: content encrypted with a
  // viewKey, signed by a shared editKey, at 33457:<editKeyPub>:<d>.
  const editKey = generateSecretKey();
  const editPub = getPublicKey(editKey);
  const viewKey = generateSecretKey();
  const conv = nip44.getConversationKey(viewKey, getPublicKey(viewKey));
  const dtag = `leg${Math.random().toString(36).slice(2, 8)}`;
  const legacyEvent = finalizeEvent(
    {
      kind: 33457,
      tags: [["d", dtag]],
      content: nip44.encrypt(`# ${unique}\n\nlegacy shared body`, conv),
      created_at: Math.floor(Date.now() / 1000),
    },
    editKey,
  );
  await publishToLocalRelay(legacyEvent);

  const naddr = nip19.naddrEncode({ kind: 33457, pubkey: editPub, identifier: dtag });
  const link = `/doc/${naddr}#${encodeNKeys({
    viewKey: bytesToHex(viewKey),
    editKey: bytesToHex(editKey),
  })}`;

  // No login: the editKey is the capability (legacy "anyone with the link").
  await page.goto(link);
  await expect(page.getByRole("heading", { name: unique })).toBeVisible({
    timeout: 20_000,
  });

  // Editable via the editKey and saves without a signer.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  // Legacy docs also run a live session; wait for it to settle before typing so
  // the editor isn't recreated mid-keystroke.
  await expect(page.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
  await editorSurface(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("edited through a legacy link");
  await page.getByText("Save", { exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

  // A newer viewKey-encrypted event now exists at the legacy editKey address.
  const stored = await queryLocalRelay({ kinds: [33457], authors: [editPub], "#d": [dtag] });
  expect(stored.length).toBeGreaterThan(0);
  const latest = stored.sort((a, b) => b.created_at - a.created_at)[0];
  expect(nip44.decrypt(latest.content, conv)).toContain("edited through a legacy link");
});

test("a participant sees a shared doc exactly once", async ({ page, browser }) => {
  const { shareLink, title } = await ownerCreateAndShareOpen(page);

  const context = await browser.newContext();
  const friend = await context.newPage();
  await loginAsGuest(friend);
  await friend.goto(shareLink);
  await unlockAfterReload(friend);
  await expect(friend.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  await expect(friend.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });

  // The friend edits and saves — this creates their own author-slot event, which
  // must be grouped under the document root, not shown as a second personal page.
  await friend.getByRole("button", { name: "More actions" }).click();
  await friend.getByRole("menuitem", { name: "Visual editor" }).click();
  await editorSurface(friend).click();
  await friend.keyboard.press("End");
  await friend.keyboard.press("Enter");
  await friend.keyboard.type("friend was here");
  await friend.getByRole("button", { name: "Save", exact: true }).click();
  await expect(friend.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

  // The workspace must show the doc as a single card.
  await friend.getByRole("button", { name: "All pages" }).click();
  await expect(friend.getByText(title, { exact: true })).toHaveCount(1, {
    timeout: 20_000,
  });

  await context.close();
});
