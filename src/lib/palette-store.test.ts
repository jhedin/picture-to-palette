import { describe, it, expect } from "vitest";
import { paletteReducer, initialPaletteState, type PaletteState } from "./palette-store";

const empty = initialPaletteState();

describe("paletteReducer · ADD_COLOR", () => {
  it("adds a new color with a stable id", () => {
    const s = paletteReducer(empty, { type: "ADD_COLOR", hex: "#FF0000" });
    expect(s.colors.length).toBe(1);
    expect(s.colors[0].hex).toBe("#FF0000");
    expect(typeof s.colors[0].id).toBe("string");
  });
  it("dedupes near-duplicates by ΔE₀₀ < 3", () => {
    let s = paletteReducer(empty, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#FF0001" });
    expect(s.colors.length).toBe(1);
  });
  it("normalizes hex on input", () => {
    const s = paletteReducer(empty, { type: "ADD_COLOR", hex: "f00" });
    expect(s.colors[0].hex).toBe("#FF0000");
  });
  it("ignores invalid hex silently", () => {
    const s = paletteReducer(empty, { type: "ADD_COLOR", hex: "garbage" });
    expect(s.colors.length).toBe(0);
  });
});

describe("paletteReducer · TAP_SWATCH (anchor state machine)", () => {
  function withColors(hexes: string[]): PaletteState {
    return hexes.reduce(
      (s, hex) => paletteReducer(s, { type: "ADD_COLOR", hex }),
      empty,
    );
  }

  it("State 0 → State 1 (A only): tap any → A=id", () => {
    const s = withColors(["#FF0000", "#00FF00"]);
    const id1 = s.colors[0].id;
    const next = paletteReducer(s, { type: "TAP_SWATCH", id: id1 });
    expect(next.anchorA).toBe(id1);
    expect(next.anchorB).toBeNull();
  });

  it("State 1 (A only): tap A → State 0 (A cleared)", () => {
    let s = withColors(["#FF0000"]);
    const id = s.colors[0].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id });
    s = paletteReducer(s, { type: "TAP_SWATCH", id });
    expect(s.anchorA).toBeNull();
    expect(s.anchorB).toBeNull();
  });

  it("State 1 (A only): tap a different swatch → State 2 (B set)", () => {
    let s = withColors(["#FF0000", "#00FF00"]);
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    expect(s.anchorA).toBe(idA);
    expect(s.anchorB).toBe(idB);
  });

  it("State 2: tap A → A cleared, B stays B (so State 1 with B only)", () => {
    let s = withColors(["#FF0000", "#00FF00"]);
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    expect(s.anchorA).toBeNull();
    expect(s.anchorB).toBe(idB);
  });

  it("State 2: tap B → B cleared, A stays", () => {
    let s = withColors(["#FF0000", "#00FF00"]);
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    expect(s.anchorA).toBe(idA);
    expect(s.anchorB).toBeNull();
  });

  it("State 2: tap a third swatch → A drops, B promotes to A, third becomes B", () => {
    let s = withColors(["#FF0000", "#00FF00", "#0000FF"]);
    const [a, b, c] = s.colors.map((x) => x.id);
    s = paletteReducer(s, { type: "TAP_SWATCH", id: a });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: b });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: c });
    expect(s.anchorA).toBe(b);
    expect(s.anchorB).toBe(c);
  });
});

describe("paletteReducer · REMOVE_COLOR", () => {
  it("removes the color and clears anchors that pointed at it", () => {
    let s: PaletteState = empty;
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#00FF00" });
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    s = paletteReducer(s, { type: "REMOVE_COLOR", id: idA });
    expect(s.colors.length).toBe(1);
    expect(s.colors[0].id).toBe(idB);
    expect(s.anchorA).toBeNull();
    expect(s.anchorB).toBe(idB);
  });

  it("preserves dmcSet when removing a palette color", () => {
    let s: PaletteState = empty;
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "SET_DMC_SET", colors: [{ id: "321", name: "Red", hex: "#C72B3B" }] });
    const id = s.colors[0].id;
    s = paletteReducer(s, { type: "REMOVE_COLOR", id });
    expect(s.dmcSet).toHaveLength(1);
    expect(s.dmcSet[0].id).toBe("321");
  });
});

describe("paletteReducer · DMC actions", () => {
  it("SET_DMC_SET replaces the entire set", () => {
    let s = paletteReducer(empty, { type: "SET_DMC_SET", colors: [{ id: "321", name: "Red", hex: "#C72B3B" }] });
    expect(s.dmcSet).toHaveLength(1);
    s = paletteReducer(s, { type: "SET_DMC_SET", colors: [] });
    expect(s.dmcSet).toHaveLength(0);
  });

  it("ADD_DMC appends and deduplicates by id", () => {
    let s = paletteReducer(empty, { type: "ADD_DMC", color: { id: "321", name: "Red", hex: "#C72B3B" } });
    expect(s.dmcSet).toHaveLength(1);
    s = paletteReducer(s, { type: "ADD_DMC", color: { id: "321", name: "Red", hex: "#C72B3B" } });
    expect(s.dmcSet).toHaveLength(1); // deduplicated
  });

  it("REMOVE_DMC removes by id and preserves other state", () => {
    let s = paletteReducer(empty, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "SET_DMC_SET", colors: [
      { id: "321", name: "Red", hex: "#C72B3B" },
      { id: "666", name: "Bright Red", hex: "#E31D42" },
    ]});
    s = paletteReducer(s, { type: "REMOVE_DMC", id: "321" });
    expect(s.dmcSet).toHaveLength(1);
    expect(s.dmcSet[0].id).toBe("666");
    expect(s.colors).toHaveLength(1); // palette unaffected
  });

  it("RESET clears dmcSet", () => {
    let s = paletteReducer(empty, { type: "SET_DMC_SET", colors: [{ id: "321", name: "Red", hex: "#C72B3B" }] });
    s = paletteReducer(s, { type: "RESET" });
    expect(s.dmcSet).toHaveLength(0);
  });
});

describe("paletteReducer · RESET", () => {
  it("returns to initial state", () => {
    let s: PaletteState = empty;
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "RESET" });
    expect(s).toEqual(initialPaletteState());
  });
});
