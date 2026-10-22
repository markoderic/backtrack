import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const renderPdf = vi.fn();
vi.mock("@/lib/pdf/renderPdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/renderPdf")>()),
  renderPdf: (...args: unknown[]) => renderPdf(...args),
}));

const upload = vi.fn();
const remove = vi.fn();
const rpc = vi.fn();
const from = vi.fn(() => ({ upload, remove }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ storage: { from }, rpc }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const cleanupOrphanUploads = vi.fn();
vi.mock("../../../lecture-actions", () => ({ cleanupOrphanUploads: () => cleanupOrphanUploads() }));

import { NotPdfError, PasswordPdfError } from "@/lib/pdf/renderPdf";
import { StartForm } from "./start-form";

const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const blob = (type: string) => new Blob(["x"], { type });

function choose(name = "slides.pdf") {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("PDF file"), { target: { files: [file] } });
}

const startButton = () => screen.getByRole("button", { name: "Start lecture" });
const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;
// The slides are prepared as soon as the PDF is picked; Start lecture opens up when they are ready.
async function chooseReady(name = "slides.pdf") {
  choose(name);
  await waitFor(() => expect(startButton()).toBeEnabled());
}

beforeEach(() => {
  renderPdf.mockReset();
  upload.mockReset();
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  cleanupOrphanUploads.mockReset().mockResolvedValue(0);
  rpc.mockReset();
  from.mockClear();
  push.mockReset();
  upload.mockResolvedValue({ data: {}, error: null });
  rpc.mockResolvedValue({ data: [{ lecture_id: "x", code: "123456" }], error: null });
});

