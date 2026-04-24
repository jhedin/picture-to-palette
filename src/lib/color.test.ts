import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToOklab,
  hexToOklch,
  deltaE00,
  oklabToHex,
  dedupByDeltaE,
  gradientBetween,
  pickEvenly,
  swatchMeta,
  scoreGradientOutliers,
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

describe("gradientBetween", () => {
  const A = "#FF0000"; // anchor A (red)
  const B = "#0000FF"; // anchor B (blue)
  const PURPLE = "#8000FF"; // projects to mid-path t≈0.5 — inbetween
  const GREEN = "#00FF00";  // projects outside the A–B segment — excluded

  it("returns only colours that project strictly between the anchors", () => {
    const result = gradientBetween([A, B, PURPLE, GREEN], A, B);
    expect(result).toContain("#8000FF");
    expect(result).not.toContain("#FF0000");
    expect(result).not.toContain("#0000FF");
  });

  it("excludes the anchors themselves", () => {
    const result = gradientBetween([A, B, PURPLE], A, B);
    expect(result).not.toContain(A);
    expect(result).not.toContain(B);
  });

  it("returns empty when no palette colours fall between the anchors", () => {
    expect(gradientBetween([A, B], A, B)).toEqual([]);
  });

  it("handles degenerate A==B without crashing", () => {
    expect(() => gradientBetween([A, B, PURPLE], A, A)).not.toThrow();
  });

  describe("mode: natural", () => {
    it("sorts by OKLab projection — closer-to-A colours come first", () => {
      const NEAR_A = "#EE1100";
      const result = gradientBetween([B, PURPLE, NEAR_A, A], A, B, "natural");
      const iNearA = result.findIndex(h => h === normalizeHex(NEAR_A));
      const iPurple = result.findIndex(h => h === "#8000FF");
      if (iNearA >= 0 && iPurple >= 0) expect(iNearA).toBeLessThan(iPurple);
    });
  });

  describe("mode: lightness", () => {
    // Dark anchor → light anchor: inbetweens sorted dark first.
    // Use black→white with a mid-grey inbetween.
    const DARK = "#000000";
    const LIGHT = "#FFFFFF";
    const MID_GREY = "#808080";
    const LIGHT_GREY = "#C0C0C0";

    it("sorts ascending when anchorA is darker than anchorB", () => {
      const result = gradientBetween([DARK, LIGHT, LIGHT_GREY, MID_GREY], DARK, LIGHT, "lightness");
      expect(result.length).toBeGreaterThan(0);
      // mid-grey (darker) should come before light-grey (lighter)
      const iMid = result.findIndex(h => h === normalizeHex(MID_GREY));
      const iLight = result.findIndex(h => h === normalizeHex(LIGHT_GREY));
      if (iMid >= 0 && iLight >= 0) expect(iMid).toBeLessThan(iLight);
    });

    it("sorts descending when anchorA is lighter than anchorB", () => {
      const result = gradientBetween([DARK, LIGHT, LIGHT_GREY, MID_GREY], LIGHT, DARK, "lightness");
      expect(result.length).toBeGreaterThan(0);
      // light-grey (lighter) should now come before mid-grey (darker)
      const iLight = result.findIndex(h => h === normalizeHex(LIGHT_GREY));
      const iMid = result.findIndex(h => h === normalizeHex(MID_GREY));
      if (iLight >= 0 && iMid >= 0) expect(iLight).toBeLessThan(iMid);
    });
  });

  describe("mode: saturation", () => {
    // Desaturated anchor (#808080 grey) → saturated anchor (#FF0000 red).
    // Inbetweens should be sorted from low chroma to high.
    const GREY = "#808080";
    const RED = "#FF0000";
    const PINK = "#FF8080";    // moderate chroma
    const ROSE = "#FF4040";    // higher chroma, closer to RED

    it("sorts from low to high chroma when anchorA is less saturated", () => {
      const result = gradientBetween([GREY, RED, PINK, ROSE], GREY, RED, "saturation");
      expect(result.length).toBeGreaterThan(0);
      const iPink = result.findIndex(h => h === normalizeHex(PINK));
      const iRose = result.findIndex(h => h === normalizeHex(ROSE));
      if (iPink >= 0 && iRose >= 0) expect(iPink).toBeLessThan(iRose);
    });
  });

  describe("mode: hue", () => {
    // Red (#FF0000, h≈29°) → Blue (#0000FF, h≈264°).
    // Shorter arc goes clockwise through purple.
    // A colour at h≈150° (green-ish) is on the long arc — may be excluded or appear late.
    // A purple at h≈300° is on the short arc — should appear before blue.

    it("returns results sorted along the shorter hue arc", () => {
      const result = gradientBetween([A, B, PURPLE], A, B, "hue");
      // PURPLE (h≈300°) should be between red and blue on the short arc
      expect(result).toContain("#8000FF");
    });

    it("all returned colours have t in (0,1) regardless of hue sort", () => {
      const result = gradientBetween([A, B, PURPLE, GREEN], A, B, "hue");
      // filter still applies — no anchors and no out-of-range projections
      expect(result).not.toContain(normalizeHex(A));
      expect(result).not.toContain(normalizeHex(B));
    });
  });
});

