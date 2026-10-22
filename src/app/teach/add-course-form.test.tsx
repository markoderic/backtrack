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
  it("keeps the button disabled until there is a name", () => {
    render(<AddCourseForm />);
    expect(screen.getByRole("button", { name: "Add course" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Course name"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Add course" })).toBeDisabled();
  });

  it("adds the trimmed name and clears the field", async () => {
    render(<AddCourseForm />);
    const input = screen.getByLabelText("Course name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: " BIO 121 " } });
    fireEvent.click(screen.getByRole("button", { name: "Add course" }));
    await waitFor(() => expect(addCourse).toHaveBeenCalledWith("BIO 121"));
    await waitFor(() => expect(input.value).toBe(""));
  });
});
