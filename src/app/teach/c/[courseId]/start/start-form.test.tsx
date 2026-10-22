import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const renderPdf = vi.fn();
vi.mock("@/lib/pdf/renderPdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/renderPdf")>()),
  renderPdf: (...args: unknown[]) => renderPdf(...args),
}));

const upload = vi.fn();
const rpc = vi.fn();
const from = vi.fn(() => ({ upload }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ storage: { from }, rpc }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NotPdfError, PasswordPdfError } from "@/lib/pdf/renderPdf";
import { StartForm } from "./start-form";

const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const blob = (type: string) => new Blob(["x"], { type });

function choose(name = "slides.pdf") {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("PDF file"), { target: { files: [file] } });
}

const startButton = () => screen.getByRole("button", { name: "Start lecture" });

beforeEach(() => {
  renderPdf.mockReset();
  upload.mockReset();
  rpc.mockReset();
  from.mockClear();
  push.mockReset();
  upload.mockResolvedValue({ data: {}, error: null });
  rpc.mockResolvedValue({ data: [{ lecture_id: "x", code: "123456" }], error: null });
});

describe("StartForm", () => {
  it("prefills the lecture name after the existing lectures", async () => {
    render(<StartForm courseId={COURSE} existingCount={6} />);
    await waitFor(() =>
      expect((screen.getByLabelText("Lecture name") as HTMLInputElement).value).toMatch(/^Lecture 7, [A-Z][a-z]{2} \d{1,2}$/),
    );
  });

  it("keeps Start lecture disabled until a PDF is chosen and the name is not blank", async () => {
    render(<StartForm courseId={COURSE} existingCount={0} />);
    expect(startButton()).toBeDisabled();
    choose();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Lecture name"), { target: { value: "   " } });
    expect(startButton()).toBeDisabled();
  });

  it("accepts a dropped file", async () => {
    render(<StartForm courseId={COURSE} existingCount={0} />);
    const file = new File(["%PDF-1.7"], "dropped.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file] } });
    expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
  });

  it("shows a plain error for a file that is not a PDF and creates nothing", async () => {
    renderPdf.mockRejectedValue(new NotPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose("notes.pdf");
    fireEvent.click(startButton());
    expect(await screen.findByText("That file isn't a PDF.")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(startButton()).toBeEnabled();
  });

  it("shows a plain error for a password protected PDF", async () => {
    renderPdf.mockRejectedValue(new PasswordPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    fireEvent.click(startButton());
    expect(await screen.findByText("That PDF is password protected. Remove the password and try again.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows progress while preparing slides", async () => {
    let finish: (v: unknown) => void = () => {};
    renderPdf.mockImplementation((_file: File, onProgress: (d: number, t: number) => void) => {
      onProgress(12, 40);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    fireEvent.click(startButton());
    expect(await screen.findByText("Preparing slide 12 of 40")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    finish({ blobs: [], firstLines: [] });
  });

  it("does not start the lecture when an upload fails", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    upload.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValue({ data: null, error: { message: "nope" } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not upload your slides. Try again.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("uploads every slide, creates the lecture and opens the projector view", async () => {
    renderPdf.mockResolvedValue({
      blobs: [blob("image/webp"), blob("image/webp"), blob("image/webp")],
      firstLines: ["Welcome", "", "Goals"],
    });
    render(<StartForm courseId={COURSE} existingCount={2} />);
    choose();
    fireEvent.change(screen.getByLabelText("Lecture name"), { target: { value: " Week 3 " } });
    fireEvent.click(startButton());

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(from).toHaveBeenCalledWith("slides");
    expect(upload).toHaveBeenCalledTimes(3);

    const [rpcName, args] = rpc.mock.calls[0];
    expect(rpcName).toBe("start_lecture");
    expect(args.p_course_id).toBe(COURSE);
    expect(args.p_name).toBe("Week 3");
    const lectureId = args.p_lecture_id as string;
    expect(lectureId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(args.p_slides).toEqual([
      { number: 1, image_path: `${lectureId}/1.webp`, first_line: "Welcome" },
      { number: 2, image_path: `${lectureId}/2.webp`, first_line: "" },
      { number: 3, image_path: `${lectureId}/3.webp`, first_line: "Goals" },
    ]);

    const uploaded = upload.mock.calls.map((c) => c[0]).sort();
    expect(uploaded).toEqual([`${lectureId}/1.webp`, `${lectureId}/2.webp`, `${lectureId}/3.webp`]);
    for (const call of upload.mock.calls) expect(call[2]).toEqual({ contentType: "image/webp", upsert: false });

    expect(push).toHaveBeenCalledWith(`/teach/l/${lectureId}/present`);
  });

  it("uses the .jpg extension when the browser fell back to JPEG", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/jpeg")], firstLines: [""] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    fireEvent.click(startButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    const slides = rpc.mock.calls[0][1].p_slides;
    expect(slides[0].image_path).toMatch(/\/1\.jpg$/);
    expect(upload.mock.calls[0][2]).toEqual({ contentType: "image/jpeg", upsert: false });
  });

  it("shows a plain error when the database refuses the lecture", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    rpc.mockResolvedValue({ data: null, error: { message: "You do not own that course." } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not start the lecture. Try again.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
