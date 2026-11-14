import { test, expect } from "@playwright/test";
import {
  LOCAL_BLOSSOM,
  editorSurface,
  loginAsGuest,
  pubkeyFromDocUrl,
  queryLocalRelay,
  save,
  unlockAfterReload,
} from "./helpers";

test("large page bodies are chunked to Blossom and reload", async ({ page }) => {
  const blossom = LOCAL_BLOSSOM;
  await fetch(`${blossom}/clear`, { method: "POST" });

  await loginAsGuest(page);
  const marker = `TAIL-MARKER-${Date.now()}`;
  const body = `${"Large body paragraph. ".repeat(12000)}${marker}`;

  await editorSurface(page).click();
  await page.keyboard.insertText(body);
  await save(page);

  const author = pubkeyFromDocUrl(page.url());
  const events = await queryLocalRelay({ kinds: [33458], authors: [author] });
  const latest = events.sort((a, b) => a.created_at - b.created_at).at(-1);
  expect(latest?.content.length ?? Infinity).toBeLessThan(20_000);

  const before = await fetch(`${blossom}/stats`).then((response) =>
    response.json(),
  );
  expect(before.count).toBeGreaterThanOrEqual(3);

  // Appending to the end must reuse the unchanged chunks, not re-upload the
  // whole body.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  await editorSurface(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" edited");
  await save(page);
  const after = await fetch(`${blossom}/stats`).then((response) =>
    response.json(),
  );
  expect(after.count - before.count).toBeLessThanOrEqual(2);

  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByText(marker, { exact: false })).toBeVisible({
    timeout: 20_000,
  });
});

test("a promoted page stays chunked after shrinking below the threshold", async ({
  page,
}) => {
  const blossom = LOCAL_BLOSSOM;
  await fetch(`${blossom}/clear`, { method: "POST" });

  await loginAsGuest(page);
  await editorSurface(page).click();
  await page.keyboard.insertText("Large body paragraph. ".repeat(12000));
  await save(page);

  const before = await fetch(`${blossom}/stats`).then((response) =>
    response.json(),
  );
  expect(before.count).toBeGreaterThanOrEqual(3);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  await editorSurface(page).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Short now");
  await save(page);

  const after = await fetch(`${blossom}/stats`).then((response) =>
    response.json(),
  );
  // Still chunked: the short body was uploaded as a new chunk rather than
  // demoting the page back to an inline event.
  expect(after.count).toBeGreaterThan(before.count);

  await page.reload();
  await unlockAfterReload(page);
  await expect(
    page.getByText("Short now", { exact: true }).last(),
  ).toBeVisible({
    timeout: 20_000,
  });
});
