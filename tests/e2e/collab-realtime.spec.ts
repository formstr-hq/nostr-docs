import { test, expect } from "@playwright/test";
import { loginAsGuest, typeIntoEditor, save, editorSurface } from "./helpers";

/**
 * End-to-end health check for real-time collaboration on a shared edit-link
 * document: two independent browser contexts converge on the same content
 * live (no reload), and an anonymous (not logged in) edit-link visitor can
 * fully participate without being forced through a login flow.
 *
 * This exercises the whole collab spine — session-key delegation (signing
 * without repeated real-signer prompts), editKey-based encryption, the
 * Nostr-backed Yjs transport, and presence — plus two behaviors that broke
 * during development and are worth guarding against regressing:
 *   - an edit-link visitor with no active signer must NOT be forced to log
 *     in just to open the link (editKey possession is what authorizes edits,
 *     same as plain saves already work today);
 *   - a document's pre-existing content must survive the first time anyone
 *     starts a live collaboration session on it (a fresh Yjs doc starts
 *     empty and has to be seeded from the last checkpoint).
 */

test("two collaborators on a shared edit-link doc converge live, including an anonymous visitor", async ({
  page,
  browser,
}) => {
  const unique = `e2e-collab-${Date.now()}`;

  // 1. Owner creates and saves a document.
  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${unique}\n\nowner line`);
  await save(page);

  // 2. Share it with edit access.
  await page.locator('button:has(svg[data-testid="MoreVertIcon"])').click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  await page.getByRole("switch").click(); // "Can edit"
  await page.getByRole("button", { name: "Generate Link" }).click();
  const linkField = page.getByLabel("Private Link");
  await expect(linkField).toHaveValue(/.+/, { timeout: 15_000 });
  const editUrl = await linkField.inputValue();
  await page.getByRole("button", { name: "Close" }).click();

  // Generating an edit link creates a *separate* shared copy (signed by the
  // generated editKey) — the owner's original doc becomes a read-only
  // "backup" pointer, not the live editable copy. The owner has to switch to
  // the live shared copy too in order to actually collaborate on it.
  await page.getByRole("button", { name: "Go to live version" }).click();
  await expect(page).toHaveURL(new URL(editUrl).pathname + new URL(editUrl).hash, {
    timeout: 15_000,
  });
  // Existing (non-draft) documents open in preview mode by default.
  await page.getByRole("button", { name: "WYSIWYG editor" }).click();
  await expect(editorSurface(page)).toBeVisible({ timeout: 15_000 });

  // 3. A second, independent browser context opens the edit link WITHOUT
  //    logging in — this must not be gated behind a login prompt.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(editUrl);
  await expect(pageB.getByRole("dialog", { name: "Sign in" })).toHaveCount(0, {
    timeout: 5_000,
  });
  await pageB.getByRole("button", { name: "Edit document" }).click();
  await expect(editorSurface(pageB)).toBeVisible({ timeout: 15_000 });

  // The pre-existing content must have survived starting a fresh collab
  // session (a brand-new Yjs doc starts empty and must be seeded).
  await expect(editorSurface(pageB)).toContainText("owner line", {
    timeout: 15_000,
  });

  // Wait for the connection to be live in both directions before editing —
  // each side seeing the other's presence avatar is the signal a real user
  // would (implicitly) rely on that collaboration is actually connected,
  // rather than typing the instant the editor becomes interactive.
  await expect(page.getByRole("img", { name: "Anonymous" })).toBeVisible({
    timeout: 15_000,
  });
  // B sees A's presence too, labeled with A's shortened pubkey (A is logged
  // in but has no profile name set).
  await expect(pageB.getByRole("img", { name: /^[0-9a-f]{6}…[0-9a-f]{4}$/ })).toBeVisible({
    timeout: 15_000,
  });

  // 4. B edits; A should see it live, without reloading.
  await editorSurface(pageB).click();
  await pageB.keyboard.press("End");
  await pageB.keyboard.type("\ncollaborator line");

  await expect(editorSurface(page)).toContainText("collaborator line", {
    timeout: 20_000,
  });
  // The original content is still there too — this isn't a merge that
  // dropped anything.
  await expect(editorSurface(page)).toContainText("owner line");

  await contextB.close();
});
