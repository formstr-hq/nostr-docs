import { test, expect } from "@playwright/test";
import { nip19 } from "nostr-tools";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  queryLocalRelay,
  unlockAfterReload,
} from "./helpers";

/**
 * Covers the "Publish as article" flow (page → public NIP-23 long-form event).
 *
 * It exercises the whole publish spine: opening the draft/preview dialog, the
 * markdown build step, signing a kind-30023 event, and publishing it to the
 * relay. Uses only accessible roles / labels / visible text — no test hooks.
 */

test("publish a page as a NIP-23 long-form article", async ({ page }) => {
  const unique = `e2e-article-${Date.now()}`;
  const body = `body of ${unique}`;

  // Create and save a document to publish from.
  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${unique}\n\n${body}`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  // The published article is authored by the same user — grab their pubkey from
  // the saved document's naddr so we can query the relay for it precisely.
  const naddr = new URL(page.url()).pathname.split("/doc/")[1].split("/")[0];
  const { pubkey } = nip19.decode(naddr).data as nip19.AddressPointer;

  // Open the overflow menu → Share, then choose "Publish as Article".
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  await page.getByRole("button", { name: "Publish as Article" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Publish as article" });
  await expect(dialog).toBeVisible();

  // The draft preview shows the built (sanitized) markdown body.
  await expect(dialog.getByText(body, { exact: false })).toBeVisible({ timeout: 20_000 });

  // Give the article a deterministic title, then publish.
  await dialog.getByLabel("Title").fill(unique);
  const publishBtn = dialog.getByRole("button", { name: "Publish", exact: true });
  await expect(publishBtn).toBeEnabled({ timeout: 20_000 });
  await publishBtn.click();

  // Success state confirms the event was signed and sent.
  await expect(dialog.getByText(/Published!/)).toBeVisible({ timeout: 20_000 });

  // The kind-30023 event actually reached the local relay with our content/title.
  const stored = await queryLocalRelay({ kinds: [30023], authors: [pubkey] });
  const article = stored.find((e) => e.content.includes(body));
  expect(article, "published long-form article should be on the relay").toBeTruthy();
  expect(article!.tags.find((t) => t[0] === "title")?.[1]).toBe(unique);
  const articleDTag = article!.tags.find((t) => t[0] === "d")?.[1];
  expect(articleDTag).toBeTruthy();

  // It shows up under the sidebar's "Published" tab (no reload needed — the
  // published-articles subscription picks it up live).
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("tab", { name: /Published/ }).click();
  await expect(page.getByRole("button", { name: new RegExp(unique) })).toBeVisible({ timeout: 20_000 });

  // The published link opens our own in-app reader — it fetches the event back
  // from the relay and renders the markdown.
  const articleNaddr = nip19.naddrEncode({ identifier: articleDTag!, pubkey, kind: 30023 });
  await page.goto(`/article/${articleNaddr}`);
  // The full navigation drops the session into a locked (NIP-49) state; the
  // unlock modal makes background content inert, so answer it before asserting.
  await unlockAfterReload(page);
  // The rendered markdown produces an <h1> from the "# <unique>" heading, proving
  // the in-app viewer fetched the event and rendered its content.
  await expect(page.getByRole("heading", { name: unique, level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(body, { exact: false })).toBeVisible();
});
