import { useRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  PaletteProvider,
  usePalette,
} from "../lib/palette-store";
import Palette from "./Palette";

function Seeder({ hexes }: { hexes: string[] }) {
  const { dispatch } = usePalette();
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    for (const h of hexes) dispatch({ type: "ADD_COLOR", hex: h });
  }
  return null;
}

function renderPalette(hexes: string[]) {
  return render(
    <MemoryRouter>
      <PaletteProvider>
        <Seeder hexes={hexes} />
        <Palette />
      </PaletteProvider>
    </MemoryRouter>,
  );
}

describe("Palette page", () => {
  it("renders one swatch per color", () => {
    renderPalette(["#FF0000", "#00FF00", "#0000FF"]);
    expect(screen.getAllByRole("button", { name: /swatch #/i }).length).toBe(3);
  });

  it("first tap marks anchor A; second tap (different swatch) marks anchor B", async () => {
    renderPalette(["#FF0000", "#00FF00"]);
    const swatches = screen.getAllByRole("button", { name: /swatch #/i });
    await userEvent.click(swatches[0]);
    expect(swatches[0]).toHaveAttribute("data-anchor", "A");
    await userEvent.click(swatches[1]);
    expect(swatches[1]).toHaveAttribute("data-anchor", "B");
  });

  it("Generate gradients is disabled until both anchors chosen", async () => {
    renderPalette(["#FF0000", "#00FF00"]);
    const btn = screen.getByRole("button", { name: /generate gradients/i });
    expect(btn).toBeDisabled();
    const swatches = screen.getAllByRole("button", { name: /swatch #/i });
    await userEvent.click(swatches[0]);
    await userEvent.click(swatches[1]);
    expect(btn).not.toBeDisabled();
  });

  it("× removes a swatch", async () => {
    renderPalette(["#FF0000", "#00FF00", "#0000FF"]);
    const removeButtons = screen.getAllByRole("button", { name: /remove #/i });
    await userEvent.click(removeButtons[0]);
    expect(screen.getAllByRole("button", { name: /swatch #/i }).length).toBe(2);
  });
});
