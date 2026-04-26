import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PaletteProvider, usePalette } from "../lib/palette-store";
import Dmc from "./Dmc";
import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted so factories can reference these before hoisting
// ---------------------------------------------------------------------------

const { MOCK_DMC_COLORS, mockMatchToDmc } = vi.hoisted(() => {
  const MOCK_DMC_COLORS = [
    { id: "321", name: "Red", hex: "#C72B3B" },
    { id: "666", name: "Bright Red", hex: "#E31D42" },
    { id: "3713", name: "Salmon Very Light", hex: "#FFE2E2" },
    { id: "760", name: "Salmon", hex: "#F5ADAD" },
    { id: "351", name: "Coral", hex: "#E96A67" },
    { id: "350", name: "Coral Medium", hex: "#E04848" },
    { id: "349", name: "Coral Dark", hex: "#D21035" },
    { id: "817", name: "Coral Red Very Dark", hex: "#BB051F" },
    { id: "3708", name: "Melon Light", hex: "#FFCBD5" },
  ];
  const mockMatchToDmc = vi.fn((_hexes: string[]) => [
    { id: "321", name: "Red", hex: "#C72B3B" },
    { id: "666", name: "Bright Red", hex: "#E31D42" },
  ]);
  return { MOCK_DMC_COLORS, mockMatchToDmc };
});

vi.mock("../lib/dmc-colors", () => ({
  DMC_COLORS: MOCK_DMC_COLORS,
}));

vi.mock("../lib/dmc-match", () => ({
  matchToDmc: (...args: Parameters<typeof mockMatchToDmc>) => mockMatchToDmc(...args),
  nearestDmc: (hex: string) => ({ id: "321", name: "Red", hex }),
}));

// ---------------------------------------------------------------------------
// Seeder — dispatches in useEffect (not during render) to avoid React warning
// ---------------------------------------------------------------------------

