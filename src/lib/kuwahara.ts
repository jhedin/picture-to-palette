/**
 * Kuwahara edge-preserving texture filter.
 *
 * For each pixel, evaluates 4 overlapping (radius+1)×(radius+1) quadrants
 * centred on that pixel and assigns the mean colour of the sub-region with
 * the lowest internal variance.  Knitted nubs, yarn highlights, and
 * micro-shadows collapse into flat colour zones while object boundaries
 * stay sharp — which prevents SLIC from over-segmenting textures into
 * dozens of spurious colour variants before mean-shift clustering.
 *
 * Standard radius=2 gives 4 overlapping 3×3 sub-regions inside a 5×5
 * window, totalling 36 samples per pixel (with shared centre row/column).
 */
export function kuwaharaFilter(src: ImageData, radius = 2): ImageData {
  const W = src.width, H = src.height;
  const d = src.data;
  const out = new Uint8ClampedArray(d.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let bestR = 0, bestG = 0, bestB = 0, bestVar = Infinity;

      // Iterate over the 4 quadrant anchors: stride = radius so we get
      // exactly (-radius, 0) × (-radius, 0) → top-left, top-right,
      // bottom-left, bottom-right.
      for (let ay = -radius; ay <= 0; ay += radius) {
        for (let ax = -radius; ax <= 0; ax += radius) {
          let sR = 0, sG = 0, sB = 0;
          let sR2 = 0, sG2 = 0, sB2 = 0;
          let n = 0;

          for (let ky = ay; ky <= ay + radius; ky++) {
            const py = Math.max(0, Math.min(H - 1, y + ky));
            for (let kx = ax; kx <= ax + radius; kx++) {
              const px = Math.max(0, Math.min(W - 1, x + kx));
              const i = (py * W + px) * 4;
              const r = d[i], g = d[i + 1], b = d[i + 2];
              sR += r;  sG += g;  sB += b;
              sR2 += r * r; sG2 += g * g; sB2 += b * b;
              n++;
            }
          }

          const mr = sR / n, mg = sG / n, mb = sB / n;
          // Sum of per-channel variances as the scalar variance estimate.
          const v = (sR2 / n - mr * mr) + (sG2 / n - mg * mg) + (sB2 / n - mb * mb);
          if (v < bestVar) {
            bestVar = v;
            bestR = mr; bestG = mg; bestB = mb;
          }
        }
      }

      const oi = (y * W + x) * 4;
      out[oi]     = Math.round(bestR);
      out[oi + 1] = Math.round(bestG);
      out[oi + 2] = Math.round(bestB);
      out[oi + 3] = 255;
    }
  }

  return new ImageData(out, W, H);
}
