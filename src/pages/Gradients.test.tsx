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
      expect(screen.getByRole("button", { name: /remove #FF0000 from sequence/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /remove #00FF00 from sequence/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /remove #0000FF from sequence/i })).toBeInTheDocument();
    });
  });

  it("seeds using anchors when both are set", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 2]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /remove #FF0000 from sequence/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /remove #0000FF from sequence/i })).toBeInTheDocument();
    });
  });

  it("shelf is empty when all colors are in the sequence", async () => {
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /remove #FF0000 from sequence/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /add #FF0000 to sequence/i })).not.toBeInTheDocument();
  });

  it("removing a sequence item makes it available on the shelf again", async () => {
    renderGradients(["#FF0000", "#0000FF"], [0, 1]);
    await waitFor(() => screen.getByRole("button", { name: /remove #FF0000 from sequence/i }));
    await userEvent.click(screen.getByRole("button", { name: /remove #FF0000 from sequence/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /add #FF0000 to sequence/i })).not.toBeDisabled(),
    );
  });

  it("tapping a shelf color adds it to the sequence", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /add #FF0000 to sequence/i }));
    expect(screen.getByRole("button", { name: /remove #FF0000 from sequence/i })).toBeInTheDocument();
  });

  it("clear button empties the sequence", async () => {
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() => screen.getByRole("button", { name: /clear/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /remove #FF0000 from sequence/i })).not.toBeInTheDocument(),
    );
  });

  it("Save PNG is disabled with fewer than 2 sequence items", async () => {
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

  it("does not enter DMC mode without ?mode=dmc", async () => {
    renderGradients(["#FF0000", "#0000FF"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /remove #FF0000 from sequence/i })).toBeInTheDocument(),
    );
    // DMC-mode label not shown
    expect(screen.queryByText(/available dmc threads/i)).not.toBeInTheDocument();
  });
});
