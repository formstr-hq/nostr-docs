import { Page, expect } from "@playwright/test";
import WebSocket from "ws";
import { nip19, type Event, type Filter } from "nostr-tools";

export const LOCAL_RELAY = "localhost:7449";
export const LOCAL_RELAY_URL = "ws://localhost:7449";
export const LOCAL_RELAY_CONTROL = "http://localhost:7449";

/**
 * Empty matching events from the test relay via its HTTP control surface. Pass
 * an author/id filter to scope the wipe (recommended) — the relay is shared
 * across the whole suite, so an unfiltered clear removes everyone's events.
 */
export async function clearRelayEvents(filter?: {
  authors?: string[];
  ids?: string[];
}): Promise<void> {
  const res = await fetch(`${LOCAL_RELAY_CONTROL}/clear`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(filter ?? {}),
  });
  if (!res.ok) throw new Error(`relay clear failed: HTTP ${res.status}`);
}

/** The pubkey embedded in a `/doc/<naddr>` URL. */
export function pubkeyFromDocUrl(url: string): string {
  const match = url.match(/\/doc\/(naddr1[0-9a-z]+)/i);
  if (!match) throw new Error(`no naddr in url: ${url}`);
  const decoded = nip19.decode(match[1]);
  if (decoded.type !== "naddr") throw new Error(`not an naddr: ${match[1]}`);
  return decoded.data.pubkey;
}

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

/**
 * Publish a single event to the local test relay over a websocket and resolve
 * once the relay acknowledges it with OK. Lets a test seed relay state (e.g. a
 * published article/NIP) directly, without driving the whole in-app publish UI.
 */
export function publishToLocalRelay(event: Event): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(LOCAL_RELAY_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("relay publish timed out"));
    }, 10_000);
    ws.on("open", () => ws.send(JSON.stringify(["EVENT", event])));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === "OK" && msg[1] === event.id) {
        clearTimeout(timer);
        ws.close();
        resolve();
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
 * Create a fresh account through the real login modal from the draft editor.
 * Playwright provides isolated browser storage for each test; no signer
 * internals or storage seeding are needed.
 */
export async function loginAsGuest(page: Page) {
  await page.goto("/new");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await createAccountFromOpenModal(page);
}

/**
 * Complete account creation from an already-open login modal (the caller opens
 * it). Split out so a test can log in without navigating away first — e.g. to
 * check that a draft typed while logged out survives the login.
 */
export async function createAccountFromOpenModal(page: Page) {
  // The login modal and the recovery-key dialog can overlap in the DOM while
  // the former is fading out, so scope each by its own text.
  const loginDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Choose how you'd like to access your documents" });
  await loginDialog
    .getByRole("button", { name: /Create new account/ })
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
 * Complete the unlock prompt when loading private document content from a
 * restored NIP-49 account.
 */
export async function unlockAfterReload(page: Page) {
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Unlock account" });
  await dialog.getByLabel("Passphrase").fill(TEST_PASSPHRASE);
  await dialog.getByRole("button", { name: "Unlock" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Dismiss the Share dialog if it is open. The dialog stays open (by design)
 * after a link is generated, so tests that continue to drive the editor must
 * close it — while a modal is open the rest of the app is out of the
 * accessibility tree, so role-based queries for the toolbar/sidebar would miss.
 */
export async function closeShareDialog(page: Page) {
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  if ((await dialog.count()) === 0) return;
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
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
