import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  closeShareDialog,
  editorSurface,
  loginAsGuest,
  save,
  typeIntoEditor,
  unlockAfterReload,
} from "./helpers";

test("new documents default to the notes canvas and can switch to page", async ({
  page,
}) => {
  await page.goto("/new");
  await expect(page.locator("[data-pages-content]")).toBeVisible();
  await expect(page.locator("[data-pages-page]")).toHaveCount(0);
  await expect(page.locator("[data-pages-content]")).toHaveCSS(
    "max-width",
    "820px",
  );

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Page view" }).click();
  await expect(page.locator("[data-pages-page]")).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Notes view" }).click();
  await expect(page.locator("[data-pages-page]")).toHaveCount(0);
});

test("page layout, alignment, and page breaks survive save + reload", async ({
  page,
}) => {
  const unique = `Layout ${Date.now()}`;
  await loginAsGuest(page);

  await editorSurface(page).click();
  await page.keyboard.type(`# ${unique}\n\nhello from the layout test`);

  // ── Page setup ─────────────────────────────────────────────
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Page setup/ }).click();

  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Page setup" });

  await dialog.getByLabel("Canvas", { exact: true }).click();
  await page.getByRole("option", { name: "Page", exact: true }).click();

  await dialog.getByLabel("Page size").click();
  await page.getByRole("option", { name: "Letter", exact: true }).click();

  await dialog.getByLabel("Orientation").click();
  await page.getByRole("option", { name: "Landscape", exact: true }).click();

  await dialog.getByRole("spinbutton", { name: "Top", exact: true }).fill("0.6");
  await dialog.getByRole("spinbutton", { name: "Right", exact: true }).fill("0.7");
  await dialog.getByRole("spinbutton", { name: "Bottom", exact: true }).fill("0.8");
  await dialog.getByRole("spinbutton", { name: "Left", exact: true }).fill("0.9");

  await dialog.getByRole("textbox", { name: "Header left", exact: true }).fill("ACME Inc");
  await dialog.getByRole("textbox", { name: "Header center", exact: true }).fill("Confidential");
  await dialog.getByRole("textbox", { name: "Header right", exact: true }).fill("2026");
  await dialog.getByRole("textbox", { name: "Footer center", exact: true }).fill("Footer text");

  // Document-level title style: centered and larger, no inline HTML in the
  // Markdown body.
  await dialog
    .getByRole("combobox", { name: /Heading 1 alignment/ })
    .click();
  await page.getByRole("option", { name: "Center", exact: true }).click();
  await dialog
    .getByRole("spinbutton", { name: "Heading 1 size", exact: true })
    .fill("26");

  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText("ACME Inc")).toBeVisible();
  await expect(page.getByText("Confidential")).toBeVisible();

  const pageBox = page.locator("[data-pages-page]");
  await expect(pageBox).toBeVisible();
  const width = await pageBox.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).width),
  );
  const minHeight = await pageBox.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).minHeight),
  );
  expect(width).toBeGreaterThan(900);
  expect(minHeight).toBe(816); // Letter landscape is 8.5in tall

  // ── Insert a page break at the end of the body ─────────────
  await page.locator(".tiptap p").last().click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Page break" }).click();
  await expect(page.locator(".tiptap [data-page-break]")).toHaveCount(1);

  await save(page);

  // ── Reload: content and layout must both round-trip ────────
  await page.reload();
  await unlockAfterReload(page);

  await expect(page.getByRole("heading", { name: unique })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("ACME Inc")).toBeVisible();
  await expect(page.getByText("Footer text")).toBeVisible();
  await expect(page.locator("[data-page-break]")).toHaveCount(1);

  const headingAlign = await page
    .getByRole("heading", { name: unique })
    .evaluate((el) => getComputedStyle(el).textAlign);
  expect(headingAlign).toBe("center");

  const headingSize = await page
    .getByRole("heading", { name: unique })
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(headingSize).toBeCloseTo(34.67, 1);

  const bodyStyle = await page
    .getByText("hello from the layout test")
    .evaluate((el) => el.getAttribute("style") ?? "");
  expect(bodyStyle).toBe("");
  await expect(page.locator("[data-pages-page] span")).toHaveCount(0);

  const reloadedWidth = await page
    .locator("[data-pages-page]")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).width));
  expect(reloadedWidth).toBeGreaterThan(900);

  // ── HTML export carries the layout ─────────────────────────
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Export/ }).click();
  const htmlDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /HTML/ }).click();
  const html = await readFile(
    await (await htmlDownloadPromise).path(),
    "utf8",
  );
  expect(html).toContain("size: 11in 8.5in");
  expect(html).toContain("ACME Inc");
  expect(html).toContain("data-page-break");
  expect(html).toContain("text-align: center;");
  expect(html).toContain("font-size: 26pt;");

  // ── DOCX export carries page size, header and page break ──
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Export/ }).click();
  const docxDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Word/ }).click();
  const docx = await readFile(await (await docxDownloadPromise).path());
  const zip = await JSZip.loadAsync(docx);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  expect(documentXml).toContain('w:w="15840"'); // 11in
  expect(documentXml).toContain('w:h="12240"'); // 8.5in
  expect(documentXml).toContain('w:orient="landscape"');
  expect(documentXml).toContain('w:type="page"');
  expect(documentXml).toContain('w:jc w:val="center"');
  expect(documentXml).toContain('w:sz w:val="52"'); // 26pt in half-points
  const headerXml = await zip.file("word/header1.xml")?.async("string");
  expect(headerXml ?? "").toContain("ACME Inc");
});

