import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("full flow: capture → pick anchors → generate → save", async ({ page }, testInfo) => {
  const downloadPromise = page.waitForEvent("download");

  await page.goto("/");
  await expect(page).toHaveURL(/\/capture$/);

  // Upload fixture via the hidden <input type="file">
  const fixture = path.resolve(__dirname, "..", "public", "fixtures", "yarn-cubbies.jpg");
  await page.setInputFiles('input[type="file"]', fixture);

  // Wait for the crop UI to appear, then confirm extraction.
  await page.getByRole("button", { name: /extract colors/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /extract colors/i }).click();

  // Wait for extraction to finish (chips appear).
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 20_000 });

  // Accept all extracted candidates.
  await page.getByRole("button", { name: /accept all/i }).click();

  // Move to Palette.
  await page.getByRole("button", { name: /next → palette/i }).click();
  await expect(page).toHaveURL(/\/palette$/);

  // Pick two anchors (first two swatches).
  const swatches = page.getByRole("button", { name: /swatch #/i });
  const count = await swatches.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await swatches.nth(0).click();
  await swatches.nth(1).click();

  // Generate.
  await page.getByRole("button", { name: /generate gradients/i }).click();
  await expect(page).toHaveURL(/\/gradients$/);

  // Pick the first candidate.
  const candidates = page.getByRole("button", { name: /gradient candidate/i });
  await expect(candidates.first()).toBeVisible();
  await candidates.first().click();

  // Save and assert a download fired.
  await page.getByRole("button", { name: /^save$/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^palette-.+\.png$/);

  // Attach the PNG to the test report for visual inspection.
  await testInfo.attach("saved-gradient.png", {
    path: await download.path(),
    contentType: "image/png",
  });
});
