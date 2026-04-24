import { test, expect } from "@playwright/test";

test("home page loads and shows app title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Picture to Palette")).toBeVisible();
  await expect(page.getByText("Scaffold is live.")).toBeVisible();
});
