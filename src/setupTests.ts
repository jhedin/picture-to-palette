import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom canvas polyfill: provide a minimal 2D context and toDataURL stub.
// The native `canvas` npm package requires compilation and may not be
// available, so we mock just enough for unit tests.
{
  const OriginalCreateElement = document.createElement.bind(document);
  (document as unknown as { createElement: typeof document.createElement }).createElement =
    (tag: string, opts?: unknown) => {
      const el = OriginalCreateElement(tag, opts as ElementCreationOptions);
      if (tag.toLowerCase() === "canvas") {
        const ctx = {
          createImageData(w: number, h: number): ImageData {
            return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
          },
          putImageData() {},
          getImageData(_x: number, _y: number, w: number, h: number): ImageData {
            return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
          },
          drawImage() {},
          fillRect() {},
          fillText() {},
          get fillStyle() { return ""; },
          set fillStyle(_v: unknown) {},
          get font() { return ""; },
          set font(_v: unknown) {},
          get textAlign() { return ""; },
          set textAlign(_v: unknown) {},
          get textBaseline() { return ""; },
          set textBaseline(_v: unknown) {},
        };
        (el as HTMLCanvasElement).getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
        (el as HTMLCanvasElement).toDataURL = () =>
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      }
      return el;
    };
}

// jsdom doesn't provide createImageBitmap; provide a stub.
if (typeof globalThis.createImageBitmap === "undefined") {
  globalThis.createImageBitmap = async (_source: unknown) =>
    ({ width: 1, height: 1, close: () => {} }) as ImageBitmap;
}

// jsdom doesn't provide URL.createObjectURL / revokeObjectURL.
if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = (_blob: Blob) => "blob:mock-url";
  URL.revokeObjectURL = (_url: string) => {};
}

// jsdom doesn't ship ImageData; provide a minimal polyfill for canvas tests.
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: PredefinedColorSpace = "srgb";
    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      width: number,
      height?: number,
    ) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth;
        this.height = width;
        this.data = new Uint8ClampedArray(dataOrWidth * width * 4);
      } else {
        this.data = dataOrWidth;
        this.width = width;
        this.height = height ?? dataOrWidth.length / 4 / width;
      }
    }
  }
  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}