function Seeder({
  hexes,
  dmcColors,
}: {
  hexes: string[];
  dmcColors?: { id: string; name: string; hex: string }[];
}) {
  const { dispatch } = usePalette();
  useEffect(() => {
    for (const h of hexes) dispatch({ type: "ADD_COLOR", hex: h });
    if (dmcColors && dmcColors.length > 0) {
      dispatch({ type: "SET_DMC_SET", colors: dmcColors });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

async function renderDmc(
  hexes: string[] = [],
  dmcColors?: { id: string; name: string; hex: string }[],
) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <MemoryRouter>
        <PaletteProvider>
          <Seeder hexes={hexes} dmcColors={dmcColors} />
          <Dmc />
        </PaletteProvider>
      </MemoryRouter>,
    );
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dmc page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when palette has no colors and dmcSet is empty", async () => {
    await renderDmc([], []);
    expect(screen.getByText(/your palette is empty/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go to capture/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /auto-match from palette/i })).not.toBeInTheDocument();
  });

  it("shows DMC page (not empty state) when dmcSet is populated but palette is empty", async () => {
    await renderDmc([], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    await waitFor(() => screen.getByText(/321/));
    expect(screen.queryByText(/your palette is empty/i)).not.toBeInTheDocument();
  });

  it("auto-match runs on mount when palette has colors and dmcSet is empty", async () => {
    await renderDmc(["#FF0000", "#00FF00"]);
    await waitFor(() => {
      expect(mockMatchToDmc).toHaveBeenCalledTimes(1);
    });
    expect(mockMatchToDmc).toHaveBeenCalledWith(
      expect.arrayContaining(["#FF0000", "#00FF00"]),
    );
  });

  it("does NOT auto-match when dmcSet is already populated", async () => {
    await renderDmc(["#FF0000"], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    // Give a tick for any stray effects
    await new Promise((r) => setTimeout(r, 50));
    expect(mockMatchToDmc).not.toHaveBeenCalled();
  });

  it("DMC set renders thread IDs and names after auto-match", async () => {
    await renderDmc(["#FF0000", "#00FF00"]);
    await waitFor(() => {
      expect(screen.getByText(/321/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Bright Red/)).toBeInTheDocument();
    expect(screen.getByText(/666/)).toBeInTheDocument();
  });

  it("DMC set renders threads when pre-seeded via dmcColors", async () => {
    await renderDmc([], [
      { id: "321", name: "Red", hex: "#C72B3B" },
      { id: "666", name: "Bright Red", hex: "#E31D42" },
    ]);
    await waitFor(() => {
      expect(screen.getByText(/321/)).toBeInTheDocument();
      expect(screen.getByText(/Bright Red/)).toBeInTheDocument();
    });
  });

  it("remove button removes a thread from dmcSet", async () => {
    await renderDmc([], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    await waitFor(() => screen.getByLabelText("Remove thread 321"));
    const removeBtn = screen.getByLabelText("Remove thread 321");
    await userEvent.click(removeBtn);
    await waitFor(() => {
      expect(screen.queryByLabelText("Remove thread 321")).not.toBeInTheDocument();
    });
  });

  it("search filters DMC_COLORS by name and shows results", async () => {
    await renderDmc([], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    const searchInput = screen.getByLabelText("Search DMC threads");
    await userEvent.type(searchInput, "Salmon");
    await waitFor(() => {
      expect(screen.getByLabelText(/Add thread 3713/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Add thread 760/)).toBeInTheDocument();
    });
  });

  it("search filters DMC_COLORS by thread number", async () => {
    await renderDmc([], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    const searchInput = screen.getByLabelText("Search DMC threads");
    await userEvent.type(searchInput, "666");
    await waitFor(() => {
      expect(screen.getByLabelText(/Add thread 666/)).toBeInTheDocument();
    });
  });

  it("search does not show threads already in dmcSet", async () => {
    await renderDmc([], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    const searchInput = screen.getByLabelText("Search DMC threads");
    await userEvent.type(searchInput, "Red");
    // "321 Red" is already in dmcSet — must NOT appear as an add option
    expect(screen.queryAllByLabelText(/Add thread 321/).length).toBe(0);
    // "666 Bright Red" is not in dmcSet — should appear
    await waitFor(() => {
      expect(screen.getByLabelText(/Add thread 666/)).toBeInTheDocument();
    });
  });

  it("clicking a search result adds the thread and clears search", async () => {
    // Pre-seed a non-666 dmcColor so auto-match doesn't fire (which would add 666 and exclude it from search).
    await renderDmc(["#FF0000"], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    const searchInput = screen.getByLabelText("Search DMC threads");
    await userEvent.type(searchInput, "666");
    await waitFor(() => screen.getByLabelText(/Add thread 666/));
    await userEvent.click(screen.getByLabelText(/Add thread 666/));
    await waitFor(() => {
      expect(screen.getByLabelText("Remove thread 666")).toBeInTheDocument();
      expect(searchInput).toHaveValue("");
    });
  });

it("Go to Gradients button is present", async () => {
    await renderDmc(["#FF0000"]);
    expect(
      screen.getByRole("button", { name: /go to gradients/i }),
    ).toBeInTheDocument();
  });

  it("back button renders with Palette text", async () => {
    await renderDmc([]);
    // Use exact "Palette" to avoid matching "Auto-match from palette"
    expect(screen.getByRole("button", { name: "Palette" })).toBeInTheDocument();
  });

  it("Auto-match from palette button triggers matchToDmc", async () => {
    // Start with a pre-populated dmcSet so auto-match doesn't fire on mount
    await renderDmc(["#FF0000"], [{ id: "321", name: "Red", hex: "#C72B3B" }]);
    vi.clearAllMocks();
    const btn = screen.getByRole("button", { name: /auto-match from palette/i });
    await userEvent.click(btn);
    expect(mockMatchToDmc).toHaveBeenCalledTimes(1);
  });
});
