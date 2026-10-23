import { describe, it, expect, vi, beforeEach } from "vitest";
import { Activity } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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

// The projector opens with replace (Back goes to the course, not to this form).
const replace = vi.fn();
const refresh = vi.fn();
const router = { replace, refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
  replace.mockReset();
  refresh.mockReset();
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
    expect(renderPdf).toHaveBeenCalledWith(file, expect.any(Function), expect.any(Function));
  });

  it("shows a plain error for a file that is not a PDF and creates nothing", async () => {
    renderPdf.mockRejectedValue(new NotPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose("notes.pdf");
    expect(await screen.findByText("That file isn't a PDF.")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
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

  it("shows progress while preparing slides, and Remove drops the file", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Remove slides.pdf" }));
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

  it("says how many slides are ready, with Replace and Remove on the file and no hint under Start", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("Week 8 slides.pdf");
    expect(screen.getByText("Week 8 slides.pdf")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 slides ready");
    expect(screen.getByText(/^2 pages, /)).toBeInTheDocument();
    // Marko: "no one is gonna read that".
    expect(screen.queryByText("Opens the projector view with the join code.")).toBeNull();
    // Replace and Remove are white buttons; Replace opens the file picker for one file.
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    const replaceButton = screen.getByRole("button", { name: "Replace Week 8 slides.pdf" });
    expect(replaceButton).toHaveTextContent("Replace");
    expect(replaceButton.className).toContain("border-hairline");
    fireEvent.click(replaceButton);
    expect(click).toHaveBeenCalledTimes(1);
    expect(input.multiple).toBe(false);
    expect(screen.getByRole("button", { name: "Remove Week 8 slides.pdf" })).toHaveTextContent("Remove");
    // Add another PDF opens it for more files.
    fireEvent.click(screen.getByRole("button", { name: "Add another PDF" }));
    expect(click).toHaveBeenCalledTimes(2);
    expect(input.multiple).toBe(true);
  });

  it("Remove takes a ready file away and goes back to the drop area", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: ["a"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("week8.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Remove week8.pdf" }));
    expect(screen.queryByText("week8.pdf")).toBeNull();
    expect(screen.getByText("Drop the slides PDF here")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    expect(screen.getByTestId("start-status")).toHaveTextContent("");
  });

  it("Replace swaps the file in place and prepares the new one", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["old"] })
      .mockResolvedValueOnce({ blobs: [blob("image/webp"), blob("image/webp"), blob("image/webp")], firstLines: ["a", "b", "c"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("draft.pdf");
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Replace draft.pdf" }));
    choose("final.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 slides ready"));
    expect(screen.queryByText("draft.pdf")).toBeNull();
    expect(screen.getByText("final.pdf")).toBeInTheDocument();
    expect(renderPdf).toHaveBeenCalledTimes(2);
  });

  it("Replace with a file that is not a PDF keeps the original (batch A review M3)", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] })
      .mockRejectedValueOnce(new NotPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("draft.pdf");
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Replace draft.pdf" }));
    choose("photo.png");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("draft.pdf")).toBeInTheDocument();
    expect(screen.queryByText("photo.png")).toBeNull();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 slides ready"));
    expect(screen.getByRole("button", { name: "Start lecture" })).toBeEnabled();
  });

  it("Replace with a password PDF keeps the original too", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["a"] })
      .mockRejectedValueOnce(new PasswordPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("draft.pdf");
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Replace draft.pdf" }));
    choose("locked.pdf");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("draft.pdf")).toBeInTheDocument();
    expect(screen.queryByText("locked.pdf")).toBeNull();
  });

  it("Add another PDF puts its pages after the first one's: names in order, the combined count, one lecture", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["Intro", "Goals"] })
      .mockResolvedValueOnce({ blobs: [blob("image/jpeg")], firstLines: ["Extra"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("part1.pdf");
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Add another PDF" }));
    choose("part2.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 slides ready"));
    const names = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(names[0]).toContain("part1.pdf");
    expect(names[1]).toContain("part2.pdf");
    // Said on screen as well as in the status line.
    expect(screen.getAllByText("3 slides ready")).toHaveLength(2);

    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const id = rpc.mock.calls[0][1].p_lecture_id as string;
    expect(rpc.mock.calls[0][1].p_slides).toEqual([
      { number: 1, image_path: `${id}/1.webp`, first_line: "Intro" },
      { number: 2, image_path: `${id}/2.webp`, first_line: "Goals" },
      { number: 3, image_path: `${id}/3.jpg`, first_line: "Extra" },
    ]);
  });

  it("removing the first of two PDFs keeps the second, and its pages become the lecture", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] })
      .mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["only"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("one.pdf");
    choose("two.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 slides ready"));
    fireEvent.click(screen.getByRole("button", { name: "Remove one.pdf" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 slide ready");
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1].p_slides.map((x: { first_line: string }) => x.first_line)).toEqual(["only"]);
  });

  it("waits for every PDF: Start stays off while a second one is still being prepared", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["a"] })
      .mockReturnValueOnce(new Promise(() => {}));
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("one.pdf");
    choose("two.pdf");
    expect(await screen.findByText("two.pdf")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("a bad second file is dropped with the error, the first stays", async () => {
    renderPdf.mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["a"] }).mockRejectedValueOnce(new NotPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("good.pdf");
    choose("bad.pdf");
    expect(await screen.findByText("That file isn't a PDF.")).toBeInTheDocument();
    expect(screen.queryByText("bad.pdf")).toBeNull();
    expect(screen.getByText("good.pdf")).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
  });

  it("Start never renders the PDF again: it only uploads the images made when the file was picked", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    const prepared = renderPdf.mock.results[0].value as Promise<{ blobs: Blob[] }>;
    const { blobs } = await prepared;
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining(blobs));
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

  it("does not start the lecture when an upload keeps failing, and can try again without preparing again", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    upload.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValue({ data: null, error: { message: "nope" } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not upload your slides. Try again.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(startButton()).toBeEnabled();
    expect(renderPdf).toHaveBeenCalledTimes(1);
  });

  it("Start waits for an upload still running and says so next to the button, keeping the slides in view (D5)", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["a", "b"] });
    upload.mockReturnValue(new Promise(() => {}));
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    // Already uploading in the background, on the file's card.
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 0 of 2");
    expect(screen.getByRole("progressbar", { name: "Uploading slides.pdf" })).toBeInTheDocument();
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Uploading slides" })).toHaveAttribute("aria-valuemax", "2"));
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 0 of 2");
    // On screen next to Start lecture (the card's own bar steps aside), as well as in the status line.
    expect(screen.getAllByText("Uploading 0 of 2")).toHaveLength(2);
    expect(screen.queryByRole("progressbar", { name: "Uploading slides.pdf" })).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Preparing slides" })).toBeNull();
    // No lecture with a missing slide.
    expect(rpc).not.toHaveBeenCalled();
    // The prepared slides stay on screen; the file can not be changed mid-start.
    expect(screen.getByText("2 slides")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Remove / })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Replace / })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add another PDF" })).toBeDisabled();
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

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
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

    expect(replace).toHaveBeenCalledWith(`/teach/l/${lectureId}/present`);
  });

  it("uses the .jpg extension when the browser fell back to JPEG", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/jpeg")], firstLines: [""] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalled());
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
    expect(replace).not.toHaveBeenCalled();
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

  it("keeps the uploaded images when the database refuses the lecture, so Start again only creates it", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/jpeg")], firstLines: ["", ""] });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "You do not own that course." } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 slides ready"));
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not start the lecture. Try again.")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1].p_slides).toEqual(rpc.mock.calls[0][1].p_slides);
  });

  it("images the database can not find (the day old cleanup took them) go up again once, under new names", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/jpeg")], firstLines: ["a", "b"] });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "missing_images" } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const id = rpc.mock.calls[0][1].p_lecture_id as string;
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1].p_slides).toEqual([
      { number: 1, image_path: `${id}/3.webp`, first_line: "a" },
      { number: 2, image_path: `${id}/4.jpg`, first_line: "b" },
    ]);
    // What may be left of the first ones goes.
    expect([...remove.mock.calls[0][0]].sort()).toEqual([`${id}/1.webp`, `${id}/2.jpg`]);
  });

  it("says so when the images are still missing after going up again, and starts nothing", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "missing_images" } });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    expect(await screen.findByText("Could not start the lecture. Try again.")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
  });

  it("an upload that failed in the background is tried again by Start under a new name, and only that one", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["", ""] });
    let down = true;
    upload.mockImplementation(async (path: string) =>
      down && !path.endsWith("/1.webp") ? { data: null, error: { message: "nope" } } : { data: {}, error: null },
    );
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    // One quiet retry, then the card says what happened.
    await waitFor(() => expect(screen.getByTestId("upload-stalled")).toHaveTextContent("Some slides did not upload. Start lecture tries again."));
    expect(screen.getByRole("status")).toHaveTextContent("Some slides did not upload. Start lecture tries again.");
    expect(upload.mock.calls.map((c) => c[0].split("/")[1])).toEqual(["1.webp", "2.webp", "3.webp"]);
    down = false;
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const id = rpc.mock.calls[0][1].p_lecture_id as string;
    expect(upload.mock.calls.map((c) => c[0])).toEqual([`${id}/1.webp`, `${id}/2.webp`, `${id}/3.webp`, `${id}/4.webp`]);
    expect(rpc.mock.calls[0][1].p_slides.map((x: { image_path: string }) => x.image_path)).toEqual([`${id}/1.webp`, `${id}/4.webp`]);
    // The one that went up stays: nothing is taken out.
    expect(remove).not.toHaveBeenCalled();
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
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(remove).not.toHaveBeenCalled();
  });
});