describe("StartForm", () => {
  it("prefills the lecture name after the existing lectures", async () => {
    render(<StartForm courseId={COURSE} existingCount={6} />);
    await waitFor(() => expect(nameField().value).toMatch(/^Lecture 7, [A-Z][a-z]{2} \d{1,2}$/));
  });

  it("keeps Start lecture disabled until the slides are ready and the name is not blank", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    expect(startButton()).toBeDisabled();
    await chooseReady();
    fireEvent.change(nameField(), { target: { value: "   " } });
    expect(startButton()).toBeDisabled();
  });

  it("accepts a dropped file and starts preparing it", async () => {
    renderPdf.mockReturnValue(new Promise(() => {}));
    render(<StartForm courseId={COURSE} existingCount={0} />);
    const file = new File(["%PDF-1.7"], "dropped.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file] } });
    expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
    expect(renderPdf).toHaveBeenCalledWith(file, expect.any(Function));
  });

  it("shows a plain error for a file that is not a PDF and creates nothing", async () => {
    renderPdf.mockRejectedValue(new NotPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose("notes.pdf");
    expect(await screen.findByText("That file isn't a PDF.")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    // Back to the drop area, ready for another file.
    expect(screen.getByText("Drop the slides PDF here")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("shows a plain error for a password protected PDF", async () => {
    renderPdf.mockRejectedValue(new PasswordPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    expect(await screen.findByText("That PDF is password protected. Remove the password and try again.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows progress while preparing slides, and Cancel drops the file", async () => {
    let finish: (v: unknown) => void = () => {};
    let progress: (d: number, t: number) => void = () => {};
    renderPdf.mockImplementation((_file: File, onProgress: (d: number, t: number) => void) => {
      progress = onProgress;
      onProgress(12, 40);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    // Announced in one polite live region that is always on the page.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preparing slide 12 of 40"));
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("progressbar", { name: "Preparing slides" })).toHaveAttribute("aria-valuenow", "12");
    expect(screen.getByText(/^40 pages, /)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Drop the slides PDF here")).toBeInTheDocument();
    // The cancelled render stops at its next page and its result is ignored.
    expect(() => progress(13, 40)).toThrow();
    finish({ blobs: [blob("image/webp")], firstLines: [""] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/slides? ready/)).toBeNull();
    expect(startButton()).toBeDisabled();
  });

  it("stops preparing when the page goes away", async () => {
    let progress: (d: number, t: number) => void = () => {};
    renderPdf.mockImplementation((_file: File, onProgress: (d: number, t: number) => void) => {
      progress = onProgress;
      return new Promise(() => {});
    });
    const { unmount } = render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    await waitFor(() => expect(renderPdf).toHaveBeenCalled());
    expect(() => progress(1, 10)).not.toThrow();
    unmount();
    expect(() => progress(2, 10)).toThrow();
  });

  it("says how many slides are ready and what Start does", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("Week 8 slides.pdf");
    expect(screen.getByText("Week 8 slides.pdf")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 slides ready");
    expect(screen.getByText(/^2 pages, /)).toBeInTheDocument();
    expect(screen.getByText("Opens the projector view with the join code.")).toBeInTheDocument();
    // Change file is a real button that opens the file picker.
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Change file" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("shows an indeterminate bar until the page count is known", async () => {
    renderPdf.mockReturnValue(new Promise(() => {}));
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    const bar = await screen.findByRole("progressbar", { name: "Preparing slides" });
    expect(bar).not.toHaveAttribute("aria-valuemax");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("status")).toHaveTextContent("Preparing slides");
  });

  it("does not start the lecture when an upload fails, and can try again without preparing again", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    upload.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValue({ data: null, error: { message: "nope" } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not upload your slides. Try again.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(startButton()).toBeEnabled();
    expect(renderPdf).toHaveBeenCalledTimes(1);
  });

  it("shows the upload progress after Start", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    upload.mockReturnValue(new Promise(() => {}));
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading slide 0 of 2"));
    expect(startButton()).toBeDisabled();
    expect(nameField()).toBeDisabled();
  });

  it("uploads every slide, creates the lecture and opens the projector view", async () => {
    renderPdf.mockResolvedValue({
      blobs: [blob("image/webp"), blob("image/webp"), blob("image/webp")],
      firstLines: ["Welcome", "", "Goals"],
    });
    render(<StartForm courseId={COURSE} existingCount={2} />);
    await chooseReady();
    fireEvent.change(nameField(), { target: { value: " Week 3 " } });
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
    await chooseReady();
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
    await chooseReady();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not start the lecture. Try again.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("clears the teacher's old leftover uploads in the background when the page opens", async () => {
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await waitFor(() => expect(cleanupOrphanUploads).toHaveBeenCalledTimes(1));
  });

  it("a failed cleanup changes nothing on the page", async () => {
    cleanupOrphanUploads.mockRejectedValue(new Error("offline"));
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes the uploaded images back out when the database refuses the lecture", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/jpeg")], firstLines: ["", ""] });
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "missing_images" } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not start the lecture. Try again.")).toBeInTheDocument();
    const id = rpc.mock.calls[0][1].p_lecture_id as string;
    expect(remove).toHaveBeenCalledTimes(1);
    expect([...remove.mock.calls[0][0]].sort()).toEqual([`${id}/1.webp`, `${id}/2.jpg`]);
  });

  it("takes back only what reached storage when an upload fails", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["", ""] });
    upload.mockImplementation(async (path: string) =>
      path.endsWith("/1.webp") ? { data: {}, error: null } : { data: null, error: { message: "nope" } },
    );
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not upload your slides. Try again.")).toBeInTheDocument();
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove.mock.calls[0][0]).toHaveLength(1);
    expect(remove.mock.calls[0][0][0]).toMatch(/\/1\.webp$/);
  });

  it("removes nothing when nothing was uploaded, and nothing after a start that worked", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    upload.mockResolvedValue({ data: null, error: { message: "nope" } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not upload your slides. Try again.")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    upload.mockResolvedValue({ data: {}, error: null });
    fireEvent.click(startButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(remove).not.toHaveBeenCalled();
  });
});
