import { useRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PaletteProvider, usePalette } from "../lib/palette-store";
import Gradients from "./Gradients";

vi.mock("../lib/gradient-canvas", () => ({
  renderGradientPng: vi.fn(async () => "data:image/png;base64,FAKE"),
}));

function Seeder({ hexes, anchors }: { hexes: string[]; anchors: [number, number] }) {
  const { state, dispatch } = usePalette();
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    for (const h of hexes) dispatch({ type: "ADD_COLOR", hex: h });
  }
  if (state.colors.length > 0 && state.anchorA === null) {
    dispatch({ type: "TAP_SWATCH", id: state.colors[anchors[0]].id });
    dispatch({ type: "TAP_SWATCH", id: state.colors[anchors[1]].id });
  }
  return null;
}

function renderGradients(hexes: string[], anchors: [number, number]) {
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
  it("shows inbetween count when both anchors are set", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 2]);
    await waitFor(() => {
      expect(
        screen.getByText(/between your anchors|No palette colours fall/i),
      ).toBeInTheDocument();
    });
  });

  it("Save PNG button is enabled when gradient has colours", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 2]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save png/i })).not.toBeDisabled(),
    );
  });

  it("clicking Save PNG calls renderGradientPng", async () => {
    const mod = await import("../lib/gradient-canvas");
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 2]);
    await waitFor(() => screen.getByRole("button", { name: /save png/i }));
    await userEvent.click(screen.getByRole("button", { name: /save png/i }));
    await waitFor(() => expect(mod.renderGradientPng).toHaveBeenCalled());
  });

  it("shows fallback when no anchors are set", () => {
    render(
      <MemoryRouter>
        <PaletteProvider>
          <Gradients />
        </PaletteProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(/pick two anchors/i)).toBeInTheDocument();
  });

  it("renders L: and C: labels for each swatch in the gradient", async () => {
    // Red → purple → blue: purple is inbetween in natural mode
    renderGradients(["#FF0000", "#8000FF", "#0000FF"], [0, 2]);
    await waitFor(() => {
      const lLabels = screen.getAllByText(/L:/);
      expect(lLabels.length).toBeGreaterThanOrEqual(2); // at least the two anchors
    });
  });

  it("tapping an inbetween swatch moves it to the excluded row", async () => {
    // Red anchor, purple inbetween, blue anchor
    renderGradients(["#FF0000", "#8000FF", "#0000FF"], [0, 2]);
    await waitFor(() => screen.getAllByRole("button", { name: /gradient candidate/i }));
    const swatches = screen.getAllByRole("button", { name: /gradient candidate/i });
    const inbetweenSwatch = swatches[0];
    if (inbetweenSwatch) {
      await userEvent.click(inbetweenSwatch);
      await waitFor(() =>
        expect(screen.getByText(/excluded/i)).toBeInTheDocument(),
      );
    }
  });

  it("tapping an excluded swatch restores it to the gradient", async () => {
    renderGradients(["#FF0000", "#8000FF", "#0000FF"], [0, 2]);
    await waitFor(() => screen.getAllByRole("button", { name: /gradient candidate/i }));
    const swatches = screen.getAllByRole("button", { name: /gradient candidate/i });
    const inbetweenSwatch = swatches[0];
    if (inbetweenSwatch) {
      await userEvent.click(inbetweenSwatch);
      await waitFor(() => screen.getByText(/excluded/i));
      const restoreBtn = screen.getByRole("button", { name: /restore/i });
      await userEvent.click(restoreBtn);
      await waitFor(() =>
        expect(screen.queryByText(/excluded/i)).not.toBeInTheDocument(),
      );
    }
  });
});
