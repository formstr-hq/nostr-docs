import { Page, expect } from "@playwright/test";
import WebSocket from "ws";
import type { Event, Filter } from "nostr-tools";

export const LOCAL_RELAY = "localhost:7449";
export const LOCAL_RELAY_URL = "ws://localhost:7449";

/**
 * Shared building blocks for the e2e tests.
 *
 * Everything here interacts the way a real user would — by visible text, roles,
 * placeholders and labels — rather than test-only hooks. Tests never touch
 * localStorage or signer internals, so they stay valid as the signer layer
 * evolves.
 */

/**
 * Query the local test relay directly over a websocket and resolve with every
 * matching stored event (up to EOSE). Used to assert that an event the app
 * published actually reached the relay — which also proves the app is talking
 * to the local relay and not live ones (a broken override returns nothing).
 */
export function queryLocalRelay(filter: Filter): Promise<Event[]> {
  const subId = `e2e-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(LOCAL_RELAY_URL);
    const collected: Event[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("relay query timed out"));
    }, 10_000);
    ws.on("open", () => ws.send(JSON.stringify(["REQ", subId, filter])));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === "EVENT" && msg[1] === subId) collected.push(msg[2]);
      else if (msg[0] === "EOSE" && msg[1] === subId) {
        clearTimeout(timer);
        ws.close();
        resolve(collected);
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Passphrase used for the account the tests create (and to unlock it later). */
export const TEST_PASSPHRASE = "e2e-test-passphrase";

/**
 * Log in as a fresh user through the real login modal. The home page's draft
 * editor shows a "Login to Save" button when no one is signed in; clicking it
 * opens the modal. The signer flow creates a passphrase-protected account
 * ("Create a new account", NIP-49) and then surfaces the recovery key in a
 * separate dialog that must be acknowledged before the app is usable. Uses no
 * signer internals or storage seeding, so it stays valid as the signer layer
 * changes.
 */
export async function loginAsGuest(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Login to Save" }).click();
  // The login modal and the recovery-key dialog can overlap in the DOM while
  // the former is fading out, so scope each by its own text.
  const loginDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Choose how you'd like to access your documents" });
  await loginDialog
    .getByRole("button", { name: /Create a new account/ })
    .click();
  await loginDialog
    .getByLabel("Passphrase", { exact: true })
    .fill(TEST_PASSPHRASE);
  await loginDialog.getByLabel("Confirm passphrase").fill(TEST_PASSPHRASE);
  await loginDialog.getByRole("button", { name: "Create account" }).click();
  // Key derivation (NIP-49) can take a moment before the recovery-key dialog
  // appears in place of the login modal.
  const backupDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Save your recovery key" });
  await backupDialog
    .getByRole("button", { name: /I've saved it/ })
    .click({ timeout: 15_000 });
  await expect(backupDialog).toBeHidden({ timeout: 10_000 });
  // Once signed in, the draft editor's primary action becomes "Save".
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Unlock the account after a reload. The key is persisted NIP-49 encrypted, so
 * a restored session comes back locked and the app prompts for the passphrase;
 * decryption-dependent UI (document titles, bodies) can't render until it's
 * entered. No-op assumption: the prompt opens on its own shortly after load.
 */
export async function unlockAfterReload(page: Page) {
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Unlock account" });
  await dialog.getByLabel("Passphrase").fill(TEST_PASSPHRASE);
  await dialog.getByRole("button", { name: "Unlock" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** The WYSIWYG editor surface (TipTap renders a contenteditable with class "tiptap"). */
export function editorSurface(page: Page) {
  return page.locator(".tiptap").first();
}

/** Type text into the (empty) draft editor. */
export async function typeIntoEditor(page: Page, text: string) {
  const surface = editorSurface(page);
  await surface.click();
  await page.keyboard.type(text);
}

/**
 * Click the toolbar Save button and wait for the save to land. Saving a new
 * (draft) document navigates to its own /doc/<naddr> URL, so that navigation —
 * not the transient "Saved" toast, which unmounts as the page navigates — is the
 * reliable signal that the document was created and published.
 */
export async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/naddr1/, { timeout: 20_000 });
}