test("legacy inline formatting still loads and round-trips", async ({
  page,
}) => {
  await loginAsGuest(page);

  const surface = editorSurface(page);
  await surface.click();
  await surface.evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<h1 style="text-align: center; font-size: 26pt;">Legacy Title</h1>' +
        '<p><span style="font-size: 14pt; line-height: 1.5; color: #ff0000;">legacy body</span></p>',
    );
    data.setData("text/plain", "Legacy Title\n\nlegacy body");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(page.locator(".tiptap h1", { hasText: "Legacy Title" })).toHaveAttribute(
    "style",
    /text-align:\s*center/,
  );
  await expect(page.locator(".tiptap p span")).toHaveAttribute(
    "style",
    /font-size:\s*14pt/,
  );

  await save(page);

  await page.reload();
  await unlockAfterReload(page);

  await expect(page.getByRole("heading", { name: "Legacy Title" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("[data-pages-content] h1")).toHaveAttribute(
    "style",
    /text-align:\s*center/,
  );
  const legacySpan = page.locator(
    '[data-pages-content] span[style*="font-size"]',
  );
  await expect(legacySpan).toHaveCount(1);
  await expect(legacySpan).toHaveAttribute("style", /line-height:\s*1\.5/);
  await expect(legacySpan).toHaveAttribute("style", /color:\s*(#ff0000|rgb\(255, 0, 0\))/i);
  // The title heuristic must not surface raw HTML from an old document.
  await expect(page.getByText(/<h1|<span/i)).toHaveCount(0);
});

test("view-only share exposes the owner's layout", async ({ page, browser }) => {
  await loginAsGuest(page);
  await typeIntoEditor(page, "# Shared Layout\n\nbody");
  await save(page);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Page setup/ }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Page setup" });
  await dialog.getByLabel("Canvas", { exact: true }).click();
  await page.getByRole("option", { name: "Page", exact: true }).click();
  await dialog.getByRole("spinbutton", { name: "Top", exact: true }).fill("0.5");
  await dialog
    .getByRole("textbox", { name: "Header left", exact: true })
    .fill("Shared Header");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Share", exact: true }).click();
  const shareDialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await shareDialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareLink = page.url();
  await closeShareDialog(page);

  const context = await browser.newContext();
  const viewer = await context.newPage();
  await viewer.goto(shareLink);
  await expect(viewer.getByRole("heading", { name: "Shared Layout" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(viewer.getByText("Shared Header")).toBeVisible();
  await expect(viewer.locator("[data-pages-page]")).toHaveCSS(
    "padding-top",
    "48px",
  );
  await context.close();
});

test("changing only the page layout marks the document dirty and saves", async ({
  page,
}) => {
  await loginAsGuest(page);
  await typeIntoEditor(page, "# Layout only\n\nthe body is unchanged");

  await save(page);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Page setup/ }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Page setup" });
  await dialog.getByLabel("Canvas", { exact: true }).click();
  await page.getByRole("option", { name: "Page", exact: true }).click();
  await dialog.getByRole("spinbutton", { name: "Top", exact: true }).fill("0.5");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();

  // The Markdown body did not change; the layout alone must trigger a save.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await page.reload();
  await unlockAfterReload(page);
  await expect(page.getByRole("heading", { name: "Layout only" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("[data-pages-page]")).toHaveCSS(
    "padding-top",
    "48px",
  );
});
