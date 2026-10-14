import { test, expect, type Page } from "@playwright/test";
import { loginAsGuest, typeIntoEditor, save } from "./helpers";

/**
 * The local relay persists every event it observes/publishes into its own
 * IndexedDB (`pollerama-local-relay:nostr-docs`, store `events`). This proves
 * documents AND their tag metadata survive offline, rather than only living on
 * the network.
 */
const LOCAL_RELAY_DB = "pollerama-local-relay:nostr-docs";

async function storedKinds(page: Page): Promise<Record<number, number>> {
  return page.evaluate(
    (dbName) =>
      new Promise<Record<number, number>>((resolve) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => resolve({});
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("events")) {
            resolve({});
            return;
          }
          const all = db
            .transaction("events", "readonly")
            .objectStore("events")
            .getAll();
          all.onsuccess = () => {
            const byKind: Record<number, number> = {};
            for (const e of all.result as { kind: number }[]) {
              byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
            }
            resolve(byKind);
          };
          all.onerror = () => resolve({});
        };
      }),
    LOCAL_RELAY_DB,
  );
}

test("documents and their tag metadata are persisted in the local relay", async ({
  page,
}) => {
  await loginAsGuest(page);
  await typeIntoEditor(page, `local-relay-${Date.now()}`);
  await save(page);

  const tagInput = page.getByPlaceholder(/add tag/i).first();
  await tagInput.click();
  await tagInput.fill("persisted");
  await tagInput.press("Enter");
  await expect(page.getByText("persisted", { exact: true }).first()).toBeVisible();

  // The worker writes through on a debounce — poll until it lands.
  await expect
    .poll(async () => (await storedKinds(page))[34579] ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const kinds = await storedKinds(page);
  expect(kinds[33457], "the document itself should be cached").toBeGreaterThan(0);
});
