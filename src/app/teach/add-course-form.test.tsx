import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const addCourse = vi.fn();
vi.mock("./actions", () => ({ addCourse: (name: string) => addCourse(name), saveSetup: vi.fn() }));

import { AddCourseForm } from "./add-course-form";

beforeEach(() => {
  addCourse.mockReset();
  addCourse.mockResolvedValue(undefined);
});

describe("AddCourseForm", () => {
  it("shows Add a course first and opens the field in place", () => {
    render(<AddCourseForm />);
    expect(screen.queryByLabelText("Course name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    expect(screen.getByLabelText("Course name")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Course name")).toBeNull();
    expect(screen.getByRole("button", { name: "Add a course" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    fireEvent.keyDown(screen.getByLabelText("Course name"), { key: "Escape" });
    expect(screen.queryByLabelText("Course name")).toBeNull();
  });

  it("Add a course and Cancel are white buttons, Add course the black one (no underlined text actions)", () => {
    render(<AddCourseForm />);
    const add = screen.getByRole("button", { name: "Add a course" });
    expect(add.className).toContain("border-hairline");
    expect(add.className).toContain("h-11");
    expect(add.className).not.toContain("underline");
    fireEvent.click(add);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.className).toContain("border-hairline");
    expect(cancel.className).not.toContain("underline");
    expect(screen.getByRole("button", { name: "Add course" }).className).toContain("bg-ink");
    expect(screen.getByRole("button", { name: "Add course" }).className).toContain("h-12");
  });

  it("is open from the start when the teacher has no courses", () => {
    render(<AddCourseForm startOpen />);
    expect(screen.getByLabelText("Course name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("keeps the button disabled until there is a name", () => {
    render(<AddCourseForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    expect(screen.getByRole("button", { name: "Add course" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Course name"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Add course" })).toBeDisabled();
  });

  it("adds the trimmed name and clears the field", async () => {
    render(<AddCourseForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    const input = screen.getByLabelText("Course name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: " BIO 121 " } });
    fireEvent.click(screen.getByRole("button", { name: "Add course" }));
    await waitFor(() => expect(addCourse).toHaveBeenCalledWith("BIO 121"));
    await waitFor(() => expect(input.value).toBe(""));
  });
});
