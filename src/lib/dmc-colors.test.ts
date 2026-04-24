import { describe, it, expect } from "vitest";
import { DMC_COLORS, type DmcColor } from "./dmc-colors";

describe("DMC_COLORS dataset", () => {
  it("has at least 400 entries", () => {
    expect(DMC_COLORS.length).toBeGreaterThanOrEqual(400);
  });

  it("every entry has a valid uppercase #RRGGBB hex", () => {
    const hexPattern = /^#[0-9A-F]{6}$/;
    for (const color of DMC_COLORS) {
      expect(
        hexPattern.test(color.hex),
        `DMC ${color.id} hex "${color.hex}" is not valid #RRGGBB`
      ).toBe(true);
    }
  });

  it("every entry has a non-empty id and name", () => {
    for (const color of DMC_COLORS) {
      expect(color.id.trim().length, `id is empty for entry: ${JSON.stringify(color)}`).toBeGreaterThan(0);
      expect(color.name.trim().length, `name is empty for DMC ${color.id}`).toBeGreaterThan(0);
    }
  });

  it("DMC 321 exists and is in a red hue range", () => {
    const dmc321 = DMC_COLORS.find((c: DmcColor) => c.id === "321");
    expect(dmc321).toBeDefined();

    // Parse hex to RGB
    const hex = dmc321!.hex; // e.g. "#C72B3B"
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    // Red hue: R channel dominates, not primarily green or blue
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);

    // R channel should be meaningfully high (at least 150 out of 255)
    expect(r).toBeGreaterThanOrEqual(150);
  });
});
