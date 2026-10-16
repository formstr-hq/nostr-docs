import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  editorSurface,
} from "./helpers";

/**
 * Marketing captures for realtime sharing. Skipped in normal runs; run with:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test sharing.screenshots
 *
 * Records BOTH sides (owner + a second identity) of a live co-editing session
 * into `Screenshots/sharing/owner/` and `Screenshots/sharing/editor/`, plus a
 * still from each. The repo's capture script composites them side by side.
 */

const CAPTURE = process.env.CAPTURE_SCREENSHOTS;
const DIR = "Screenshots/sharing";
const VIEWPORT = { width: 1000, height: 700 };

test("capture realtime sharing (both sides)", async ({ browser }) => {
  test.skip(!CAPTURE, "set CAPTURE_SCREENSHOTS=1 to record");
  test.setTimeout(180_000);

  const ownerCtx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: `${DIR}/owner`, size: VIEWPORT },
  });
  const owner = await ownerCtx.newPage();

  await loginAsGuest(owner);
  await typeIntoEditor(owner, "# Product sync\n\n- ship the editor\n");
  await save(owner);

  await owner.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = owner.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(owner).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = owner.url();

  const editorCtx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: `${DIR}/editor`, size: VIEWPORT },
  });
  const editor = await editorCtx.newPage();
  await loginAsGuest(editor);
  await editor.goto(shareLink);
  await unlockAfterReload(editor);
  await expect(editor.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  await expect(editor.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });

  for (const p of [owner, editor]) {
    await p.getByRole("button", { name: "More actions" }).click();
    await p.getByRole("menuitem", { name: "Visual editor" }).click();
  }

  // Both sides edit live, then keep the cursors moving so presence stays fresh.
  await editorSurface(editor).click();
  await editor.keyboard.press("End");
  await editor.keyboard.press("Enter");
  await editor.keyboard.type("Realtime note from the collaborator.");

  await editorSurface(owner).click();
  await owner.keyboard.press("End");
  await owner.keyboard.press("Enter");
  await owner.keyboard.type("Owner reply — we are both editing the same page.");

  await expect(owner.getByText("Realtime note from the collaborator")).toBeVisible({
    timeout: 15_000,
  });
  await expect(editor.getByText("Owner reply")).toBeVisible({ timeout: 15_000 });

  for (let i = 0; i < 6; i++) {
    await editor.keyboard.press("ArrowRight");
    await owner.keyboard.press("ArrowLeft");
    await editor.waitForTimeout(160);
  }

  await owner.screenshot({ path: `${DIR}/owner.png` });
  await editor.screenshot({ path: `${DIR}/editor.png` });

  await ownerCtx.close();
  await editorCtx.close();
});
