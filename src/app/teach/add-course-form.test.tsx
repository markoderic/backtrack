import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const addCourse = vi.fn();
vi.mock("./actions", () => ({ addCourse: (name: string) => addCourse(name), saveSetup: vi.fn() }));

import { AddCourseForm, CoursesHeading } from "./add-course-form";

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

describe("CoursesHeading (the dashboard's + button)", () => {
  const plus = () => screen.getByRole("button", { name: "Add a course" });

  it("is a 44 px icon button next to the Courses heading, named Add a course, closed at first", () => {
    render(<CoursesHeading />);
    expect(screen.getByRole("heading", { level: 1, name: "Courses" })).toBeInTheDocument();
    expect(plus().textContent).toBe("");
    expect(plus().className).toContain("size-11");
    expect(plus()).toHaveAttribute("aria-expanded", "false");
    expect(plus().parentElement).toBe(screen.getByRole("heading", { level: 1 }).parentElement);
    expect(screen.queryByLabelText("Course name")).toBeNull();
  });

  it("opens the name field under the heading, focused; Cancel or Esc close it with the keyboard back on +", () => {
    render(<CoursesHeading />);
    fireEvent.click(plus());
    expect(plus()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Course name")).toHaveFocus();
    expect(plus()).toHaveAttribute("aria-controls", screen.getByLabelText("Course name").closest("form")!.id);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Course name")).toBeNull();
    expect(plus()).toHaveFocus();
    fireEvent.click(plus());
    fireEvent.keyDown(screen.getByLabelText("Course name"), { key: "Escape" });
    expect(screen.queryByLabelText("Course name")).toBeNull();
    expect(plus()).toHaveFocus();
    // + again closes it when it is open.
    fireEvent.click(plus());
    fireEvent.click(plus());
    expect(screen.queryByLabelText("Course name")).toBeNull();
  });

  it("adds the trimmed name, then closes the field", async () => {
    render(<CoursesHeading />);
    fireEvent.click(plus());
    fireEvent.change(screen.getByLabelText("Course name"), { target: { value: " BIO 121 " } });
    fireEvent.click(screen.getByRole("button", { name: "Add course" }));
    await waitFor(() => expect(addCourse).toHaveBeenCalledWith("BIO 121"));
    await waitFor(() => expect(screen.queryByLabelText("Course name")).toBeNull());
    expect(plus()).toHaveFocus();
  });

  it("with no courses the field is open from the start, without Cancel; + puts the keyboard in it", () => {
    render(<CoursesHeading startOpen />);
    expect(screen.getByLabelText("Course name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(plus());
    expect(screen.getByLabelText("Course name")).toHaveFocus();
  });

  it("Settings' field and the dashboard's field never share an id (Next keeps both pages mounted)", () => {
    render(
      <>
        <AddCourseForm startOpen />
        <CoursesHeading startOpen />
      </>,
    );
    const fields = screen.getAllByLabelText("Course name");
    expect(fields).toHaveLength(2);
    expect(fields[0].id).not.toBe(fields[1].id);
    expect(document.getElementById("new-course")).toBeNull();
    // The dashboard's + reaches its own field, not Settings'.
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    expect(fields[1]).toHaveFocus();
  });

  it("with no courses yet, the field closes once the first course is added", async () => {
    render(<CoursesHeading startOpen />);
    fireEvent.change(screen.getByLabelText("Course name"), { target: { value: "BIO 121" } });
    fireEvent.click(screen.getByRole("button", { name: "Add course" }));
    await waitFor(() => expect(screen.queryByLabelText("Course name")).toBeNull());
  });
});

