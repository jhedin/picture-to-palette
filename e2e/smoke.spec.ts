import { test, expect } from "@playwright/test";

test("app loads at /capture", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/capture$/);
  await expect(page.getByRole("button", { name: /take or upload photo/i })).toBeVisible();
});
