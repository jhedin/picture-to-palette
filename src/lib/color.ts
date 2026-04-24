import Color from "colorjs.io";

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = HEX_RE.exec(value);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex.toUpperCase()}`;
}

export function hexToOklab(hex: string): Oklab {
  const c = new Color(hex).to("oklab");
  const [L, a, b] = c.coords;
  return { L, a, b };
}

export function hexToOklch(hex: string): Oklch {
  const c = new Color(hex).to("oklch");
  const [L, C, h] = c.coords;
  return { L, C, h: Number.isNaN(h) ? 0 : h };
}

export function oklabToHex(lab: Oklab): string {
  const c = new Color("oklab", [lab.L, lab.a, lab.b]).to("srgb");
  return normalizeHex(c.toString({ format: "hex" }))!;
}

export function deltaE00(hexA: string, hexB: string): number {
  const a = new Color(hexA);
  const b = new Color(hexB);
  return a.deltaE(b, "2000");
}