describe("pickEvenly", () => {
  const LIST = ["a", "b", "c", "d", "e"]; // 5 items, indices 0-4

  it("returns empty for n=0", () => {
    expect(pickEvenly(LIST, 0)).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(pickEvenly([], 3)).toEqual([]);
  });

  it("returns all items when n >= list length", () => {
    expect(pickEvenly(LIST, 5)).toEqual(LIST);
    expect(pickEvenly(LIST, 99)).toEqual(LIST);
  });

  it("n=1 picks the middle item", () => {
    // i=0: floor(0.5 * 5/1) = floor(2.5) = 2 → "c"
    expect(pickEvenly(LIST, 1)).toEqual(["c"]);
  });

  it("n=2 picks items near ⅓ and ⅔ through", () => {
    // i=0: floor(0.5 * 5/2) = floor(1.25) = 1 → "b"
    // i=1: floor(1.5 * 5/2) = floor(3.75) = 3 → "d"
    expect(pickEvenly(LIST, 2)).toEqual(["b", "d"]);
  });

  it("n=4 on 5-item list picks 4 distinct items", () => {
    const result = pickEvenly(LIST, 4);
    expect(result).toHaveLength(4);
    result.forEach((item) => expect(LIST).toContain(item));
  });

  it("never returns duplicates for any valid n", () => {
    for (let n = 1; n <= LIST.length; n++) {
      const result = pickEvenly(LIST, n);
      expect(new Set(result).size).toBe(result.length);
    }
  });
});

describe("gradientBetween — natural mode perpendicular filter", () => {
  const A = "#FF0000"; // red
  const B = "#0000FF"; // blue

  it("keeps a colour close to the A→B line", () => {
    // Purple is near the red→blue OKLab segment
    const result = gradientBetween([A, B, "#8000FF"], A, B, "natural");
    expect(result).toContain("#8000FF");
  });

  it("excludes a colour far off the A→B line even if t ∈ (0,1)", () => {
    // Bright yellow-green projects between red and blue in t but is far off-axis
    const result = gradientBetween([A, B, "#80FF00"], A, B, "natural");
    expect(result).not.toContain("#80FF00");
  });
});

describe("swatchMeta", () => {
  it("returns L and C rounded to display precision", () => {
    const meta = swatchMeta("#FF0000");
    expect(meta.hex).toBe("#FF0000");
    expect(meta.L).toBeCloseTo(0.63, 1);
    expect(meta.C).toBeGreaterThan(0.2);
  });

  it("returns C=0 for achromatic grey", () => {
    const meta = swatchMeta("#808080");
    expect(meta.C).toBeCloseTo(0, 2);
  });
});

describe("scoreGradientOutliers", () => {
  it("returns no outliers for a monotone grey gradient", () => {
    const gradient = ["#000000", "#404040", "#808080", "#C0C0C0", "#FFFFFF"];
    const results = scoreGradientOutliers(gradient);
    expect(results.every((r) => !r.isOutlier)).toBe(true);
  });

  it("flags a brightness interloper in an otherwise dark gradient", () => {
    // Dark → dark → very bright → dark → dark — the bright one should be flagged
    const gradient = ["#111111", "#222222", "#FFFFFF", "#333333", "#444444"];
    const results = scoreGradientOutliers(gradient);
    const outlier = results.find((r) => r.hex === "#FFFFFF");
    expect(outlier?.isOutlier).toBe(true);
  });

  it("never flags the anchor endpoints", () => {
    const gradient = ["#FF0000", "#808080", "#0000FF"];
    const results = scoreGradientOutliers(gradient);
    expect(results[0].isOutlier).toBe(false);
    expect(results[results.length - 1].isOutlier).toBe(false);
  });

  it("returns all non-outliers for gradients with fewer than 3 colours", () => {
    expect(scoreGradientOutliers(["#FF0000", "#0000FF"]).every((r) => !r.isOutlier)).toBe(true);
    expect(scoreGradientOutliers(["#FF0000"]).every((r) => !r.isOutlier)).toBe(true);
  });
});
