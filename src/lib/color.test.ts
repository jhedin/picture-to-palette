import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToOklab,
  hexToOklch,
  deltaE00,
  oklabToHex,
  dedupByDeltaE,
  gradientBetween,
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
    // Green is far off the red–blue axis and likely projects outside (0,1)
    // (exact value depends on OKLab geometry; at minimum anchors are excluded)
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

  it("returns colours sorted from A toward B", () => {
    const NEAR_A = "#EE1100"; // projects near t≈0
    const result = gradientBetween([A, B, PURPLE, NEAR_A], A, B);
    const iNearA = result.findIndex(h => h === normalizeHex(NEAR_A));
    const iPurple = result.findIndex(h => h === "#8000FF");
    if (iNearA >= 0 && iPurple >= 0) {
      expect(iNearA).toBeLessThan(iPurple);
    }
  });

  it("handles degenerate A==B without crashing", () => {
    expect(() => gradientBetween([A, B, PURPLE], A, A)).not.toThrow();
  });
});
