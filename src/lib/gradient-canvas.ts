import { normalizeHex } from "./color";

/**
 * Render a gradient as equal-width solid colour blocks — no blending.
 * Each element of `colors` gets its own block.  This matches the
 * "Axiom / Minecraft block" mental model: the colours you picked are
 * the blocks; arrange them in sequence without inventing new ones.
 */
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
  const n = colors.length;

  // Solid colour blocks — integer pixel boundaries to avoid sub-pixel gaps.
  for (let i = 0; i < n; i++) {
    const x0 = Math.round((i / n) * width);
    const x1 = Math.round(((i + 1) / n) * width);
    ctx.fillStyle = normalizeHex(colors[i]) ?? colors[i];
    ctx.fillRect(x0, 0, x1 - x0, stripHeight);
  }

  // Hex labels on a dark strip below each block.
  ctx.fillStyle = "#1b1f27";
  ctx.fillRect(0, stripHeight, width, labelHeight);
  ctx.fillStyle = "#e8ebf0";
  ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const cx = Math.round(((i + 0.5) / n) * width);
    ctx.fillText(
      normalizeHex(colors[i]) ?? colors[i],
      Math.max(40, Math.min(width - 40, cx)),
      stripHeight + labelHeight / 2,
    );
  }

  return canvas.toDataURL("image/png");
}
