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
 * End-to-end "health check" for the core nostr-docs round-trip:
 *
 *   sign in  ->  create a document  ->  write content  ->  save (encrypt +
 *   publish to relays)  ->  read it back from the relay after a full reload.
 *
 * This exercises the whole spine of the app — signing, encryption, relay
 * publish, relay read, and decryption for display — so it stays meaningful even
 * as the UI changes. It is written to survive cosmetic UI churn:
 *
 *   - selectors use accessible roles / visible text / placeholders, never CSS
 *     structure or test-only hooks;
 *   - it does not touch localStorage or any signer internals;
 *   - it asserts on a unique value typed in, not on incidental copy.
 */

test("create a document, save it, and read it back from the relay", async ({
  page,
}) => {
  // A value unique to each run so we can't match a stale document.
  const unique = `e2e-doc-${Date.now()}`;

  // 1. Sign in as a fresh anonymous user.
  await loginAsGuest(page);

  // 2. Write a document in the draft editor.
  await typeIntoEditor(page, `# ${unique}\n\nhello from the e2e suite`);

  // 3. Save. This encrypts the content, publishes a kind-33457 file event to the
  //    relays, and navigates to the document's own /doc/<naddr> URL.
  await save(page);
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });

  // 4. Confirm the document actually landed on our LOCAL relay (not live ones).
  //    The naddr in the URL identifies the exact event we just saved.
  const naddr = new URL(page.url()).pathname.split("/doc/")[1].split("/")[0];
  const decoded = nip19.decode(naddr);
  expect(decoded.type).toBe("naddr");
  const { kind, pubkey, identifier } = decoded.data as nip19.AddressPointer;

  const stored = await queryLocalRelay({
    kinds: [kind],
    authors: [pubkey],
    "#d": [identifier],
  });
  expect(stored.length, "saved document should be on the local relay").toBeGreaterThan(0);

  // 5. Reload to drop all in-memory state, then confirm the content makes the
  //    full round-trip: it is fetched back from the relay and decrypted for
  //    display in the rendered preview.
  await page.reload();
  // The restored session is locked (the key is stored NIP-49 encrypted), so
  // answer the passphrase prompt before content can be decrypted for display.
  await unlockAfterReload(page);
  // The content was saved as a markdown "# <unique>" heading; assert it renders
  // back in the document preview (the sidebar also shows it as a title, so scope
  // to the heading to keep the match unambiguous).
  await expect(page.getByRole("heading", { name: unique })).toBeVisible({
    timeout: 20_000,
  });
});
