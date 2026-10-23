"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { defaultLectureName } from "@/lib/lectureName";
import { renderPdf, NotPdfError, PasswordPdfError } from "@/lib/pdf/renderPdf";
import { ButtonPrimary, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { fieldClass, labelClass } from "../../../ui";
import { cleanupOrphanUploads } from "../../../lecture-actions";
import { SlideUploads } from "./slideUploads";

const NAME_MAX = 120;
const UPLOAD_PARALLEL = 4;
const THUMBS = 6;

class UploadError extends Error {}
class StartError extends Error {}

/**
 * One picked PDF. Its pages are turned into images as soon as it is picked (Figma 33:1014, "so
 * the progress is real"), and each image is uploaded in the background as soon as it is made
 * (Marko, hand test 2), with the progress on the file's card. Start lecture then only waits for
 * any upload still running (and shows it) and creates the lecture in one database call (D5: no
 * live lecture with a missing slide). A second PDF ("Add another PDF") adds its pages after the
 * first one's, in the order shown.
 */
type Part = {
  key: number;
  file: File;
  prep:
    | { status: "preparing"; done: number; total: number }
    | { status: "ready"; blobs: Blob[]; firstLines: string[] };
};

/** Where the next file the picker hands back goes: after the others, or in place of one. */
type PickTarget = { mode: "add" } | { mode: "replace"; key: number };

/** 4404019 -> "4.2 MB", 912345 -> "891 KB". */
function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const slidesWord = (n: number) => `${n} ${n === 1 ? "slide" : "slides"}`;

function ProgressBar({
  done,
  total,
  label,
  text,
  className = "w-full",
}: {
  done: number;
  total: number;
  label: string;
  /** The words for the value, when the numbers alone are not what it means. */
  text?: string;
  className?: string;
}) {
  const part = total > 0 ? Math.min(1, done / total) : 0;
  // Indeterminate (no value) until the page count is known.
  const value =
    total > 0 ? { "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done, "aria-valuetext": text } : {};
  return (
    <div
      role="progressbar"
      aria-label={label}
      {...value}
      className={`h-1.5 overflow-hidden rounded-[3px] bg-hairline ${className}`}
    >
      {/* Grows with transform only (no width animation), from the left. */}
      <div
        className="h-full w-full origin-left rounded-[3px] bg-ink transition-transform duration-(--dur-base) ease-out"
        style={{ transform: `scaleX(${part})` }}
      />
    </div>
  );
}

/**
 * A preview of one prepared slide. Its blob url lives only while the image is on screen: made
 * before paint, let go when the image goes (and made again if Next shows the kept-alive page again).
 */
function SlidePreview({ blob, ...props }: { blob: Blob } & ImgHTMLAttributes<HTMLImageElement>) {
  const img = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (!img.current || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(blob);
    img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- a local blob preview; alt comes in props
  return <img ref={img} {...props} />;
}

export function StartForm({ courseId, existingCount }: { courseId: string; existingCount: number }) {
  const router = useRouter();
  const [parts, setParts] = useState<Part[]>([]);
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The background uploads. They live in state (made once), and tell the form to draw again.
  const [, setUploadTick] = useState(0);
  const [uploads] = useState(
    () =>
      new SlideUploads(
        {
          upload: async (path, image) => {
            const { error: uploadError } = await createBrowserSupabase()
              .storage.from("slides")
              .upload(path, image, { contentType: image.type, upsert: false });
            if (uploadError) throw new UploadError(uploadError.message);
          },
          remove: (paths) => {
            try {
              void Promise.resolve(createBrowserSupabase().storage.from("slides").remove(paths)).catch(() => {});
            } catch {
              // Left for the day old cleanup.
            }
          },
        },
        () => setUploadTick((n) => n + 1),
        UPLOAD_PARALLEL,
      ),
  );
  const [dragging, setDragging] = useState(false);
  const touchedName = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<PickTarget>({ mode: "add" });
  const nextKey = useRef(0);
  // The PDFs being prepared right now. A removed or replaced PDF's render (or every render, when
  // the page is hidden or goes away) is ignored and stopped at its next page.
  const alive = useRef(new Set<number>());
  // A PDF being prepared as a Replace, by its key: the part it replaces, put back if it fails.
  const replaced = useRef(new Map<number, Part>());
  const partsNow = useRef<Part[]>([]);
  useEffect(() => {
    partsNow.current = parts;
  });
  // A start went through and the projector opened. Next keeps this page alive (hidden) after
  // it, with its state; shown again (Back, or Start lecture for the next class) it must be a
  // fresh form, not the last start's PDFs and its finished upload with Start lecture disabled.
  const started = useRef(false);

  // Filled in after mount so the date is the teacher's own, not the server's.
  useEffect(() => {
    if (!touchedName.current) setName(defaultLectureName(existingCount, new Date()));
  }, [existingCount]);

  // Clears this teacher's slide images left over from a start that failed or was left halfway
  // more than a day ago (best effort, in the background; nothing waits on it).
  useEffect(() => {
    void cleanupOrphanUploads().catch(() => {});
  }, []);

  // Shown again after a start: a fresh form (before paint, so the old upload never flashes),
  // and the page's data read again so the name counts the lecture just started.
  useLayoutEffect(() => {
    if (!started.current) return;
    started.current = false;
    alive.current.clear();
    replaced.current.clear();
    uploads.reset();
    touchedName.current = false;
    setParts([]);
    setStarting(false);
    setError(null);
    setDragging(false);
    setName(defaultLectureName(existingCount, new Date()));
    router.refresh();
  }, [existingCount, router, uploads]);

  // Hidden (Next keeps the page alive) or gone: every render still going stops at its next page,
  // so a long PDF does not keep the laptop busy for a page nobody sees. Shown again with a PDF that
  // was still being prepared: that PDF starts preparing again, so it is never stuck halfway.
  useEffect(() => {
    for (const part of partsNow.current) {
      if (part.prep.status === "preparing" && !alive.current.has(part.key)) {
        alive.current.add(part.key);
        void prepare(part.key, part.file);
      }
    }
    const running = alive.current;
    return () => running.clear();
    // Only when the page is shown and hidden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (key: number, prep: Part["prep"]) =>
    setParts((list) => list.map((p) => (p.key === key ? { ...p, prep } : p)));

  async function prepare(key: number, file: File) {
    // A fresh run: anything an earlier run of this PDF put up (a render stopped when the page was
    // hidden) goes, and its pages go up again as they are made.
    uploads.begin(key);
    try {
      const result = await renderPdf(
        file,
        (done, total) => {
          // Throwing here stops the render at this page (renderPdf cleans up in its finally).
          if (!alive.current.has(key)) throw new Error("cancelled");
          uploads.setTotal(key, total);
          update(key, { status: "preparing", done, total });
        },
        // Each page uploads as soon as it is made, while the next one renders.
        (image, index) => {
          if (alive.current.has(key)) uploads.add(key, index, image);
        },
      );
      if (!alive.current.has(key)) return;
      alive.current.delete(key);
      uploads.setTotal(key, result.blobs.length);
      // Any page not handed over yet goes up now (added once; the rest are already on their way).
      result.blobs.forEach((image, index) => uploads.add(key, index, image));
      update(key, { status: "ready", blobs: result.blobs, firstLines: result.firstLines });
      // A Replace that worked: the PDF it replaced, and its images, go.
      const before = replaced.current.get(key);
      if (before) uploads.discard(before.key);
      replaced.current.delete(key);
    } catch (e) {
      if (!alive.current.has(key)) return;
      alive.current.delete(key);
      // A file that could not be read: whatever it put up goes.
      uploads.discard(key);
      // A Replace that could not be read puts the PDF it was replacing back in its place
      // (batch A review M3), instead of leaving the teacher with neither.
      const old = replaced.current.get(key);
      replaced.current.delete(key);
      if (old) {
        setParts((list) => list.map((p) => (p.key === key ? old : p)));
        if (old.prep.status !== "ready") {
          alive.current.add(old.key);
          void prepare(old.key, old.file);
        }
      } else {
        setParts((list) => list.filter((p) => p.key !== key));
      }
      if (e instanceof NotPdfError || e instanceof PasswordPdfError) setError(e.message);
      else setError("Could not read that PDF. Try again.");
    }
  }

  /** New PDFs go after the others; a replaced one keeps its place in the order. */
  function pick(files: FileList | File[] | null | undefined, target: PickTarget = { mode: "add" }) {
    const picked = Array.from(files ?? []);
    if (picked.length === 0 || starting) return;
    setError(null);
    const fresh = (target.mode === "replace" ? picked.slice(0, 1) : picked).map((file) => {
      const key = ++nextKey.current;
      alive.current.add(key);
      return { key, file, prep: { status: "preparing", done: 0, total: 0 } } as Part;
    });
    if (target.mode === "replace") {
      const old = partsNow.current.find((p) => p.key === target.key);
      if (old) replaced.current.set(fresh[0].key, old);
      alive.current.delete(target.key);
      setParts((list) => (list.some((p) => p.key === target.key) ? list.map((p) => (p.key === target.key ? fresh[0] : p)) : [...list, ...fresh]));
    } else {
      setParts((list) => [...list, ...fresh]);
    }
    for (const part of fresh) void prepare(part.key, part.file);
  }

  function openPicker(target: PickTarget) {
    pickTarget.current = target;
    if (fileInput.current) fileInput.current.multiple = target.mode === "add";
    fileInput.current?.click();
  }

  function removePart(key: number) {
    alive.current.delete(key);
    // Its images go, and so do those of the PDF it was replacing, if that one was still waiting.
    const before = replaced.current.get(key);
    if (before) uploads.discard(before.key);
    replaced.current.delete(key);
    uploads.discard(key);
    setParts((list) => list.filter((p) => p.key !== key));
    setError(null);
  }

  const ready = parts.length > 0 && parts.every((p) => p.prep.status === "ready");
  const readyParts = ready ? (parts.map((p) => p.prep) as Extract<Part["prep"], { status: "ready" }>[]) : [];
  const totalSlides = readyParts.reduce((n, p) => n + p.blobs.length, 0);
  const thumbs = readyParts.flatMap((p) => p.blobs).slice(0, THUMBS);
  const keys = parts.map((p) => p.key);
  // Every page of every PDF is in storage: Start lecture only has to create the lecture.
  const uploaded = ready && uploads.complete(keys);
  // All the uploads together, for the line next to Start lecture while it waits for them.
  const sent = parts.reduce(
    (sum, p) => {
      const u = uploads.progress(p.key);
      const total = p.prep.status === "ready" ? p.prep.blobs.length : u.total;
      return { done: sum.done + Math.min(u.done, total), total: sum.total + total };
    },
    { done: 0, total: 0 },
  );

  /** One D5 start: the slides in the order shown, each with the path its image went to. */
  function slidesForStart() {
    return readyParts
      .flatMap((p, i) => {
        const paths = uploads.paths(keys[i]);
        return p.blobs.map((_, page) => ({ image_path: paths[page], first_line: p.firstLines[page] ?? "" }));
      })
      .map((slide, i) => ({ number: i + 1, ...slide }));
  }

  async function start() {
    if (!ready || starting) return;
    const lectureName = name.trim();
    if (!lectureName) return;
    const startKeys = keys;

    setStarting(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const lectureId = uploads.lectureId;
    const create = () =>
      supabase.rpc("start_lecture", {
        p_lecture_id: lectureId,
        p_course_id: courseId,
        p_name: lectureName,
        p_slides: slidesForStart(),
      });
    try {
      // The images were made when the PDFs were picked and went up in the background: nothing
      // is rendered again. Any upload still running is waited for (shown next to the button),
      // and any that failed is tried once more.
      if (!(await uploads.settle(startKeys))) throw new UploadError("Some slides did not upload.");
      let { error: rpcError } = await create();
      if (rpcError && /missing_images/.test(rpcError.message ?? "")) {
        // The images are gone from storage (the day old cleanup ran while this form was left
        // open): they go up again, once, and the lecture is created with those.
        uploads.redo(startKeys);
        if (!(await uploads.settle(startKeys))) throw new UploadError("Some slides did not upload.");
        ({ error: rpcError } = await create());
      }
      if (rpcError) throw new StartError(rpcError.message);

      // Replace, not push: Back from the projector goes to the course (with the live lecture
      // and its Resume and End class), never to this form for a second start of the same class.
      started.current = true;
      router.replace(`/teach/l/${lectureId}/present`);
    } catch (e) {
      // The images stay in storage for the next try (Start again only creates the lecture).
      // A form that is never started is cleared by the day old cleanup.
      if (e instanceof UploadError) setError("Could not upload your slides. Try again.");
      else setError("Could not start the lecture. Try again.");
      setStarting(false);
    }
  }

  const preparing = parts.find((p) => p.prep.status === "preparing");
  const preparingText = (prep: { done: number; total: number }) =>
    prep.total > 0 ? `Preparing slide ${prep.done} of ${prep.total}` : "Preparing slides";
  const uploadText = `Uploading ${sent.done} of ${sent.total}`;
  // Some images did not go up and nothing is on its way: Start lecture tries them again.
  const stalled =
    !starting &&
    parts.some((p) => {
      const u = uploads.progress(p.key);
      return u.failed > 0 && u.pending === 0;
    });
  const stalledText = "Some slides did not upload. Start lecture tries again.";
  // One live region that is always there, so screen readers hear the progress as it changes.
  const status =
    preparing && preparing.prep.status === "preparing"
      ? preparingText(preparing.prep)
      : ready && !uploaded
        ? stalled
          ? stalledText
          : uploadText
        : ready
          ? `${slidesWord(totalSlides)} ready`
          : "";
  const busy = starting;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
      className="flex w-full flex-col gap-7"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="lecture-name" className={labelClass}>
          Name
        </label>
        <input
          id="lecture-name"
          value={name}
          maxLength={NAME_MAX}
          disabled={starting}
          onChange={(e) => {
            touchedName.current = true;
            setName(e.target.value);
          }}
          className={fieldClass}
        />
      </div>

      <div
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          if (!starting) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer?.files);
        }}
        className={
          "relative flex min-h-60 w-full flex-col rounded-md bg-surface transition-[border-color,outline-color] duration-(--dur-fast) ease-out " +
          "outline-0 outline-offset-4 outline-transparent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ink " +
          (parts.length > 0
            ? `border p-6 ${dragging ? "border-ink" : "border-hairline"}`
            : `border-[1.5px] border-dashed ${dragging ? "border-ink" : "border-strip"}`)
        }
      >
        <input
          id="pdf-file"
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="PDF file"
          multiple
          disabled={starting}
          onChange={(e) => {
            pick(e.target.files, pickTarget.current);
            pickTarget.current = { mode: "add" };
            e.target.multiple = true;
            // Lets the same file be picked again after Remove.
            e.target.value = "";
          }}
          className="sr-only"
        />

        {parts.length === 0 ? (
          <label
            htmlFor="pdf-file"
            className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <Icon name="upload" size={28} />
            <span className="type-body-strong text-ink">Drop the slides PDF here</span>
            {/* Looks like the white button; the whole area is the label that opens the picker. */}
            <span aria-hidden className={`${buttonSecondaryClass} pointer-events-none mt-1`}>
              Choose a file
            </span>
          </label>
        ) : (
          <div className="flex animate-fade-in flex-col gap-5">
            <ol className="flex flex-col gap-4">
              {parts.map((part, i) => (
                <li key={part.key} className="flex animate-fade-in flex-col gap-3">
                  <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      {parts.length > 1 && <span className="type-small-strong text-secondary">{i + 1}</span>}
                      <p className="min-w-0 truncate type-body-strong text-ink">{part.file.name}</p>
                      <p className="type-small whitespace-nowrap text-secondary">
                        {(() => {
                          const pages = part.prep.status === "ready" ? part.prep.blobs.length : part.prep.total;
                          return pages > 0 ? `${pages} ${pages === 1 ? "page" : "pages"}, ${fileSize(part.file.size)}` : fileSize(part.file.size);
                        })()}
                      </p>
                    </div>
                    {/* Off (not gone) while the lecture starts, so nothing moves under the pointer. */}
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Replace ${part.file.name}`}
                        disabled={busy}
                        onClick={() => openPicker({ mode: "replace", key: part.key })}
                        className={buttonSecondaryClass}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${part.file.name}`}
                        disabled={busy}
                        onClick={() => removePart(part.key)}
                        className={buttonSecondaryClass}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {(() => {
                    // Preparing, then uploading: one bar that only grows (pages made plus pages
                    // sent, out of twice the pages), and the words for what is happening now.
                    const u = uploads.progress(part.key);
                    if (part.prep.status === "preparing") {
                      const total = part.prep.total;
                      return (
                        <>
                          <ProgressBar
                            done={part.prep.done + Math.min(u.done, total)}
                            total={total * 2}
                            label="Preparing slides"
                            text={preparingText(part.prep)}
                          />
                          <p aria-hidden className="type-small text-secondary">
                            {preparingText(part.prep)}
                          </p>
                        </>
                      );
                    }
                    const total = part.prep.blobs.length;
                    if (u.done >= total || starting) return null;
                    if (u.failed > 0 && u.pending === 0) {
                      return (
                        <p data-testid="upload-stalled" className="flex items-center gap-2 type-small text-ink">
                          <Icon name="alert" size={18} />
                          {stalledText}
                        </p>
                      );
                    }
                    const text = `Uploading ${u.done} of ${total}`;
                    return (
                      <>
                        <ProgressBar done={total + u.done} total={total * 2} label={`Uploading ${part.file.name}`} text={text} />
                        <p aria-hidden className="type-small text-secondary">
                          {text}
                        </p>
                      </>
                    );
                  })()}
                </li>
              ))}
            </ol>

            {ready && (
              <div className="flex flex-col gap-3 border-t border-hairline pt-5">
                {thumbs.length > 0 && (
                  <div className="flex items-start gap-2">
                    {thumbs.map((blob, i) => (
                      <SlidePreview
                        key={i}
                        blob={blob}
                        alt={`Slide ${i + 1}`}
                        className="aspect-[104/59] h-auto w-26 min-w-0 shrink animate-pop-in rounded-sm bg-surface object-contain shadow-slide [animation-delay:calc(var(--i)*30ms)] motion-reduce:[animation-delay:0ms]"
                        style={{ "--i": i } as React.CSSProperties}
                      />
                    ))}
                    {totalSlides > thumbs.length && (
                      <span className="shrink-0 type-small text-secondary">+{totalSlides - thumbs.length}</span>
                    )}
                  </div>
                )}
                <p aria-hidden className="type-small text-secondary">
                  {uploaded ? `${slidesWord(totalSlides)} ready` : slidesWord(totalSlides)}
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => openPicker({ mode: "add" })}
              className={`${buttonSecondaryClass} w-fit`}
            >
              <Icon name="upload" size={18} />
              Add another PDF
            </button>
          </div>
        )}
      </div>

      <p role="status" aria-live="polite" data-testid="start-status" className="sr-only">
        {status}
      </p>

      {error && (
        <p role="alert" className="-mt-3 flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <ButtonPrimary type="submit" disabled={!ready || starting || name.trim() === ""} className="w-auto!">
          Start lecture
        </ButtonPrimary>
        {starting && !uploaded && (
          // Start waits for the uploads still running (D5), and says so next to the button.
          <div className="flex min-w-0 flex-1 basis-56 animate-fade-in items-center gap-3">
            <ProgressBar done={sent.done} total={sent.total} label="Uploading slides" className="w-40 shrink-0" />
            <p aria-hidden className="type-small whitespace-nowrap text-secondary">
              {uploadText}
            </p>
          </div>
        )}
      </div>
    </form>
  );
}
