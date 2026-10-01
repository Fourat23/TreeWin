// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileBadge, ResultBadge, StatusBadge } from "./domain-badges";

describe("status and profile badges", () => {
  it("never rely on colour alone: every status has a text label and an icon", () => {
    for (const [status, label] of [
      ["ACTIVE", "Active"],
      ["MATURE", "Mature"],
      ["DEAD", "Dead"],
      ["PAUSED", "Paused"],
    ] as const) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("labels profiles by name", () => {
    render(<ProfileBadge profile="GROWTH" />);
    expect(screen.getByText("Growth")).toBeInTheDocument();
  });

  it("shows cancelled tickets distinctly", () => {
    render(<ResultBadge result="PENDING" cancelled />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});
