import { test, expect } from "@playwright/test";
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip44,
  nip19,
} from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { encodeNKeys } from "../../src/utils/nkeys";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  publishToLocalRelay,
  closeShareDialog,
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
    { name: "Shared", filter: "shared" },
    { name: "Visited", filter: "visited" },
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

test("opening a shared document link classifies as visited and survives reload", async ({
  page,
}) => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const viewKeyBytes = generateSecretKey();
  const viewKeyHex = bytesToHex(viewKeyBytes);
  const convKey = nip44.getConversationKey(viewKeyBytes, getPublicKey(viewKeyBytes));
  const uniqueTitle = `Visited Page ${Date.now()}`;
  const encrypted = nip44.encrypt(`Body of ${uniqueTitle}`, convKey);
  const dTag = `visited-${Date.now()}`;

  const event = finalizeEvent(
    {
      kind: 33457,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", dTag],
        ["title", uniqueTitle],
      ],
    },
    sk,
  );

  await publishToLocalRelay(event);

  const naddr = nip19.naddrEncode({
    kind: 33457,
    pubkey,
    identifier: dTag,
  });

  const hash = encodeNKeys({ viewKey: viewKeyHex });

  // Open the shared link
  await page.goto(`/doc/${naddr}#${hash}`);

  // Confirm content is decrypted and displayed
  await expect(page.getByText(`Body of ${uniqueTitle}`, { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // Navigate to home
  await page.goto("/");

  // The Visited workspace button should be visible
  const visitedBtn = page.getByRole("button", { name: /Visited/ });
  await expect(visitedBtn).toBeVisible({ timeout: 10_000 });
  await visitedBtn.click();

  // The visited document should appear in the Visited list
  const docTitle = page.getByText(uniqueTitle, { exact: true }).first();
  await expect(docTitle).toBeVisible({ timeout: 10_000 });

  // Deduplication: It should NOT appear in Shared
  await page.getByRole("button", { name: "Shared", exact: true }).click();
  await expect(page.getByText(uniqueTitle, { exact: true })).toBeHidden({ timeout: 5_000 });

  // Reload the page: survives reload without login
  await page.reload();
  await page.getByRole("button", { name: /Visited/ }).click();
  await expect(page.getByText(uniqueTitle, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Remove from visited
  const removeBtn = page.getByRole("button", { name: "Remove from visited" }).first();
  await removeBtn.click();

  // Confirm it disappears
  await expect(page.getByText(uniqueTitle, { exact: true })).toBeHidden({ timeout: 10_000 });
});

test("only pages that are shared by me appear under the Shared tab", async ({
  page,
}) => {
  const unsharedTitle = `Unshared-${Date.now()}`;
  const sharedTitle = `SharedByMe-${Date.now()}`;

  await loginAsGuest(page);

  // 1. Create an unshared document
  await typeIntoEditor(page, `# ${unsharedTitle}\n\nUnshared content`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  // 2. Create and share a second document
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "New page" }).first().click();
  await typeIntoEditor(page, `# ${sharedTitle}\n\nShared content`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  // Generate private share link
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  const generateBtn = page.getByRole("button", { name: "Generate Link" });
  await expect(generateBtn).toBeVisible({ timeout: 10_000 });
  await generateBtn.click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 10_000 });
  // The Share dialog stays open by design; close it before using the sidebar.
  await closeShareDialog(page);

  // 3. In "All pages" / "Personal", both pages exist
  await page.getByRole("button", { name: "All pages" }).click();
  await expect(page.getByText(unsharedTitle, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(sharedTitle, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // 4. In "Shared", ONLY the shared page appears
  await page.getByRole("button", { name: "Shared", exact: true }).click();
  await expect(page.getByText(sharedTitle, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(unsharedTitle, { exact: true })).toBeHidden({ timeout: 5_000 });
});

test("saving a visited page promotes it to Shared alongside pages shared by me", async ({
  page,
}) => {
  const authorSk = generateSecretKey();
  const authorPubkey = getPublicKey(authorSk);
  const viewKeyBytes = generateSecretKey();
  const viewKeyHex = bytesToHex(viewKeyBytes);
  const convKey = nip44.getConversationKey(viewKeyBytes, getPublicKey(viewKeyBytes));
  const visitedTitle = `SharedWithMe-${Date.now()}`;
  const encrypted = nip44.encrypt(`Body of ${visitedTitle}`, convKey);
  const dTag = `promoted-${Date.now()}`;

  const event = finalizeEvent(
    {
      kind: 33457,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", dTag],
        ["title", visitedTitle],
      ],
    },
    authorSk,
  );

  await publishToLocalRelay(event);

  const naddr = nip19.naddrEncode({
    kind: 33457,
    pubkey: authorPubkey,
    identifier: dTag,
  });
  const hash = encodeNKeys({ viewKey: viewKeyHex });

  // 1. Log in so the user can save to shared
  await loginAsGuest(page);

  // 2. Also create a document shared by this user
  const sharedByMeTitle = `SharedByMe-${Date.now()}`;
  await typeIntoEditor(page, `# ${sharedByMeTitle}\n\nShared content`);
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  const generateBtn = page.getByRole("button", { name: "Generate Link" });
  await expect(generateBtn).toBeVisible({ timeout: 10_000 });
  await generateBtn.click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 10_000 });
  // The Share dialog stays open by design; close it before using the sidebar.
  await closeShareDialog(page);

  // 3. Open the someone else's shared document
  await page.goto(`/doc/${naddr}#${hash}`);
  await unlockAfterReload(page);
  await expect(page.getByText(`Body of ${visitedTitle}`, { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // 4. Click "Save to Shared"
  const saveToSharedBtn = page.getByRole("button", { name: "Save to Shared" });
  await expect(saveToSharedBtn).toBeVisible({ timeout: 10_000 });
  await saveToSharedBtn.click();
  await expect(saveToSharedBtn).toBeHidden({ timeout: 10_000 });

  // 5. Navigate to Home -> Shared
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "Shared", exact: true }).click();

  // Both the page shared by me AND the promoted shared page should appear
  await expect(page.getByText(sharedByMeTitle, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(visitedTitle, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // 6. Navigate to Visited -> Promoted page should NOT appear in Visited
  await page.getByRole("button", { name: /Visited/ }).click();
  await expect(page.getByText(visitedTitle, { exact: true })).toBeHidden({ timeout: 5_000 });
});

