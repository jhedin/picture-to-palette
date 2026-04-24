import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "..", "public", "fixtures", "yarn-cubbies.jpg");

test("drag a candidate chip into the accepted palette zone", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);

  await page.getByRole("button", { name: /extract colors/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /extract colors/i }).click();
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 30_000 });

  // Get the first candidate chip.
  const firstChip = page.getByRole("button", { name: /^Add color #/i }).first();
  const chipLabel = await firstChip.getAttribute("aria-label") ?? "";
  const hex = chipLabel.match(/#[0-9A-Fa-f]{6}/)?.[0] ?? "";
  expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);

  // The palette drop zone is the dashed-border div. Use its containing section.
  const dropZone = page.locator('[style*="border: 2px dashed"]');
  await expect(dropZone).toBeVisible();

  // Drag the chip into the drop zone.
  await page.dragAndDrop(
    `button[aria-label="Add color ${hex}"]`,
    '[style*="border: 2px dashed"]',
  );

  // The chip should now appear in the accepted section with a Remove button.
  await expect(
    page.getByRole("button", { name: `Remove color ${hex}` }),
  ).toBeVisible({ timeout: 3_000 });
});

test("tap-tap-merge combines two candidates into one", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);

  await page.getByRole("button", { name: /extract colors/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /extract colors/i }).click();
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 30_000 });

  const chips = page.getByRole("button", { name: /^Add color #/i });
  const initialCount = await chips.count();
  expect(initialCount).toBeGreaterThanOrEqual(2);

  // Enter merge mode.
  await page.getByRole("button", { name: /merge…/i }).click();

  // Tap first chip.
  await chips.nth(0).click();
  // Tap second chip — merge fires immediately.
  await chips.nth(1).click();

  // After merge, count should be one less (two removed, one added).
  await expect(page.getByRole("button", { name: /^Add color #/i })).toHaveCount(
    initialCount - 1,
    { timeout: 3_000 },
  );
});

test("clear all removes candidates and accepted colors", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);

  await page.getByRole("button", { name: /extract colors/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /extract colors/i }).click();
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 30_000 });

  // Accept all, then clear all.
  await page.getByRole("button", { name: /accept all/i }).click();
  await page.getByRole("button", { name: /clear all/i }).click();

  // No candidates or accepted chips remain.
  await expect(page.getByRole("button", { name: /^Add color #|^Remove color #/i })).toHaveCount(0, {
    timeout: 3_000,
  });
});
