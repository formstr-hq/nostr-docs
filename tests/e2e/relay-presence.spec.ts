import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  clearRelayEvents,
  pubkeyFromDocUrl,
} from "./helpers";

/**
 * Per-page relay presence: the card indicator names the relays holding a page
 * and, when none do, warns and offers a re-broadcast.
 */

test("a page card shows which relays hold it", async ({ page }) => {
  const title = `Relay Presence ${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${title}\n\npresence body`);
  await save(page);

  await page.getByRole("button", { name: "All pages" }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  const indicator = page.getByRole("button", { name: /^Relay status:/ });
  await expect(indicator).toBeVisible({ timeout: 20_000 });
  await indicator.click();

  const popover = page.getByRole("dialog", { name: "Relay status" });
  await expect(popover.getByText("Relays", { exact: true })).toBeVisible();
  await expect(popover.getByText("localhost:7449")).toBeVisible({ timeout: 15_000 });
  await expect(popover.getByText("1/1")).toBeVisible({ timeout: 15_000 });
  await expect(
    popover.getByRole("button", { name: "Re-broadcast to relays" }),
  ).toBeVisible();
});

test("the editor toolbar shows relay coverage for the open page", async ({ page }) => {
  const title = `Editor Relay ${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${title}\n\neditor body`);
  await save(page);

  // Editor is open; the merged indicator replaces the old dots + broadcast icon.
  const indicator = page.getByRole("button", { name: /^Relay status:/ });
  await expect(indicator).toBeVisible({ timeout: 20_000 });
  await indicator.click();

  const popover = page.getByRole("dialog", { name: "Relay status" });
  await expect(popover.getByText("1/1")).toBeVisible({ timeout: 15_000 });
  await expect(popover.getByText("localhost:7449")).toBeVisible();
  await expect(
    popover.getByRole("button", { name: "Re-broadcast to relays" }),
  ).toBeVisible();
});

test("warns and re-broadcasts when no relay holds the page", async ({ page }) => {
  const title = `Relay Missing ${Date.now()}`;

  await loginAsGuest(page);
  await typeIntoEditor(page, `# ${title}\n\nmissing body`);
  await save(page);

  const pubkey = pubkeyFromDocUrl(page.url());

  // Let the local relay flush the page to disk (its write-through is debounced
  // ~1s) so it survives the reload even after the relay server is emptied.
  await page.waitForTimeout(2000);

  // Drop this account's events from the test relay, then reload so presence is
  // checked fresh (the check is cached per session).
  await clearRelayEvents({ authors: [pubkey] });

  await page.reload();
  await unlockAfterReload(page);
  await page.getByRole("button", { name: "All pages" }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  // The indicator itself announces the missing state.
  const indicator = page.getByRole("button", { name: /Not on any relay/ });
  await expect(indicator).toBeVisible({ timeout: 20_000 });
  await indicator.click();

  const popover = page.getByRole("dialog", { name: "Relay status" });
  await expect(
    popover.getByText("None of your relays have this page."),
  ).toBeVisible();

  await popover.getByRole("button", { name: "Re-broadcast to relays" }).click();
  await expect(popover.getByText("1/1")).toBeVisible({ timeout: 20_000 });
});
