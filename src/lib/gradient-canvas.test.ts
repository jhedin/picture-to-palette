import { describe, it, expect } from "vitest";
import { renderGradientPng, sampleGradientStop } from "./gradient-canvas";

describe("sampleGradientStop", () => {
  it("returns the first color at t=0", () => {
    const colors = ["#FF0000", "#00FF00", "#0000FF"];
    expect(sampleGradientStop(colors, 0)).toBe("#FF0000");
  });
  it("returns the last color at t=1", () => {
    const colors = ["#FF0000", "#00FF00", "#0000FF"];
    expect(sampleGradientStop(colors, 1)).toBe("#0000FF");
  });
  it("interpolates in OKLab between two colors at t=0.5", () => {
    const mid = sampleGradientStop(["#000000", "#FFFFFF"], 0.5);
    // OKLab midpoint of black and white is roughly 50% lightness gray.
    // Allow wide tolerance because OKLab L is perceptual, not linear-RGB.
    expect(mid).toMatch(/^#[0-9A-F]{6}$/);
    const r = parseInt(mid.slice(1, 3), 16);
    expect(r).toBeGreaterThanOrEqual(90); // OKLab L=0.5 ≈ sRGB ~39%
    expect(r).toBeLessThan(200);
  });
});

describe("renderGradientPng", () => {
  it("returns a PNG data URL for a 2-color input", async () => {
    const url = await renderGradientPng(["#FF0000", "#0000FF"], 200, 80);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
  it("rejects empty color arrays", async () => {
    await expect(renderGradientPng([], 200, 80)).rejects.toThrow();
  });
});
