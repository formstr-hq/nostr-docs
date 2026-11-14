import { test, expect } from "@playwright/test";
import { loginAsGuest } from "./helpers";

test("desktop sidebar hides while typing and comes back from the edge tab", async ({
  page,
}) => {
  await loginAsGuest(page);
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("button", { name: "New page" }).first().click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Start a new page" })
    .getByRole("button", { name: "Start with Blank page" })
    .click();

  const surface = page.locator(".tiptap").first();
  await surface.click();
  await page.keyboard.type("Immersive writing");

  await expect(page.getByRole("button", { name: "All pages" })).toBeHidden({
    timeout: 5_000,
  });
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  await expect(showSidebar).toBeVisible();

  await showSidebar.click();
  await expect(page.getByRole("button", { name: "All pages" })).toBeVisible({
    timeout: 5_000,
  });
});
