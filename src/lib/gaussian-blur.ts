/**
 * Separable 2D Gaussian blur on RGBA ImageData (operates on all channels).
 * Uses a truncated kernel at radius = ceil(3 * sigma).
 */
export function gaussianBlur(img: ImageData, sigma: number): ImageData {
  if (sigma <= 0) return img;
  const W = img.width, H = img.height;
  const radius = Math.ceil(3 * sigma);
  const size = 2 * radius + 1;

  // Build 1D kernel
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const src = img.data;
  const tmp = new Float32Array(W * H * 4);
  const out = new Uint8ClampedArray(W * H * 4);

  // Horizontal pass: src → tmp
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < size; k++) {
        const sx = Math.min(W - 1, Math.max(0, x + k - radius));
        const idx = (y * W + sx) * 4;
        const w = kernel[k];
        r += src[idx]     * w;
        g += src[idx + 1] * w;
        b += src[idx + 2] * w;
        a += src[idx + 3] * w;
      }
      const di = (y * W + x) * 4;
      tmp[di] = r; tmp[di + 1] = g; tmp[di + 2] = b; tmp[di + 3] = a;
    }
  }

  // Vertical pass: tmp → out
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < size; k++) {
        const sy = Math.min(H - 1, Math.max(0, y + k - radius));
        const idx = (sy * W + x) * 4;
        const w = kernel[k];
        r += tmp[idx]     * w;
        g += tmp[idx + 1] * w;
        b += tmp[idx + 2] * w;
        a += tmp[idx + 3] * w;
      }
      const di = (y * W + x) * 4;
      out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
    }
  }

  return new ImageData(out, W, H);
}
