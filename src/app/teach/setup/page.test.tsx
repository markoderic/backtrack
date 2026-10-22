import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../actions", () => ({ saveSetup: vi.fn(), addCourse: vi.fn() }));

import { SetupForm } from "./setup-form";

const submit = () => screen.getByRole("button", { name: "Continue" });
const name = () => screen.getByLabelText("Your name");
const firstCourse = () => screen.getAllByLabelText("Course")[0];

describe("SetupForm", () => {
  it("asks for the name and a course", () => {
    render(<SetupForm />);
    expect(name()).toBeInTheDocument();
    expect(screen.getAllByLabelText("Course")).toHaveLength(1);
  });

  it("keeps submit disabled until both the name and a course are filled", () => {
    render(<SetupForm />);
    expect(submit()).toBeDisabled();

    fireEvent.change(name(), { target: { value: "Marko" } });
    expect(submit()).toBeDisabled();

    fireEvent.change(firstCourse(), { target: { value: "IMS 452" } });
    expect(submit()).toBeEnabled();
  });

  it("treats blank entries as empty", () => {
    render(<SetupForm />);
    fireEvent.change(name(), { target: { value: "   " } });
    fireEvent.change(firstCourse(), { target: { value: "   " } });
    expect(submit()).toBeDisabled();
  });

  it("lets the teacher add more courses, all sent as course fields", () => {
    const { container } = render(<SetupForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add another course" }));
    const courses = screen.getAllByLabelText("Course");
    expect(courses).toHaveLength(2);
    fireEvent.change(courses[0], { target: { value: "IMS 452" } });
    fireEvent.change(courses[1], { target: { value: "BIO 121" } });
    const sent = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="course"]')).map((i) => i.value);
    expect(sent).toEqual(["IMS 452", "BIO 121"]);
  });
});
