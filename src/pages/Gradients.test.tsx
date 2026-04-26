import { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PaletteProvider, usePalette } from "../lib/palette-store";
import Gradients from "./Gradients";

vi.mock("../lib/gradient-canvas", () => ({
  renderGradientPng: vi.fn(async () => "data:image/png;base64,FAKE"),
}));

function Seeder({
  hexes,
  anchors,
}: {
  hexes: string[];
  anchors?: [number, number];
}) {
  const { dispatch } = usePalette();
  useEffect(() => {
    for (const h of hexes) dispatch({ type: "ADD_COLOR", hex: h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { state } = usePalette();
  useEffect(() => {
    if (!anchors || state.colors.length < 2 || state.anchorA !== null) return;
    dispatch({ type: "TAP_SWATCH", id: state.colors[anchors[0]].id });
    dispatch({ type: "TAP_SWATCH", id: state.colors[anchors[1]].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.colors.length]);
  return null;
}

function renderGradients(hexes: string[], anchors?: [number, number], url = "/gradients") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PaletteProvider>
        <Seeder hexes={hexes} anchors={anchors} />
        <Gradients />
      </PaletteProvider>
    </MemoryRouter>,
  );
}

// A color is "in the sequence" when its shelf Add button is absent.
function inSequence(hex: string) {
  return !screen.queryByRole("button", { name: new RegExp(`add ${hex} to sequence`, "i") });
}

describe("Gradients page", () => {
  it("shows empty-state help when no colors exist", () => {
    render(
      <MemoryRouter>
        <PaletteProvider>
          <Gradients />
        </PaletteProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(/capture screen/i)).toBeInTheDocument();
  });

  it("auto-seeds all palette colors into the sequence", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    await waitFor(() => {
      expect(inSequence("#FF0000")).toBe(true);
      expect(inSequence("#00FF00")).toBe(true);
      expect(inSequence("#0000FF")).toBe(true);
    });
  });

  it("seeds using anchors when both are set", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 2]);
    await waitFor(() => {
      expect(inSequence("#FF0000")).toBe(true);
      expect(inSequence("#0000FF")).toBe(true);
    });
  });

  it("shelf is empty when all colors are in the sequence", async () => {
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() => expect(inSequence("#FF0000")).toBe(true));
    expect(screen.queryByRole("button", { name: /add #FF0000 to sequence/i })).not.toBeInTheDocument();
  });

  it("tapping a shelf color adds it to the sequence", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /add #FF0000 to sequence/i }));
    await waitFor(() => expect(inSequence("#FF0000")).toBe(true));
  });

  it("clear button empties the sequence and shows all colors on shelf", async () => {
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).toBeInTheDocument(),
    );
  });

  it("Save PNG is disabled with fewer than 2 sequence items", async () => {
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /save png/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /add #FF0000 to sequence/i }));
    await waitFor(() => expect(inSequence("#FF0000")).toBe(true));
    expect(screen.getByRole("button", { name: /save png/i })).toBeDisabled();
  });

  it("Save PNG is enabled with 2+ sequence items and calls renderGradientPng", async () => {
    const mod = await import("../lib/gradient-canvas");
    renderGradients(["#FF0000", "#0000FF"], [0, 1]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save png/i })).not.toBeDisabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: /save png/i }));
    await waitFor(() => expect(mod.renderGradientPng).toHaveBeenCalled());
  });

  it("does not enter DMC mode without ?mode=dmc", async () => {
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() => expect(inSequence("#FF0000")).toBe(true));
    expect(screen.queryByText(/available dmc threads/i)).not.toBeInTheDocument();
  });

  it("tapping a shelf color pins it (shows pinned in panel)", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    // Clear so there's a shelf
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).toBeInTheDocument(),
    );
    // Tap a shelf color to add+pin it
    await userEvent.click(screen.getByRole("button", { name: /add #FF0000 to sequence/i }));
    await waitFor(() => expect(inSequence("#FF0000")).toBe(true));
    // Click the seq item to open the panel
    // The seq item is no longer a button so find by title
    const seqItem = document.querySelector(`[title="#FF0000"]`) as HTMLElement;
    await userEvent.click(seqItem);
    await waitFor(() => expect(screen.getByRole("button", { name: /pinned/i })).toBeInTheDocument());
  });

  it("alternatives panel opens on sequence item click and closes on ×", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    // Click a seq item to open panel
    const seqItem = document.querySelector(`[title="#FF0000"]`) as HTMLElement
      ?? document.querySelector(`[title^="#"]`) as HTMLElement;
    await userEvent.click(seqItem);
    await waitFor(() => expect(screen.getByRole("button", { name: /close panel/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /close panel/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /close panel/i })).not.toBeInTheDocument());
  });

  it("slider min is clamped to pinned count", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).toBeInTheDocument(),
    );
    // Pin two colors via shelf taps
    await userEvent.click(screen.getByRole("button", { name: /add #FF0000 to sequence/i }));
    await userEvent.click(screen.getByRole("button", { name: /add #0000FF to sequence/i }));
    await waitFor(() => expect(inSequence("#0000FF")).toBe(true));
    const slider = screen.getByRole("slider");
    expect(Number(slider.getAttribute("min"))).toBe(2);
  });
});
