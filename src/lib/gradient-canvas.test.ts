import { describe, it, expect } from "vitest";
import { renderGradientPng } from "./gradient-canvas";

describe("renderGradientPng", () => {
  it("returns a PNG data URL for a 2-color input", async () => {
    const url = await renderGradientPng(["#FF0000", "#0000FF"], 200, 80);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
  it("rejects empty color arrays", async () => {
    await expect(renderGradientPng([], 200, 80)).rejects.toThrow();
  });
  it("returns a PNG data URL for a single color", async () => {
    const url = await renderGradientPng(["#FF0000"], 100, 60);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
  it("handles many colors without throwing", async () => {
    const colors = ["#FF0000", "#FF8800", "#FFFF00", "#00FF00", "#0000FF", "#8800FF"];
    await expect(renderGradientPng(colors, 600, 80)).resolves.toMatch(/^data:image\/png/);
  });
});
