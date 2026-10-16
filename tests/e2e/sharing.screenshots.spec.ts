import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { finalizeEvent } from "nostr-tools";
import { decrypt as nip49Decrypt } from "nostr-tools/nip49";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  editorSurface,
  publishToLocalRelay,
  TEST_PASSPHRASE,
} from "./helpers";

/**
 * Marketing capture: a human and their AI agent co-writing one document in real
 * time. Skipped in normal runs; run with:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test sharing.screenshots
 *
 * Both contexts start recording at the same instant so the sides stay
 * frame-aligned; the co-editing start time is written to `.edit-offset` for the
 * compositing step.
 */

const CAPTURE = process.env.CAPTURE_SCREENSHOTS;
const DIR = "Screenshots/sharing";
const VIEWPORT = { width: 1000, height: 700 };

/** Publish a kind-0 profile for the page's just-created identity. */
async function setDisplayName(page: Page, name: string) {
  const ncryptsec = await page.evaluate(() => {
    const raw =
      localStorage.getItem("formstr:signer:accounts") ??
      localStorage.getItem("@formstr/signer:accounts");
    if (!raw) return null;
    const accounts = JSON.parse(raw) as Array<{ ncryptsec?: string }>;
    return accounts.find((a) => a.ncryptsec)?.ncryptsec ?? null;
  });
  if (!ncryptsec) throw new Error("no ncryptsec account found in localStorage");
  const secret = nip49Decrypt(ncryptsec, TEST_PASSPHRASE);
  const event = finalizeEvent(
    {
      kind: 0,
      tags: [],
      content: JSON.stringify({ name, display_name: name, about: "" }),
      created_at: Math.floor(Date.now() / 1000),
    },
    secret,
  );
  await publishToLocalRelay(event);
}

async function becomeVisualEditor(page: Page) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
}

async function append(page: Page, text: string, delay = 55) {
  await editorSurface(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text, { delay });
}

test("capture realtime sharing (both sides)", async ({ browser }) => {
  test.skip(!CAPTURE, "set CAPTURE_SCREENSHOTS=1 to record");
  test.setTimeout(240_000);

  const t0 = Date.now();

  const ownerCtx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: `${DIR}/owner`, size: VIEWPORT },
  });
  const owner = await ownerCtx.newPage();
  const editorCtx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: `${DIR}/editor`, size: VIEWPORT },
  });
  const editor = await editorCtx.newPage();

  // Human.
  await loginAsGuest(owner);
  await setDisplayName(owner, "Alex");
  await typeIntoEditor(
    owner,
    "# Launch note\n\nReal-time co-writing with your AI agent.\n",
  );
  await save(owner);
  await owner.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = owner.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(owner).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = owner.url();

  // The agent.
  await loginAsGuest(editor);
  await setDisplayName(editor, "Aria (AI)");
  await editor.goto(shareLink);
  await unlockAfterReload(editor);
  await expect(editor.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  await expect(editor.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });

  await becomeVisualEditor(owner);
  await becomeVisualEditor(editor);

  writeFileSync(`${DIR}/.edit-offset`, String((Date.now() - t0) / 1000));

  // Alex writes.
  await append(owner, "Alex here — drafting the announcement with Aria.", 45);
  await expect(editor.getByText("drafting the announcement")).toBeVisible({
    timeout: 15_000,
  });
  await owner.waitForTimeout(1500);

  // Aria (the agent) writes into the same page, live.
  await append(editor, "Aria: done. Write with your AI — we share one document.", 45);
  await expect(owner.getByText("Write with your AI")).toBeVisible({ timeout: 15_000 });
  await editor.waitForTimeout(1500);

  // Alex replies.
  await append(owner, "Perfect. Ship it. 🚀", 45);
  await expect(editor.getByText("Ship it")).toBeVisible({ timeout: 15_000 });

  // Let both cursors move so presence stays vivid.
  for (let i = 0; i < 12; i++) {
    await editor.keyboard.press("ArrowRight");
    await owner.keyboard.press("ArrowLeft");
    await editor.waitForTimeout(180);
  }
  await owner.waitForTimeout(1500);

  await owner.screenshot({ path: `${DIR}/owner.png` });
  await editor.screenshot({ path: `${DIR}/editor.png` });

  await ownerCtx.close();
  await editorCtx.close();
});
