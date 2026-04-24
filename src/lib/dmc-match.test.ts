import { describe, it, expect } from "vitest";
import { nearestDmc, matchToDmc, expandDmcPalette } from "./dmc-match";
import { hexToOklch } from "./color";

describe("nearestDmc", () => {
  it("returns a valid DmcColor with id, name, and hex", () => {
    const result = nearestDmc("#FF0000");
    expect(result.id).toBeTruthy();
    expect(result.name).toBeTruthy();
    expect(result.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("maps a pure red to a red-family DMC thread", () => {
    const result = nearestDmc("#CC0000");
    const { h } = hexToOklch(result.hex);
    // Red hue in OKLCH is roughly 5–40°
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(50);
  });

  it("maps a pure blue to a blue-family DMC thread", () => {
    const result = nearestDmc("#0000CC");
    const { h } = hexToOklch(result.hex);
    // Blue hue in OKLCH is roughly 220–280°
    expect(h).toBeGreaterThan(200);
    expect(h).toBeLessThan(300);
  });

  it("maps near-white to a light DMC thread (L > 0.85)", () => {
    const result = nearestDmc("#F8F8F8");
    expect(hexToOklch(result.hex).L).toBeGreaterThan(0.85);
  });

  it("maps near-black to a dark DMC thread (L < 0.25)", () => {
    const result = nearestDmc("#111111");
    expect(hexToOklch(result.hex).L).toBeLessThan(0.25);
  });

  it("exact DMC hex maps back to that DMC color", () => {
    // DMC 321 Red — if the input is already a DMC color, it should match itself
    const result = nearestDmc("#C72B3B");
    expect(result.id).toBe("321");
  });
});

describe("matchToDmc", () => {
  it("returns one DMC color per unique match", () => {
    const result = matchToDmc(["#FF0000", "#0000FF", "#00FF00"]);
    expect(result.length).toBeGreaterThanOrEqual(2); // at least 2 distinct matches
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("deduplicates: two very similar inputs map to the same DMC thread", () => {
    // Two near-identical reds should both hit the same DMC thread
    const result = matchToDmc(["#FF0000", "#FF0001"]);
    expect(result).toHaveLength(1);
  });

  it("preserves order of first occurrence", () => {
    const result = matchToDmc(["#CC0000", "#0000CC"]);
    const firstHue = hexToOklch(result[0].hex).h;
    const secondHue = hexToOklch(result[1].hex).h;
    // First should be red-ish, second blue-ish
    expect(firstHue).toBeLessThan(secondHue);
  });

  it("returns empty array for empty input", () => {
    expect(matchToDmc([])).toEqual([]);
  });
});

describe("expandDmcPalette", () => {
  it("returns at least as many colors as the input", () => {
    const base = [{ id: "321", name: "Red", hex: "#C72B3B" }];
    const result = expandDmcPalette(base, 1);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("includes all input colors in the output", () => {
    const base = [
      { id: "321", name: "Red", hex: "#C72B3B" },
      { id: "820", name: "Royal Blue Very Dark", hex: "#1B3080" },
    ];
    const result = expandDmcPalette(base, 1);
    for (const b of base) {
      expect(result.some((r) => r.id === b.id)).toBe(true);
    }
  });

  it("produces no duplicate DMC ids", () => {
    const base = [{ id: "321", name: "Red", hex: "#C72B3B" }];
    const result = expandDmcPalette(base, 2);
    const ids = result.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
