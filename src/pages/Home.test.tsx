import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "./Home";

describe("Home page", () => {
  it("renders the app title and scaffold confirmation", () => {
    render(<Home />);
    expect(screen.getByText("Picture to Palette")).toBeInTheDocument();
    expect(screen.getByText("Scaffold is live.")).toBeInTheDocument();
  });
});
