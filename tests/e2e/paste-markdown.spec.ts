import { test, expect } from "@playwright/test";
import { loginAsGuest, pasteIntoEditor, editorSurface } from "./helpers";

/**
 * Pasting plain-text clipboard content that looks like markdown (e.g. copied
 * from a README, a chat message, or a terminal) should render as formatted
 * content, the same way typing it with markdown shortcuts would — not land as
 * literal "#"/"**" characters. Prose with no markdown syntax should paste
 * through unchanged either way, so this isn't just "always strip punctuation".
 */

test("pasting markdown-looking plain text renders it as formatted content", async ({
  page,
}) => {
  await loginAsGuest(page);

  await pasteIntoEditor(
    page,
    "# Pasted heading\n\nSome **bold** text in a paragraph.",
  );

  await expect(
    page.getByRole("heading", { name: "Pasted heading" }),
  ).toBeVisible();
  await expect(
    editorSurface(page).locator("strong", { hasText: "bold" }),
  ).toBeVisible();

  // The markdown syntax itself should have been consumed, not left literal.
  await expect(editorSurface(page)).not.toContainText("# Pasted heading");
  await expect(editorSurface(page)).not.toContainText("**bold**");
});

test("pasting plain prose with no markdown syntax lands as plain text", async ({
  page,
}) => {
  await loginAsGuest(page);

  const prose = "just a normal sentence, nothing special here.";
  await pasteIntoEditor(page, prose);

  await expect(editorSurface(page)).toContainText(prose);
});
