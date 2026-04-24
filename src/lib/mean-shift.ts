export type Point3 = [number, number, number];

export interface MeanShiftOptions {
  bandwidth: number;
  minBinFreq?: number;
  maxIter?: number;
  convergence?: number;
}

function dist(a: Point3, b: Point3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function estimateBandwidth(points: Point3[], quantile = 0.3): number {
  if (points.length < 2) return 1;
  const sample = points.length > 200 ? sampleN(points, 200) : points;
  const distances: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      distances.push(dist(sample[i], sample[j]));
    }
  }
  distances.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(distances.length - 1, Math.floor(distances.length * quantile)));
  return distances[idx];
}

function sampleN<T>(arr: T[], n: number): T[] {
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  return out;
}

export function meanShift(points: Point3[], opts: MeanShiftOptions): Point3[] {
  if (points.length === 0) return [];
  const bandwidth = opts.bandwidth;
  const minBinFreq = opts.minBinFreq ?? 1;
  const maxIter = opts.maxIter ?? 100;
  const convergence = opts.convergence ?? 1e-3;

  // Bin-seed
  const bins = new Map<string, Point3[]>();
  for (const p of points) {
    const key = `${Math.floor(p[0] / bandwidth)},${Math.floor(p[1] / bandwidth)},${Math.floor(p[2] / bandwidth)}`;
    let bucket = bins.get(key);
    if (!bucket) {
      bucket = [];
      bins.set(key, bucket);
    }
    bucket.push(p);
  }

  const seeds: Point3[] = [];
  for (const bucket of bins.values()) {
    if (bucket.length < minBinFreq) continue;
    const cx = bucket.reduce((s, p) => s + p[0], 0) / bucket.length;
    const cy = bucket.reduce((s, p) => s + p[1], 0) / bucket.length;
    const cz = bucket.reduce((s, p) => s + p[2], 0) / bucket.length;
    seeds.push([cx, cy, cz]);
  }
  if (seeds.length === 0) seeds.push(points[0]);

  const converged: Point3[] = [];
  for (let seed of seeds) {
    for (let iter = 0; iter < maxIter; iter++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const p of points) {
        if (dist(p, seed) < bandwidth) {
          sx += p[0]; sy += p[1]; sz += p[2]; n++;
        }
      }
      if (n === 0) break;
      const next: Point3 = [sx / n, sy / n, sz / n];
      if (dist(next, seed) < convergence) {
        seed = next;
        break;
      }
      seed = next;
    }
    converged.push(seed);
  }

  // Merge converged centers within bandwidth of each other
  const merged: Point3[] = [];
  for (const c of converged) {
    if (!merged.some((m) => dist(m, c) < bandwidth)) {
      merged.push(c);
    }
  }
  return merged;
}