// Marko, hand test 2: "Start lecture, and then it uploads again, which kind of sucks." The
// slides go up in the background as soon as they are made; Start lecture only creates the lecture.
describe("StartForm background uploads", () => {
  type Deferred = { resolve: (v: unknown) => void };
  const later = () => {
    const d = {} as Deferred;
    const promise = new Promise((r) => (d.resolve = r));
    return { d, promise };
  };
  const paths = () => upload.mock.calls.map((c) => c[0] as string);
  const names = () => paths().map((p) => p.split("/")[1]);

  it("uploads every slide as soon as the PDF is picked, so Start lecture only creates the lecture", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp"), blob("image/webp")], firstLines: ["a", "b", "c"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 slides ready"));
    expect(screen.getAllByText("3 slides ready")).toHaveLength(2);
    expect(names()).toEqual(["1.webp", "2.webp", "3.webp"]);
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    // Nothing more went up after the press.
    expect(upload).toHaveBeenCalledTimes(3);
    const id = rpc.mock.calls[0][1].p_lecture_id as string;
    expect(paths()).toEqual([`${id}/1.webp`, `${id}/2.webp`, `${id}/3.webp`]);
    expect(screen.queryByRole("progressbar", { name: "Uploading slides" })).toBeNull();
  });

  it("each page goes up while the next one renders, with one bar on the file's card that only grows", async () => {
    const pages = [blob("image/webp"), blob("image/webp"), blob("image/webp")];
    renderPdf.mockImplementation((_f: File, onProgress: (d: number, t: number) => void, onPage: (b: Blob, i: number) => void) => {
      onPage(pages[0], 0);
      onProgress(1, 3);
      return new Promise(() => {});
    });
    const sent = later();
    upload.mockReturnValueOnce(sent.promise);
    render(<StartForm courseId={COURSE} existingCount={0} />);
    choose();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][1]).toBe(pages[0]);
    const bar = screen.getByRole("progressbar", { name: "Preparing slides" });
    // Pages made plus pages sent, out of twice the pages.
    expect(bar).toHaveAttribute("aria-valuemax", "6");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuetext", "Preparing slide 1 of 3");
    await act(async () => sent.d.resolve({ data: {}, error: null }));
    expect(screen.getByRole("progressbar", { name: "Preparing slides" })).toHaveAttribute("aria-valuenow", "2");
  });

  it("after preparing, the card says how many are up until they all are", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["", ""] });
    const second = later();
    upload.mockResolvedValueOnce({ data: {}, error: null }).mockReturnValueOnce(second.promise);
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 of 2"));
    const bar = screen.getByRole("progressbar", { name: "Uploading slides.pdf" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByText("2 slides")).toBeInTheDocument();
    // Start lecture is already on: pressing it would wait for the last one.
    expect(startButton()).toBeEnabled();
    await act(async () => second.d.resolve({ data: {}, error: null }));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("2 slides ready");
  });

  it("a press while uploads are still running waits for them, then creates the lecture", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["", ""] });
    const last = later();
    upload.mockResolvedValueOnce({ data: {}, error: null }).mockReturnValueOnce(last.promise);
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady();
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Uploading slides" })).toHaveAttribute("aria-valuenow", "1"));
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => last.d.resolve({ data: {}, error: null }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("Remove takes the PDF's images back out of storage", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/jpeg")], firstLines: ["", ""] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("week8.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 slides ready"));
    fireEvent.click(screen.getByRole("button", { name: "Remove week8.pdf" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect([...remove.mock.calls[0][0]].sort()).toEqual([...paths()].sort());
  });

  it("an image that lands after its PDF was removed is taken out too", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    const landing = later();
    upload.mockReturnValueOnce(landing.promise);
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("week8.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Remove week8.pdf" }));
    expect(remove).not.toHaveBeenCalled();
    await act(async () => landing.d.resolve({ data: {}, error: null }));
    expect(remove).toHaveBeenCalledWith([paths()[0]]);
  });

  it("Replace takes the old PDF's images out once the new one is prepared, and the new ones go up under new names", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["old", "old"] })
      .mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["new"] });
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("draft.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 slides ready"));
    const old = paths();
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Replace draft.pdf" }));
    choose("final.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 slide ready"));
    expect([...remove.mock.calls[0][0]].sort()).toEqual([...old].sort());
    expect(names()).toEqual(["1.webp", "2.webp", "3.webp"]);
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const id = rpc.mock.calls[0][1].p_lecture_id as string;
    expect(rpc.mock.calls[0][1].p_slides).toEqual([{ number: 1, image_path: `${id}/3.webp`, first_line: "new" }]);
  });

  it("a Replace that could not be read keeps the old PDF and its images", async () => {
    renderPdf
      .mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["a"] })
      .mockRejectedValueOnce(new NotPdfError());
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("draft.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 slide ready"));
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Replace draft.pdf" }));
    choose("photo.png");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("removing a Replace still being prepared takes out the images of the PDF it was replacing too", async () => {
    renderPdf.mockResolvedValueOnce({ blobs: [blob("image/webp")], firstLines: ["a"] }).mockReturnValueOnce(new Promise(() => {}));
    render(<StartForm courseId={COURSE} existingCount={0} />);
    await chooseReady("draft.pdf");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 slide ready"));
    const input = screen.getByLabelText("PDF file") as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Replace draft.pdf" }));
    choose("final.pdf");
    fireEvent.click(await screen.findByRole("button", { name: "Remove final.pdf" }));
    expect(remove).toHaveBeenCalledWith(paths());
    expect(screen.getByText("Drop the slides PDF here")).toBeInTheDocument();
  });
});

