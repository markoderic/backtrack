import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("../actions", () => ({ saveSetup: vi.fn(), addCourse: vi.fn() }));

import { SetupForm } from "./setup-form";
import { saveSetup } from "../actions";

const submit = () => screen.getByRole("button", { name: "Done" });
const name = () => screen.getByLabelText("Your name, as students see it");
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

  it("starts with the name from Google, which the teacher can change", () => {
    render(<SetupForm defaultName="Linda Carter" />);
    expect((name() as HTMLInputElement).value).toBe("Linda Carter");
    expect(screen.getByRole("group", { name: "Your courses" })).toBeInTheDocument();
    fireEvent.change(firstCourse(), { target: { value: "ACC 221" } });
    expect(submit()).toBeEnabled();
    fireEvent.change(name(), { target: { value: "" } });
    expect(submit()).toBeDisabled();
  });

  it("sends once on a double click and keeps Done disabled while it saves", async () => {
    vi.mocked(saveSetup).mockReset().mockImplementation(() => new Promise<never>(() => {}));
    const { container } = render(<SetupForm defaultName="Marko" />);
    fireEvent.change(firstCourse(), { target: { value: "IMS 452" } });
    const form = container.querySelector("form")!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(submit()).toBeDisabled());
    expect(submit()).toHaveAttribute("aria-busy", "true");
    expect(saveSetup).toHaveBeenCalledTimes(1);
  });

  it("stops offering Add another course at 20 courses", () => {
    render(<SetupForm />);
    for (let i = 1; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Add another course" }));
    expect(screen.getAllByLabelText("Course")).toHaveLength(20);
    expect(screen.queryByRole("button", { name: "Add another course" })).not.toBeInTheDocument();
  });
});
