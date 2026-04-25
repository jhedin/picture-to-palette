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

// Seeds the palette store via effects so state settles before Gradients' effects run.
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

function renderGradients(hexes: string[], anchors?: [number, number]) {
  return render(
    <MemoryRouter>
      <PaletteProvider>
        <Seeder hexes={hexes} anchors={anchors} />
        <Gradients />
      </PaletteProvider>
    </MemoryRouter>,
  );
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

  it("shows the palette shelf when colors exist", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).toBeInTheDocument();
    });
  });

  it("tapping a shelf color adds it to the sequence", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    // Auto-seeded: all 3 colors are in the sequence; clear first to get a clean slate.
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /add #FF0000 to sequence/i }));
    expect(screen.getByRole("button", { name: /remove #FF0000 from sequence/i })).toBeInTheDocument();
  });

  it("pre-populates sequence from anchorA and anchorB", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 2]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /remove #FF0000 from sequence/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /remove #0000FF from sequence/i })).toBeInTheDocument();
    });
  });

  it("+ button appears between two sequence items and shows candidates", async () => {
    // Red → purple → blue: purple is between in natural mode
    renderGradients(["#FF0000", "#8000FF", "#0000FF"], [0, 2]);
    await waitFor(() => screen.getByRole("button", { name: /find colors between position 1 and 2/i }));
    await userEvent.click(screen.getByRole("button", { name: /find colors between position 1 and 2/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /insert #8000FF/i })).toBeInTheDocument(),
    );
  });

  it("inserting a candidate adds it to the sequence", async () => {
    renderGradients(["#FF0000", "#8000FF", "#0000FF"], [0, 2]);
    await waitFor(() => screen.getByRole("button", { name: /find colors between position 1 and 2/i }));
    await userEvent.click(screen.getByRole("button", { name: /find colors between position 1 and 2/i }));
    await waitFor(() => screen.getByRole("button", { name: /insert #8000FF/i }));
    await userEvent.click(screen.getByRole("button", { name: /insert #8000FF/i }));
    expect(screen.getByRole("button", { name: /remove #8000FF from sequence/i })).toBeInTheDocument();
  });

  it("removing a sequence item makes it available on the shelf again", async () => {
    renderGradients(["#FF0000", "#0000FF"], [0, 1]);
    await waitFor(() => screen.getByRole("button", { name: /remove #FF0000 from sequence/i }));
    await userEvent.click(screen.getByRole("button", { name: /remove #FF0000 from sequence/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).not.toBeDisabled(),
    );
  });

  it("Save PNG is disabled with fewer than 2 sequence items", async () => {
    // Auto-seeds with all palette colors; clear then add just one to test the disabled state.
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /save png/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /add #FF0000 to sequence/i }));
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
});
