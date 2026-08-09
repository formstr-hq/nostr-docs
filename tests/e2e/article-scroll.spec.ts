import { test, expect } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { publishToLocalRelay } from "./helpers";

/**
 * Regression test for the article/NIP reader scroll fix.
 *
 * The reader (`ArticleView`) lives inside a fixed-height, overflow:hidden main
 * shell. Before the fix its container had `overflowY:auto` but no height, so it
 * grew to the full content height and the overflow was clipped by the parent —
 * long articles couldn't be scrolled at all. This test seeds a deliberately
 * long article/NIP directly on the local relay, opens it in the in-app reader,
 * and asserts the reader's own container is genuinely scrollable (not clipped).
 *
 * Articles (NIP-23, kind 30023) and community NIPs (kind 30817) render through
 * the same reader, so both kinds are exercised to prove the fix covers NIPs too.
 */

const KIND_LONGFORM = 30023;
const KIND_COMMUNITY_NIP = 30817;

// A body tall enough to overflow the viewport several times over.
const LONG_BODY = Array.from(
  { length: 60 },
  (_, i) =>
    `## Section ${i + 1}\n\nParagraph ${i + 1}: the quick brown fox jumps over ` +
    `the lazy dog, again and again, to make this page comfortably taller than ` +
    `the viewport so the reader has something to scroll through.`,
).join("\n\n");

for (const { label, kind } of [
  { label: "article (NIP-23)", kind: KIND_LONGFORM },
  { label: "community NIP", kind: KIND_COMMUNITY_NIP },
]) {
  test(`reader scrolls a long ${label}`, async ({ page }) => {
    const unique = `e2e-scroll-${kind}-${Date.now()}`;
    const identifier = unique;

    // Sign a long addressable event and seed it straight onto the local relay.
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const event = finalizeEvent(
      {
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", identifier],
          ["title", unique],
        ],
        content: `# ${unique}\n\n${LONG_BODY}`,
      },
      sk,
    );
    await publishToLocalRelay(event);

    // Open it in the in-app reader (no login needed — it fetches by naddr).
    const naddr = nip19.naddrEncode({ identifier, pubkey, kind });
    await page.goto(`/article/${naddr}`);

    // Content rendered: the "# <unique>" heading becomes an <h1>.
    await expect(page.getByRole("heading", { name: unique, level: 1 })).toBeVisible({
      timeout: 20_000,
    });

    // Walk up from the heading to <main> and find the reader's scroll container:
    // an ancestor with overflow-y auto/scroll whose content actually overflows.
    // Before the fix no such element existed (the box grew and main clipped it),
    // so `scrollable` would be false. After the fix the container scrolls, and
    // driving it to the bottom leaves a non-zero scrollTop.
    const result = await page.evaluate(() => {
      const h1 = document.querySelector("main h1");
      let el: HTMLElement | null = h1?.parentElement ?? null;
      while (el && el.tagName.toLowerCase() !== "main") {
        const style = getComputedStyle(el);
        const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
        if (scrolls && el.scrollHeight > el.clientHeight + 4) {
          el.scrollTop = el.scrollHeight;
          return { scrollable: true, scrolledTo: el.scrollTop };
        }
        el = el.parentElement;
      }
      return { scrollable: false, scrolledTo: 0 };
    });

    expect(result.scrollable, "reader container should overflow and scroll").toBe(true);
    expect(result.scrolledTo, "scrolling to the bottom should move scrollTop").toBeGreaterThan(0);
  });
}
