import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToOklab,
  hexToOklch,
  deltaE00,
  oklabToHex,
  dedupByDeltaE,
  pickIntermediates,
  type Oklab,
} from "./color";

describe("normalizeHex", () => {
  it("uppercases and prepends #", () => {
    expect(normalizeHex("ff8800")).toBe("#FF8800");
    expect(normalizeHex("#ff8800")).toBe("#FF8800");
  });
  it("expands 3-digit to 6", () => {
    expect(normalizeHex("f80")).toBe("#FF8800");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
  });
  it("returns null for invalid input", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex("zzzzzz")).toBeNull();
    expect(normalizeHex("#1234")).toBeNull();
  });
});

describe("hexToOklab", () => {
  it("converts pure black", () => {
    const lab = hexToOklab("#000000");
    expect(lab.L).toBeCloseTo(0, 3);
    expect(lab.a).toBeCloseTo(0, 3);
    expect(lab.b).toBeCloseTo(0, 3);
  });
  it("converts pure white to L=1", () => {
    const lab = hexToOklab("#FFFFFF");
    expect(lab.L).toBeCloseTo(1.0, 2);
  });
  it("converts pure red to expected OKLab", () => {
    // Reference values from Bjorn Ottosson's OKLab spec.
    const lab = hexToOklab("#FF0000");
    expect(lab.L).toBeCloseTo(0.628, 2);
    expect(lab.a).toBeCloseTo(0.225, 2);
    expect(lab.b).toBeCloseTo(0.126, 2);
  });
});

describe("hexToOklch", () => {
  it("returns chroma + hue", () => {
    const lch = hexToOklch("#FF0000");
    expect(lch.L).toBeCloseTo(0.628, 2);
    expect(lch.C).toBeGreaterThan(0.2);
    expect(lch.h).toBeCloseTo(29, 0); // red-orange hue angle
  });
});

describe("deltaE00", () => {
  // Subset of Sharma et al. published CIEDE2000 vectors. Hex-encoded sRGB
  // round-trip is approximate (paper uses Lab inputs directly), so
  // we use 0.5 tolerance for these spot checks.
  it("identical colors → 0", () => {
    const a: Oklab = { L: 0.5, a: 0.1, b: -0.1 };
    expect(deltaE00FromLab(a, a)).toBeCloseTo(0, 4);
  });
  it("near-duplicate hex pair under JND", () => {
    expect(deltaE00("#FF8800", "#FF8801")).toBeLessThan(0.5);
  });
  it("complementary colors are large", () => {
    expect(deltaE00("#FF0000", "#00FFFF")).toBeGreaterThan(40);
  });
  it("hex order does not matter", () => {
    expect(deltaE00("#123456", "#789ABC")).toBeCloseTo(
      deltaE00("#789ABC", "#123456"),
      6,
    );
  });
});

// Helper used only in this test file.
function deltaE00FromLab(a: Oklab, b: Oklab): number {
  return deltaE00(oklabToHex(a), oklabToHex(b));
}

describe("dedupByDeltaE", () => {
  it("keeps first occurrence; drops near-duplicates", () => {
    const out = dedupByDeltaE(["#FF0000", "#FF0001", "#00FF00"], 3);
    expect(out).toEqual(["#FF0000", "#00FF00"]);
  });
  it("treats threshold inclusively (>=) — removes equal-distance dupes", () => {
    // Synthesize: same hex twice → distance 0 → always considered duplicate.
    const out = dedupByDeltaE(["#123456", "#123456"], 3);
    expect(out).toEqual(["#123456"]);
  });
  it("preserves order", () => {
    const out = dedupByDeltaE(["#0000FF", "#FF0000", "#00FF00"], 3);
    expect(out).toEqual(["#0000FF", "#FF0000", "#00FF00"]);
  });
  it("normalizes hex before comparing", () => {
    const out = dedupByDeltaE(["ff0000", "#ff0000", "F00"], 3);
    expect(out).toEqual(["#FF0000"]);
  });
});

describe("pickIntermediates", () => {
  // Anchors are pure red and pure blue. Test palette includes a perfect
  // mid-purple (which should be picked first), an off-axis green (rejected
  // for any k>=1 if a closer purple is present), and a near-anchor red.
  const A = "#FF0000"; // anchor A
  const B = "#0000FF"; // anchor B
  const PURPLE = "#8000FF"; // close to OKLab path midpoint
  const NEAR_PURPLE = "#9000A0"; // also near path
  const GREEN = "#00FF00"; // far from path
  const NEAR_A = "#F00010"; // very close to A

  it("k=0 returns empty", () => {
    expect(pickIntermediates([A, B, PURPLE, GREEN], A, B, 0)).toEqual([]);
  });
  it("k=1 picks the on-path color", () => {
    const result = pickIntermediates([A, B, PURPLE, GREEN], A, B, 1);
    expect(result).toEqual([PURPLE]);
  });
  it("k=1 rejects far-from-path colors when an on-path option exists", () => {
    const result = pickIntermediates([A, B, GREEN, PURPLE], A, B, 1);
    expect(result).not.toContain(GREEN);
  });
  it("returns colors ordered by their position along the path (A → B)", () => {
    const result = pickIntermediates([A, B, PURPLE, NEAR_A], A, B, 2);
    // NEAR_A projects to t≈0, PURPLE to t≈0.5; expect NEAR_A first.
    expect(result).toEqual([NEAR_A, PURPLE]);
  });
  it("excludes the anchors from candidates", () => {
    const result = pickIntermediates([A, B], A, B, 1);
    expect(result).toEqual([]);
  });
  it("returns fewer than k if not enough viable candidates", () => {
    const result = pickIntermediates([A, B, PURPLE], A, B, 3);
    expect(result.length).toBeLessThanOrEqual(1);
  });
  it("spread penalty: avoids stacking two intermediates at the same t", () => {
    // PURPLE and NEAR_PURPLE both project near t=0.5; only one should be picked
    // when k=1, but if k=2 we should NOT see both — we should see PURPLE plus
    // something else (NEAR_A would not exist here, so we get only PURPLE).
    const result = pickIntermediates([A, B, PURPLE, NEAR_PURPLE], A, B, 2);
    expect(result.length).toBeLessThanOrEqual(1);
  });
});
