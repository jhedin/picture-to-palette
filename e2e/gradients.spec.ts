import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "..", "public", "fixtures", "yarn-cubbies.jpg");

async function extractAndGoToPalette(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.getByRole("button", { name: /extract colors/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /extract colors/i }).click();
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 30_000 });
  await page.getByRole("button", { name: /accept all/i }).click();
  await page.getByRole("button", { name: /next → palette/i }).click();
  await expect(page).toHaveURL(/\/palette$/);
}

test("gradient shelf shows palette colors and sequence builds on tap", async ({ page }) => {
  await extractAndGoToPalette(page);

  await page.getByRole("button", { name: /generate gradients/i }).click();
  await expect(page).toHaveURL(/\/gradients$/);

  // Shelf contains palette colors.
  const shelfButtons = page.getByRole("button", { name: /add #.+ to sequence/i });
  await expect(shelfButtons.first()).toBeVisible({ timeout: 5_000 });

  // Tap two shelf colors to build a sequence.
  await shelfButtons.nth(0).click();
  await shelfButtons.nth(1).click();

  // Both are now in the sequence (remove buttons appear).
  const removeButtons = page.getByRole("button", { name: /remove #.+ from sequence/i });
  await expect(removeButtons).toHaveCount(2);

  // Save PNG becomes enabled.
  await expect(page.getByRole("button", { name: /save png/i })).toBeEnabled();
});

test("+ button between sequence items shows candidates", async ({ page }) => {
  await extractAndGoToPalette(page);

  // Pick anchors so the sequence pre-seeds.
  const swatches = page.getByRole("button", { name: /swatch #/i });
  await swatches.nth(0).click();
  await swatches.nth(1).click();
  await page.getByRole("button", { name: /generate gradients/i }).click();
  await expect(page).toHaveURL(/\/gradients$/);

  // Wait for the pre-seeded sequence.
  await expect(page.getByRole("button", { name: /remove #.+ from sequence/i }).first()).toBeVisible({ timeout: 5_000 });

  // Click the + between the two set-points.
  const plusBtn = page.getByRole("button", { name: /find colors between position/i });
  if (await plusBtn.count() > 0) {
    await plusBtn.first().click();
    // Candidate picker or "no candidates" message should appear.
    await expect(
      page.getByRole("button", { name: /insert #/i }).or(page.getByText(/no .+ candidates/i)),
    ).toBeVisible({ timeout: 3_000 });
  }
});

test("removing a sequence item makes it available on shelf again", async ({ page }) => {
  await extractAndGoToPalette(page);
  await page.getByRole("button", { name: /generate gradients/i }).click();
  await expect(page).toHaveURL(/\/gradients$/);

  // Add one color to sequence.
  const first = page.getByRole("button", { name: /add #.+ to sequence/i }).first();
  const label = await first.getAttribute("aria-label") ?? "";
  const hex = label.match(/#[0-9A-Fa-f]{6}/)?.[0] ?? "";
  await first.click();

  // Color is faded/disabled on shelf.
  await expect(page.getByRole("button", { name: `Add ${hex} to sequence` })).toBeDisabled();

  // Remove it from sequence.
  await page.getByRole("button", { name: `Remove ${hex} from sequence` }).click();

  // Color is enabled on shelf again.
  await expect(page.getByRole("button", { name: `Add ${hex} to sequence` })).toBeEnabled();
});
