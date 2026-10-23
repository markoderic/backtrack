import { describe, it, expect, vi } from "vitest";
import { SlideUploads } from "./slideUploads";

const image = (type = "image/webp") => new Blob(["x"], { type });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(parallel = 2) {
  const waiting: { path: string; done: (ok: boolean) => void }[] = [];
  const upload = vi.fn(
    (path: string) =>
      new Promise<void>((resolve, reject) => {
        waiting.push({ path, done: (ok) => (ok ? resolve() : reject(new Error("nope"))) });
      }),
  );
  const remove = vi.fn();
  const onChange = vi.fn();
  let ids = 0;
  const uploads = new SlideUploads({ upload, remove }, onChange, parallel, () => `lecture-${++ids}`);
  /** Finishes the oldest upload still waiting. */
  const finish = async (ok = true) => {
    waiting.shift()!.done(ok);
    await tick();
  };
  return { uploads, upload, remove, onChange, waiting, finish };
}

describe("SlideUploads", () => {
  it("uploads into the lecture's folder with a new number per image, a few at a time", async () => {
    const { uploads, upload, finish } = setup(2);
    uploads.begin(1);
    uploads.setTotal(1, 3);
    uploads.add(1, 0, image());
    uploads.add(1, 1, image("image/jpeg"));
    uploads.add(1, 2, image());
    expect(upload.mock.calls.map((c) => c[0])).toEqual(["lecture-1/1.webp", "lecture-1/2.jpg"]);
    await finish();
    expect(upload.mock.calls.map((c) => c[0])).toEqual(["lecture-1/1.webp", "lecture-1/2.jpg", "lecture-1/3.webp"]);
    await finish();
    await finish();
    expect(uploads.complete([1])).toBe(true);
    expect(uploads.paths(1)).toEqual(["lecture-1/1.webp", "lecture-1/2.jpg", "lecture-1/3.webp"]);
    expect(uploads.progress(1)).toEqual({ done: 3, total: 3, failed: 0, pending: 0 });
  });

  it("adds a page once", () => {
    const { uploads, upload } = setup(4);
    uploads.begin(1);
    const page = image();
    uploads.add(1, 0, page);
    uploads.add(1, 0, page);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("is not complete before the page count is known or while a page is missing", async () => {
    const { uploads, finish } = setup(4);
    uploads.begin(1);
    uploads.add(1, 0, image());
    await finish();
    expect(uploads.complete([1])).toBe(false);
    uploads.setTotal(1, 2);
    expect(uploads.complete([1])).toBe(false);
  });

  it("discard takes out what went up, drops what is queued, and takes out what lands later", async () => {
    const { uploads, upload, remove, finish } = setup(1);
    uploads.begin(1);
    uploads.setTotal(1, 3);
    uploads.add(1, 0, image());
    uploads.add(1, 1, image());
    uploads.add(1, 2, image());
    await finish(); // 1 is up, 2 is on its way, 3 waits
    uploads.discard(1);
    expect(remove).toHaveBeenCalledWith(["lecture-1/1.webp"]);
    await finish(); // 2 lands after the discard
    expect(remove).toHaveBeenLastCalledWith(["lecture-1/2.webp"]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(uploads.progress(1)).toEqual({ done: 0, total: 0, failed: 0, pending: 0 });
  });

  it("begin again on the same key starts over (a render that was stopped and started again)", async () => {
    const { uploads, remove, finish } = setup(4);
    uploads.begin(1);
    uploads.add(1, 0, image());
    await finish();
    uploads.begin(1);
    expect(remove).toHaveBeenCalledWith(["lecture-1/1.webp"]);
    uploads.add(1, 0, image());
    expect(uploads.progress(1).pending).toBe(1);
  });

  it("retries a failed upload once in the background under a new name, then waits for Start", async () => {
    const { uploads, upload, finish } = setup(4);
    uploads.begin(1);
    uploads.setTotal(1, 1);
    uploads.add(1, 0, image());
    await finish(false);
    expect(upload.mock.calls.map((c) => c[0])).toEqual(["lecture-1/1.webp", "lecture-1/2.webp"]);
    await finish(false);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(uploads.progress(1)).toEqual({ done: 0, total: 1, failed: 1, pending: 0 });
    // Start: tried again, and settle says when it is all up.
    const settled = uploads.settle([1]);
    expect(upload.mock.calls[2][0]).toBe("lecture-1/3.webp");
    await finish();
    await expect(settled).resolves.toBe(true);
    expect(uploads.paths(1)).toEqual(["lecture-1/3.webp"]);
  });

  it("settle says false when an image still does not go up", async () => {
    const { uploads, finish } = setup(4);
    uploads.begin(1);
    uploads.setTotal(1, 1);
    uploads.add(1, 0, image());
    await finish(false);
    await finish(false);
    const settled = uploads.settle([1]);
    await finish(false);
    await finish(false);
    await expect(settled).resolves.toBe(false);
  });

  it("settle waits only for the PDFs it is asked about", async () => {
    const { uploads, finish } = setup(4);
    uploads.begin(1);
    uploads.setTotal(1, 1);
    uploads.add(1, 0, image());
    await finish();
    uploads.begin(2);
    uploads.add(2, 0, image()); // stays on its way
    await expect(uploads.settle([1])).resolves.toBe(true);
  });

  it("redo puts everything up again under new names and takes out the old ones", async () => {
    const { uploads, upload, remove, finish } = setup(4);
    uploads.begin(1);
    uploads.setTotal(1, 2);
    uploads.add(1, 0, image());
    uploads.add(1, 1, image("image/jpeg"));
    await finish();
    await finish();
    uploads.redo([1]);
    expect(remove).toHaveBeenCalledWith(["lecture-1/1.webp", "lecture-1/2.jpg"]);
    expect(upload.mock.calls.slice(2).map((c) => c[0])).toEqual(["lecture-1/3.webp", "lecture-1/4.jpg"]);
    expect(uploads.complete([1])).toBe(false);
    await finish();
    await finish();
    expect(uploads.paths(1)).toEqual(["lecture-1/3.webp", "lecture-1/4.jpg"]);
  });

  it("reset (after a start) forgets the images without taking them out and takes a new folder", async () => {
    const { uploads, upload, remove, finish } = setup(4);
    expect(uploads.lectureId).toBe("lecture-1");
    uploads.begin(1);
    uploads.add(1, 0, image());
    await finish();
    uploads.reset();
    expect(remove).not.toHaveBeenCalled();
    expect(uploads.lectureId).toBe("lecture-2");
    uploads.begin(2);
    uploads.add(2, 0, image());
    expect(upload.mock.calls[1][0]).toBe("lecture-2/1.webp");
  });

  it("tells the form to draw again as things change", async () => {
    const { uploads, onChange, finish } = setup(4);
    uploads.begin(1);
    uploads.add(1, 0, image());
    const calls = onChange.mock.calls.length;
    await finish();
    expect(onChange.mock.calls.length).toBeGreaterThan(calls);
  });
});
