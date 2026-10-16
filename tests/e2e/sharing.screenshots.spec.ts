import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  editorSurface,
} from "./helpers";

/**
 * Capture of realtime sharing for marketing. Skipped in normal runs; run with:
 *
 *   CAPTURE_SCREENSHOTS=1 npx playwright test sharing.screenshots
 *
 * Produces a screen recording of the owner's view (`Screenshots/sharing/*.webm`)
 * while a second, independent identity edits the same document live, plus a
 * still (`Screenshots/sharing/realtime-owner-view.png`).
 */

const CAPTURE = process.env.CAPTURE_SCREENSHOTS;
const DIR = "Screenshots/sharing";

test("capture realtime sharing", async ({ browser }) => {
  test.skip(!CAPTURE, "set CAPTURE_SCREENSHOTS=1 to record");
  test.setTimeout(180_000);

  // The owner's context is the "screen" we record.
  const ownerCtx = await browser.newContext({
    viewport: { width: 1100, height: 720 },
    recordVideo: { dir: DIR, size: { width: 1100, height: 720 } },
  });
  const owner = await ownerCtx.newPage();

  await loginAsGuest(owner);
  await typeIntoEditor(
    owner,
    "# Product sync notes\n\n- ship the editor\n- review the sharing model\n",
  );
  await save(owner);

  await owner.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = owner.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(owner).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = owner.url();

  // A second identity joins and both are in edit mode so remote carets render.
  const editorCtx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const editor = await editorCtx.newPage();
  await loginAsGuest(editor);
  await editor.goto(shareLink);
  await unlockAfterReload(editor);
  await expect(editor.getByText("Shared page · edit access")).toBeVisible({
    timeout: 20_000,
  });
  await expect(editor.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
  await editor.getByRole("button", { name: "More actions" }).click();
  await editor.getByRole("menuitem", { name: "Visual editor" }).click();

  await owner.getByRole("button", { name: "More actions" }).click();
  await owner.getByRole("menuitem", { name: "Visual editor" }).click();

  // Collaborator types; the owner sees it appear live (with a remote caret).
  await editorSurface(editor).click();
  await editor.keyboard.press("End");
  await editor.keyboard.press("Enter");
  await editor.keyboard.type("Realtime notes from the collaborator — typing live.");
  await expect(
    owner.getByText("Realtime notes from the collaborator"),
  ).toBeVisible({ timeout: 15_000 });

  // Keep the collaborator "active" (cursor movement → awareness updates) so the
  // owner's view reflects live presence and the resolved caret label.
  for (let i = 0; i < 6; i++) {
    await editor.keyboard.press("ArrowLeft");
    await editor.waitForTimeout(150);
    await editor.keyboard.press("ArrowRight");
    await editor.waitForTimeout(150);
  }

  // Hold on the live state so the recording captures it, then a still.
  await owner.waitForTimeout(3_000);
  await owner.screenshot({ path: `${DIR}/realtime-owner-view.png` });

  await ownerCtx.close(); // finalises the recording
  await editorCtx.close();
});
