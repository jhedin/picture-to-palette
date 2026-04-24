import { useRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  PaletteProvider,
  usePalette,
} from "../lib/palette-store";
import Gradients from "./Gradients";

vi.mock("../lib/gradient-canvas", () => ({
  renderGradientPng: vi.fn(async () => "data:image/png;base64,FAKE"),
  sampleGradientStop: (colors: string[], t: number) => colors[Math.floor(t * (colors.length - 1))],
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
  it("renders at least one candidate when both anchors set", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF", "#FFFF00"], [0, 1]);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /gradient candidate/i }).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("Save is disabled until a candidate is selected", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 1]);
    await waitFor(() => screen.getAllByRole("button", { name: /gradient candidate/i }));
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getAllByRole("button", { name: /gradient candidate/i })[0]);
    expect(save).not.toBeDisabled();
  });

  it("clicking Save calls renderGradientPng", async () => {
    const mod = await import("../lib/gradient-canvas");
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 1]);
    await waitFor(() => screen.getAllByRole("button", { name: /gradient candidate/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /gradient candidate/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mod.renderGradientPng).toHaveBeenCalled());
  });
});