// Next keeps a visited page alive but hidden (React Activity) and shows it again with its
// state, on Back or on the next Start lecture. Marko: "when I go back the lecture ... loads
// forever and I can't start it" and "it had my old file". The form must come back fresh.
describe("StartForm shown again after a start", () => {
  const at = (mode: "visible" | "hidden", existingCount = 2) => (
    <Activity mode={mode}>
      <StartForm courseId={COURSE} existingCount={existingCount} />
    </Activity>
  );

  it("is a fresh form: no old file, no finished upload, Start lecture waiting for a new PDF", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp"), blob("image/webp")], firstLines: ["", ""] });
    const view = render(at("visible"));
    await chooseReady("week3.pdf");
    fireEvent.change(nameField(), { target: { value: "Week 3" } });
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    // Left as it was when the projector opened: the slides up, Start lecture disabled.
    expect(screen.getByTestId("start-status")).toHaveTextContent("2 slides ready");
    expect(startButton()).toBeDisabled();

    view.rerender(at("hidden"));
    await act(async () => {});
    view.rerender(at("visible"));

    expect(screen.queryByText("week3.pdf")).toBeNull();
    expect(screen.getByText("Drop the slides PDF here")).toBeInTheDocument();
    expect(screen.getByTestId("start-status")).toHaveTextContent("");
    expect(nameField()).toBeEnabled();
    expect(nameField().value).toMatch(/^Lecture 3, /);
    expect(refresh).toHaveBeenCalledTimes(1);
    // And it starts again with a new PDF, as a new lecture: its images go into a new folder.
    await chooseReady("week4.pdf");
    expect(startButton()).toBeEnabled();
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    const [first, second] = rpc.mock.calls.map((c) => c[1].p_lecture_id as string);
    expect(second).not.toBe(first);
    expect(rpc.mock.calls[1][1].p_slides.map((x: { image_path: string }) => x.image_path)).toEqual([`${second}/1.webp`, `${second}/2.webp`]);
  });

  it("the refreshed count names the next lecture after the one just started", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    const view = render(at("visible", 2));
    await chooseReady();
    fireEvent.click(startButton());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    view.rerender(at("hidden", 2));
    await act(async () => {});
    view.rerender(at("visible", 2));
    // The server's count arrives after the refresh.
    view.rerender(at("visible", 3));
    await waitFor(() => expect(nameField().value).toMatch(/^Lecture 4, /));
  });

  it("a PDF still being prepared when the page was hidden starts preparing again when it is shown", async () => {
    let calls = 0;
    renderPdf.mockImplementation((_file: File, onProgress: (d: number, t: number) => void) => {
      calls++;
      if (calls === 1) {
        onProgress(1, 3);
        // The first render is stopped at its next page when the page is hidden.
        return new Promise((_resolve, reject) => setTimeout(() => {
          try {
            onProgress(2, 3);
          } catch (e) {
            reject(e);
          }
        }, 20));
      }
      return Promise.resolve({ blobs: [blob("image/webp"), blob("image/webp"), blob("image/webp")], firstLines: ["", "", ""] });
    });
    const view = render(at("visible"));
    choose("long.pdf");
    await waitFor(() => expect(screen.getByTestId("start-status")).toHaveTextContent("Preparing slide 1 of 3"));
    view.rerender(at("hidden"));
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    view.rerender(at("visible"));
    await waitFor(() => expect(startButton()).toBeEnabled());
    expect(renderPdf).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("start-status")).toHaveTextContent("3 slides ready");
  });

  it("is left alone when it is shown again without a start (the teacher went to look at something)", async () => {
    renderPdf.mockResolvedValue({ blobs: [blob("image/webp")], firstLines: [""] });
    const view = render(at("visible"));
    await chooseReady("keep.pdf");
    view.rerender(at("hidden"));
    await act(async () => {});
    view.rerender(at("visible"));
    expect(screen.getByText("keep.pdf")).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
