// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChecklistEditor } from "./checklist-editor";

describe("<ChecklistEditor />", () => {
  it("lists optional items (single match is confirmed separately)", () => {
    render(<ChecklistEditor value={{}} onChange={() => undefined} />);
    expect(screen.getByRole("radiogroup", { name: "Line-up known" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: /Single match/ })).not.toBeInTheDocument();
  });

  it("sets a tri-state answer", async () => {
    const onChange = vi.fn();
    render(<ChecklistEditor value={{ preMatch: "TRUE" }} onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Line-up known" });
    const no = Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "No");
    expect(no).toBeDefined();
    await userEvent.click(no as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith({ preMatch: "TRUE", lineupKnown: "FALSE" });
  });

  it("marks unknown as the default answer", () => {
    render(<ChecklistEditor value={{}} onChange={() => undefined} />);
    const group = screen.getByRole("radiogroup", { name: "Home advantage" });
    const checked = group.querySelector('[aria-checked="true"]');
    expect(checked?.textContent).toBe("?");
  });
});
