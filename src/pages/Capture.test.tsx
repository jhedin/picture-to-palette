import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PaletteProvider } from "../lib/palette-store";
import Capture from "./Capture";

vi.mock("../lib/mean-shift.worker", () => ({
  DEFAULT_OPTIONS: { segmentSize: 1500, segBandwidthCap: 0.10, mergeBandwidth: 0.08 },
  suggestCrop: vi.fn(() => ({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })),
  extractPalette: vi.fn(() => ({
    hexes: ["#FF0000", "#00FF00", "#0000FF"],
    debug: {
      segPixels: new Uint8ClampedArray(4),
      segWidth: 1,
      segHeight: 1,
      clusterSizes: [100, 100, 100],
      bandwidth: 0.08,
    },
  })),
}));

function renderCapture() {
  return render(
    <MemoryRouter>
      <PaletteProvider>
        <Capture />
      </PaletteProvider>
    </MemoryRouter>,
  );
}

describe("Capture page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the take/upload button when no photo loaded", () => {
    renderCapture();
    expect(screen.getByRole("button", { name: /take.*photo|upload/i })).toBeInTheDocument();
  });

  it("renders chips after extraction returns", async () => {
    renderCapture();
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { await userEvent.upload(input, file); });
    // After upload, the crop UI appears — confirm extraction.
    await waitFor(() => screen.getByRole("button", { name: /extract colors/i }));
    await userEvent.click(screen.getByRole("button", { name: /extract colors/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /add color #/i }).length).toBe(3);
    });
  });

  it("Accept all adds all unaccepted chips and disables them", async () => {
    renderCapture();
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { await userEvent.upload(input, file); });
    await waitFor(() => screen.getByRole("button", { name: /extract colors/i }));
    await userEvent.click(screen.getByRole("button", { name: /extract colors/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /add color #/i }).length).toBe(3),
    );
    await userEvent.click(screen.getByRole("button", { name: /accept all/i }));
    expect(screen.queryAllByRole("button", { name: /add color #/i }).length).toBe(0);
  });
});
