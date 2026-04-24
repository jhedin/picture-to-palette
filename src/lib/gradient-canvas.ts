import Color from "colorjs.io";
import { normalizeHex } from "./color";

export function sampleGradientStop(colors: string[], t: number): string {
  if (colors.length === 0) throw new Error("empty colors");
  if (colors.length === 1) return normalizeHex(colors[0])!;
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped === 0) return normalizeHex(colors[0])!;
  if (clamped === 1) return normalizeHex(colors[colors.length - 1])!;
  const segCount = colors.length - 1;
  const scaled = clamped * segCount;
  const segIdx = Math.min(segCount - 1, Math.floor(scaled));
  const localT = scaled - segIdx;
  const a = new Color(colors[segIdx]).to("oklab");
  const b = new Color(colors[segIdx + 1]).to("oklab");
  const mixed = a.mix(b, localT, { space: "oklab" });
  return normalizeHex(mixed.to("srgb").toString({ format: "hex" }))!;
}

export async function renderGradientPng(
  colors: string[],
  width: number,
  height: number,
): Promise<string> {
  if (colors.length === 0) throw new Error("renderGradientPng: empty colors");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");

  const labelHeight = 28;
  const stripHeight = height - labelHeight;

  // Per-pixel OKLab interpolation.
  const imageData = ctx.createImageData(width, stripHeight);
  for (let x = 0; x < width; x++) {
    const t = width === 1 ? 0 : x / (width - 1);
    const hex = sampleGradientStop(colors, t);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let y = 0; y < stripHeight; y++) {
      const idx = (y * width + x) * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Hex labels under each stop.
  ctx.fillStyle = "#1b1f27";
  ctx.fillRect(0, stripHeight, width, labelHeight);
  ctx.fillStyle = "#e8ebf0";
  ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < colors.length; i++) {
    const x = colors.length === 1 ? width / 2 : (i / (colors.length - 1)) * width;
    const clampedX = Math.max(40, Math.min(width - 40, x));
    ctx.fillText(normalizeHex(colors[i]) ?? colors[i], clampedX, stripHeight + labelHeight / 2);
  }

  return canvas.toDataURL("image/png");
}
