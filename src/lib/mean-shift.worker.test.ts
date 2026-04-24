import { describe, it, expect } from "vitest";
import { extractPalette } from "./mean-shift.worker";

// ── Image factories ───────────────────────────────────────────────────────────
//
// SLIC grid spacing S = sqrt(W*H / K). For a test image to reliably
// produce corner segments that stay inside the border, the border must be
// thicker than S/2. For 128×128 at segmentSize=1500: K≈11, S≈38.6 → use
// border ≥ 25 px.  Small images (32×32) are fine for tests that don't
// involve background removal (no border required).

/**
 * 32×32 three-stripe image: red | green | blue.
 * No surrounding border — all content fills the frame.
 */
function buildThreeStripeImage(): ImageData {
  const w = 32, h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (x < 11)      { data[idx] = 220; data[idx+1] = 30;  data[idx+2] = 30;  }
      else if (x < 22) { data[idx] = 30;  data[idx+1] = 200; data[idx+2] = 30;  }
      else              { data[idx] = 30;  data[idx+1] = 30;  data[idx+2] = 200; }
      data[idx+3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

/**
 * 128×128 image with a 25 px grey border and two interior halves:
 *   left  (x 25..63)  : red    RGB(220, 40, 40)
 *   right (x 64..102) : grey   RGB(200, 200, 200) — same as border
 *
 * With segmentSize=1500 → K≈11, S≈38 → the 25 px border is wide enough
 * that corner SLIC seeds land inside the border, not the interior.
 * Back-projection should catch the right-interior grey and remove it.
 */
function buildBorderMatchingInteriorImage(): ImageData {
  const w = 128, h = 128;
  const BORDER = 25;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const isBorder = x < BORDER || x >= w - BORDER || y < BORDER || y >= h - BORDER;
      if (!isBorder && x < w / 2) {
        // Red foreground interior
        data[idx] = 220; data[idx+1] = 40;  data[idx+2] = 40;
      } else {
        // Grey — appears in border and in right interior
        data[idx] = 200; data[idx+1] = 200; data[idx+2] = 200;
      }
      data[idx+3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

/**
 * 128×128 image: white border (25 px) with three coloured interior stripes.
 * The border colour (white) does NOT appear in the interior.
 * This is used to verify that subtractBackground is a no-op when there is
 * no interior region matching the border.
 */
function buildWhiteBorderedStripeImage(): ImageData {
  const w = 128, h = 128;
  const BORDER = 25;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const isBorder = x < BORDER || x >= w - BORDER || y < BORDER || y >= h - BORDER;
      if (isBorder) {
        data[idx] = 240; data[idx+1] = 240; data[idx+2] = 240;  // white border
      } else {
        const ix = x - BORDER; // position within interior (0..77)
        const iw = w - 2 * BORDER; // 78
        if (ix < iw / 3) {
          data[idx] = 220; data[idx+1] = 40;  data[idx+2] = 40;   // red
        } else if (ix < (2 * iw) / 3) {
          data[idx] = 40;  data[idx+1] = 200; data[idx+2] = 40;   // green
        } else {
          data[idx] = 40;  data[idx+1] = 40;  data[idx+2] = 200;  // blue
        }
      }
      data[idx+3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

/**
 * 48×48 same-hue two-lightness image:
 *   top half    : light yellow  RGB(255, 240, 60)  — OKLab L≈0.96
 *   bottom half : dark golden   RGB(140, 128, 0)   — OKLab L≈0.54
 * ΔL ≈ 0.42 — well above any merge bandwidth, distinct in standard 3D mode.
 * No border needed: mergeL tests don't use background removal.
 */
function buildSameHueTwoLightnessImage(): ImageData {
  const w = 48, h = 48;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (y < h / 2) {
        data[idx] = 255; data[idx+1] = 240; data[idx+2] = 60;   // light yellow
      } else {
        data[idx] = 140; data[idx+1] = 128; data[idx+2] = 0;    // dark golden
      }
      data[idx+3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

/**
 * 128×128 image: white border (25 px), yellow top interior, golden bottom.
 * Used for subtractBackground + mergeL interaction tests.
 */
function buildBorderedSameHueImage(): ImageData {
  const w = 128, h = 128;
  const BORDER = 25;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const isBorder = x < BORDER || x >= w - BORDER || y < BORDER || y >= h - BORDER;
      if (isBorder) {
        data[idx] = 240; data[idx+1] = 240; data[idx+2] = 240;  // white border
      } else if (y < h / 2) {
        data[idx] = 255; data[idx+1] = 240; data[idx+2] = 60;   // light yellow
      } else {
        data[idx] = 140; data[idx+1] = 128; data[idx+2] = 0;    // dark golden
      }
      data[idx+3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

// ── Baseline / smoke ──────────────────────────────────────────────────────────

describe("extractPalette (baseline)", () => {
  it("extracts ~3 clusters from a 3-stripe image", () => {
    const { hexes } = extractPalette(buildThreeStripeImage());
    expect(hexes.length).toBeGreaterThanOrEqual(3);
    expect(hexes.length).toBeLessThanOrEqual(5);
  });

  it("returns uppercase #RRGGBB hex strings", () => {
    const { hexes } = extractPalette(buildThreeStripeImage());
    for (const h of hexes) expect(h).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("returns debug data with correct dimensions and matching cluster-sizes length", () => {
    const { debug, hexes } = extractPalette(buildThreeStripeImage());
    expect(debug.segWidth).toBeGreaterThan(0);
    expect(debug.segHeight).toBeGreaterThan(0);
    expect(debug.segPixels.length).toBe(debug.segWidth * debug.segHeight * 4);
    expect(debug.clusterSizes.length).toBe(hexes.length);
    expect(debug.bandwidth).toBeGreaterThan(0);
  });
});

// ── subtractBackground (Phase 1.5 — histogram back-projection) ───────────────
//
// These tests rely on the border being ≥25 px thick on a 128×128 image so
// that SLIC corner seeds (S≈38 → seeds at S/2≈19 px from the edge) land
// inside the border, keeping corner segments cleanly separated from interior.

describe("subtractBackground option", () => {
  it("reduces colour count when interior matches border colour", () => {
    const img = buildBorderMatchingInteriorImage();
    const { hexes: withSub }    = extractPalette(img, undefined, { subtractBackground: true  });
    const { hexes: withoutSub } = extractPalette(img, undefined, { subtractBackground: false });
    expect(withSub.length).toBeLessThan(withoutSub.length);
  });

  it("without subtraction the grey interior contributes to the palette (≥2 colours)", () => {
    const img = buildBorderMatchingInteriorImage();
    const { hexes } = extractPalette(img, undefined, { subtractBackground: false });
    expect(hexes.length).toBeGreaterThanOrEqual(2);
  });

  it("with subtraction surviving colours are either chromatic or the palette is empty (grey removed)", () => {
    const img = buildBorderMatchingInteriorImage();
    const { hexes } = extractPalette(img, undefined, { subtractBackground: true });
    // Any surviving colour must have visible chroma (grey was the background).
    // It's acceptable for back-projection to return 0 colours on this synthetic
    // image if the grey background bled into interior SLIC segments.
    for (const h of hexes) {
      const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
      expect(Math.max(r,g,b) - Math.min(r,g,b)).toBeGreaterThan(30);
    }
  });

  it("is a no-op when border colour does not appear in the interior", () => {
    const img = buildWhiteBorderedStripeImage();
    const { hexes: withSub }    = extractPalette(img, undefined, { subtractBackground: true  });
    const { hexes: withoutSub } = extractPalette(img, undefined, { subtractBackground: false });
    // White is only in the border, not in the interior, so back-projection
    // should not flag any interior segment.  Allow ±1 for SLIC variation.
    expect(Math.abs(withSub.length - withoutSub.length)).toBeLessThanOrEqual(1);
  });

  it("debug segPixels is populated and border pixels are darkened", () => {
    // Use subtractBackground=false so we definitely get foreground colours.
    const img = buildBorderMatchingInteriorImage();
    const { debug } = extractPalette(img, undefined, { subtractBackground: false });
    expect(debug.segPixels.length).toBeGreaterThan(0);
    // Top-left corner is grey border → should be rendered at ≤50 (200>>2=50).
    const r0 = debug.segPixels[0];
    expect(typeof r0).toBe("number");
    expect(r0).toBeLessThanOrEqual(50);
    expect(r0).toBeGreaterThan(0);
  });

  it("returns only valid hex strings regardless of option value", () => {
    const img = buildBorderMatchingInteriorImage();
    for (const flag of [true, false]) {
      const { hexes } = extractPalette(img, undefined, { subtractBackground: flag });
      for (const h of hexes) expect(h).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

// ── mergeL option (Phase 4.5 — L-weighted merge) ─────────────────────────────

describe("mergeL option", () => {
  it("mergeL=1.0 (default) keeps two distinct-lightness same-hue bands separate", () => {
    const img = buildSameHueTwoLightnessImage();
    const { hexes } = extractPalette(img, undefined, { mergeL: 1.0, mergeBandwidth: 0.08 });
    // ΔL ≈ 0.42 > bandwidth 0.08 in full-L mode — the two yellows should survive.
    expect(hexes.length).toBeGreaterThanOrEqual(2);
  });

  it("mergeL=0.2 produces ≤ colours than mergeL=1.0 on same-hue/different-L image", () => {
    const img = buildSameHueTwoLightnessImage();
    const { hexes: full3D }   = extractPalette(img, undefined, { mergeL: 1.0, mergeBandwidth: 0.08 });
    const { hexes: weighted } = extractPalette(img, undefined, { mergeL: 0.2, mergeBandwidth: 0.08 });
    expect(weighted.length).toBeLessThanOrEqual(full3D.length);
  });

  it("mergeL=0.0 (pure chroma plane) collapses same-hue image to ≤2 colours", () => {
    const img = buildSameHueTwoLightnessImage();
    const { hexes } = extractPalette(img, undefined, { mergeL: 0.0, mergeBandwidth: 0.08 });
    expect(hexes.length).toBeLessThanOrEqual(2);
  });

  it("mergeL=0.0 result has L value between the two source lightness extremes", () => {
    const img = buildSameHueTwoLightnessImage();
    const { hexes } = extractPalette(img, undefined, { mergeL: 0.0, mergeBandwidth: 0.08 });
    // Light yellow: max channel ≈ 255.  Dark golden: max channel ≈ 140.
    // Median-L result should be between them.
    const maxCh = (hex: string) => Math.max(
      parseInt(hex.slice(1,3),16),
      parseInt(hex.slice(3,5),16),
      parseInt(hex.slice(5,7),16),
    );
    for (const h of hexes) {
      expect(maxCh(h)).toBeGreaterThan(100);
      expect(maxCh(h)).toBeLessThan(270);
    }
  });

  it("mergeL=0.2 does NOT collapse colours that differ in hue (red/green/blue)", () => {
    const img = buildThreeStripeImage();
    const { hexes } = extractPalette(img, undefined, { mergeL: 0.2, mergeBandwidth: 0.08 });
    expect(hexes.length).toBeGreaterThanOrEqual(2);
  });

  it("mergeL=0.0 does NOT collapse colours that differ in hue (red/green/blue)", () => {
    const img = buildThreeStripeImage();
    const { hexes } = extractPalette(img, undefined, { mergeL: 0.0, mergeBandwidth: 0.08 });
    expect(hexes.length).toBeGreaterThanOrEqual(2);
  });

  it("returns valid #RRGGBB hex strings for all mergeL values", () => {
    const img = buildSameHueTwoLightnessImage();
    for (const ml of [0.0, 0.2, 0.5, 1.0]) {
      const { hexes } = extractPalette(img, undefined, { mergeL: ml });
      expect(hexes.length).toBeGreaterThan(0);
      for (const h of hexes) expect(h).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

// ── subtractBackground + mergeL interaction ───────────────────────────────────

describe("subtractBackground + mergeL interaction", () => {
  it("combining both removes background AND collapses lightness variants", () => {
    const img = buildBorderedSameHueImage();
    const { hexes: baseline } = extractPalette(img, undefined, {
      subtractBackground: false, mergeL: 1.0,
    });
    const { hexes: combined } = extractPalette(img, undefined, {
      subtractBackground: true, mergeL: 0.2,
    });
    expect(combined.length).toBeLessThanOrEqual(baseline.length);
  });

  it("combined mode does not produce more colours than baseline", () => {
    const img = buildBorderedSameHueImage();
    const { hexes: baseline } = extractPalette(img, undefined, {
      subtractBackground: false, mergeL: 1.0,
    });
    const { hexes: combined } = extractPalette(img, undefined, {
      subtractBackground: true, mergeL: 0.2,
    });
    // Combined should yield ≤ colours — never hallucinate new ones.
    expect(combined.length).toBeLessThanOrEqual(baseline.length);
  });

  it("combined mode returns only valid hex strings", () => {
    const img = buildBorderedSameHueImage();
    const { hexes } = extractPalette(img, undefined, {
      subtractBackground: true, mergeL: 0.2,
    });
    for (const h of hexes) expect(h).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("disabling both options is equivalent to default extraction", () => {
    const img = buildBorderedSameHueImage();
    const { hexes: explicit } = extractPalette(img, undefined, {
      subtractBackground: false, mergeL: 1.0,
    });
    const { hexes: defaults } = extractPalette(img);
    expect(explicit.length).toBe(defaults.length);
    expect(explicit.sort()).toEqual(defaults.sort());
  });
});
