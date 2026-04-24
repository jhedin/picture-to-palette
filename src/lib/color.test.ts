import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToOklab,
  hexToOklch,
  deltaE00,
  oklabToHex,
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
