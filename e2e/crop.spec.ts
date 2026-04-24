import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "..", "public", "fixtures", "yarn-cubbies.jpg");

test("crop UI appears after upload with auto-detected box", async ({ page }) => {
  await page.goto("/capture");

  await page.setInputFiles('input[type="file"]', FIXTURE);

  // Crop UI should appear before any chips.
  const extractBtn = page.getByRole("button", { name: /extract colors/i });
  await expect(extractBtn).toBeVisible({ timeout: 20_000 });

  // The crop overlay handles should be visible (corners are rendered as divs).
  // The CropOverlay container sits inside a position:relative wrapper over the image.
  await expect(page.locator('[style*="position: absolute"][style*="inset: 0"]')).toBeVisible();

  // No palette chips yet — we haven't extracted.
  expect(await page.locator('button[aria-label^="Add color #"]').count()).toBe(0);
});

test("extract colors button runs extraction and shows chips", async ({ page }) => {
  await page.goto("/capture");
  await page.setInputFiles('input[type="file"]', FIXTURE);

  await page.getByRole("button", { name: /extract colors/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /extract colors/i }).click();

  // Chips appear after extraction.
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 30_000 });
  const chips = await page.locator('button[aria-label^="Add color #"]').count();
  expect(chips).toBeGreaterThanOrEqual(2);
});

test("use full image skips crop and extracts", async ({ page }) => {
  await page.goto("/capture");
  await page.setInputFiles('input[type="file"]', FIXTURE);

  await page.getByRole("button", { name: /use full image/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /use full image/i }).click();

  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 30_000 });
  const chips = await page.locator('button[aria-label^="Add color #"]').count();
  expect(chips).toBeGreaterThanOrEqual(2);
});

test("adjust crop button returns to crop UI from ready state", async ({ page }) => {
  await page.goto("/capture");
  await page.setInputFiles('input[type="file"]', FIXTURE);

  await page.getByRole("button", { name: /extract colors/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /extract colors/i }).click();
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 30_000 });

  // "Adjust crop" goes back to crop UI.
  await page.getByRole("button", { name: /adjust crop/i }).click();
  await expect(page.getByRole("button", { name: /extract colors/i })).toBeVisible();
});
