import { test, expect, type Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, type Event } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { encodeNKeys } from "../../src/utils/nkeys";
import { KIND_COMMENT, KIND_COMMENT_RESOLUTION, KIND_FILE } from "../../src/nostr/kinds";
import { clearRelayEvents, loginAsGuest, publishToLocalRelay, queryLocalRelay, unlockAfterReload } from "./helpers";

async function seedDiscussion(count = 7) {
  const owner = generateSecretKey();
  const viewKey = generateSecretKey();
  const conversationKey = nip44.getConversationKey(viewKey, getPublicKey(viewKey));
  const identifier = `discussion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const address = `${KIND_FILE}:${getPublicKey(owner)}:${identifier}`;
  const createdAt = Math.floor(Date.now() / 1000) - count - 10;
  const doc = finalizeEvent({ kind: KIND_FILE, tags: [["d", identifier]], content: nip44.encrypt("# Discussion test\n\nText to discuss.", conversationKey), created_at: createdAt }, owner);
  await publishToLocalRelay(doc);
  const comments: Event[] = [];
  for (let i = 0; i < count; i++) {
    const tags = [["content", `Reply level ${i}`], ["type", "comment"]];
    if (i) tags.push(["parent", comments[i - 1].id]);
    else tags.push(["quote", "Text to discuss."]);
    const event = finalizeEvent({ kind: KIND_COMMENT, tags: [["a", address], ["e", doc.id]], content: nip44.encrypt(JSON.stringify(tags), conversationKey), created_at: createdAt + i + 1 }, owner);
    comments.push(event);
    await publishToLocalRelay(event);
  }
  const naddr = nip19.naddrEncode({ kind: KIND_FILE, pubkey: getPublicKey(owner), identifier });
  const path = `/doc/${naddr}`;
  const hash = `#${encodeNKeys({ viewKey: bytesToHex(viewKey) })}`;
  return { path, hash, address, comments, conversationKey, owner };
}

async function openComments(page: Page) {
  const toggle = page.getByRole("button", { name: "Show comments", exact: true });
  await expect(toggle.or(page.getByRole("button", { name: "More actions" }))).toBeVisible();
  if (await toggle.isVisible()) await toggle.click();
  else {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Show Comments", exact: true }).click();
  }
}

test("three reply levels lead to a discussion; nested answers survive reload", async ({ page }) => {
  const seeded = await seedDiscussion();
  await loginAsGuest(page);
  await page.goto(seeded.path + seeded.hash);
  await unlockAfterReload(page);
  await expect(page.getByText("Text to discuss.", { exact: true }).first()).toBeVisible();
  await openComments(page);
  await expect(page.getByText("Reply level 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Reply level 4", { exact: true })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("nested-sidebar.png") });
  await page.getByRole("link", { name: "Continue discussion" }).click();
  await expect(page).toHaveURL(new RegExp(`/discussion/${seeded.comments[3].id}#nkeys1`));
  await expect(page.getByRole("heading", { name: "Discussion", exact: true })).toBeVisible();
  await expect(page.getByText("Reply level 6", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("discussion.png") });
  const deepest = page.locator(`[data-comment-id="${seeded.comments[6].id}"]`);
  await deepest.getByRole("button", { name: "Reply", exact: true }).click();
  await deepest.getByPlaceholder("Write a reply…").fill("A deeply nested answer");
  await deepest.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("A deeply nested answer", { exact: true })).toBeVisible();
  const posted = await queryLocalRelay({ kinds: [KIND_COMMENT], "#a": [seeded.address] });
  const payloads = posted.map((event) => JSON.parse(nip44.decrypt(event.content, seeded.conversationKey)) as string[][]);
  const answer = payloads.find((tags) => tags.some((tag) => tag[0] === "content" && tag[1] === "A deeply nested answer"));
  expect(answer).toContainEqual(["parent", seeded.comments[6].id]);

  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByText("A deeply nested answer", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Parent comment", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/discussion/${seeded.comments[2].id}#nkeys1`));
  await page.getByRole("link", { name: "Show full thread" }).click();
  await expect(page.getByText("Reply level 0", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to page" }).click();
  await expect(page).toHaveURL(seeded.path + seeded.hash);
  await openComments(page);
  await expect(page.getByText("Reply level 3", { exact: true })).toBeVisible();
  await expect(page.getByText("A deeply nested answer", { exact: true })).toBeHidden();
});

test("replying at the sidebar limit opens the new answer in discussion", async ({ page }) => {
  const seeded = await seedDiscussion(4);
  await loginAsGuest(page);
  await page.goto(seeded.path + seeded.hash);
  await unlockAfterReload(page);
  await expect(page.getByText("Text to discuss.", { exact: true }).first()).toBeVisible();
  await openComments(page);
  const boundary = page.locator(`[data-comment-id="${seeded.comments[3].id}"]`);
  await boundary.getByRole("button", { name: "Reply", exact: true }).click();
  await boundary.getByPlaceholder("Write a reply…").fill("Beyond the sidebar");
  await boundary.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discussion", exact: true })).toBeVisible();
  await expect(page.getByText("Beyond the sidebar", { exact: true })).toBeVisible();
});

test("deep discussion links work on mobile and inherit root resolution", async ({ page }) => {
  const seeded = await seedDiscussion();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${seeded.path}/discussion/${seeded.comments[4].id}${seeded.hash}`);
  await expect(page.getByText("Reply level 6", { exact: true })).toBeVisible();
  const resolution = finalizeEvent({ kind: KIND_COMMENT_RESOLUTION, created_at: Math.floor(Date.now() / 1000), tags: [["d", seeded.comments[0].id], ["a", seeded.address]], content: nip44.encrypt(JSON.stringify([["comment", seeded.comments[0].id], ["resolved", "true"]]), seeded.conversationKey) }, seeded.owner);
  await publishToLocalRelay(resolution);
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("discussion-mobile.png") });
  await page.getByRole("link", { name: "Back to page" }).click();
  await openComments(page);
  await page.getByRole("button", { name: "Show resolved (1)", exact: true }).click();
  await expect(page.getByText("Reply level 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Continue discussion" }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
});

test("a late parent reconnects a discussion without hiding its replies", async ({ page }) => {
  const seeded = await seedDiscussion(2);
  await clearRelayEvents({ ids: [seeded.comments[0].id] });
  await page.goto(`${seeded.path}/discussion/${seeded.comments[1].id}${seeded.hash}`);
  await expect(page.getByText("Reply level 1", { exact: true })).toBeVisible();
  await expect(page.getByText("An earlier comment in this discussion has not loaded yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
  await publishToLocalRelay(seeded.comments[0]);
  await expect(page.getByRole("link", { name: "Parent comment", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
});

test("long discussions load more without unlimited indentation", async ({ page }) => {
  const seeded = await seedDiscussion(110);
  await page.goto(`${seeded.path}/discussion/${seeded.comments[0].id}${seeded.hash}`);
  await expect(page.getByText("Reply level 99", { exact: true })).toBeVisible();
  await expect(page.getByText("Reply level 100", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Load more replies" }).click();
  await expect(page.getByText("Reply level 109", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more replies" })).toBeHidden();
});
