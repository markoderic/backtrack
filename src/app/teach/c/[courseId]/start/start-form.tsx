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

const NAME_MAX = 120;
const UPLOAD_PARALLEL = 4;
const THUMBS = 6;

class UploadError extends Error {}
class StartError extends Error {}

/**
 * One picked PDF. Its pages are turned into images as soon as it is picked (Figma 33:1014, "so
 * the progress is real"); Start lecture waits until every PDF is ready, then only uploads those
 * same images (nothing is rendered twice) and creates the lecture in one database call (D5). A
 * second PDF ("Add another PDF") adds its pages after the first one's, in the order shown.
 */
type Part = {
  key: number;
  file: File;
  prep:
    | { status: "preparing"; done: number; total: number }
    | { status: "ready"; blobs: Blob[]; firstLines: string[] };
};

type Upload = { done: number; total: number } | null;

/** Where the next file the picker hands back goes: after the others, or in place of one. */
type PickTarget = { mode: "add" } | { mode: "replace"; key: number };

/** 4404019 -> "4.2 MB", 912345 -> "891 KB". */
function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const slidesWord = (n: number) => `${n} ${n === 1 ? "slide" : "slides"}`;

function ProgressBar({ done, total, label, className = "w-full" }: { done: number; total: number; label: string; className?: string }) {
  const part = total > 0 ? Math.min(1, done / total) : 0;
  // Indeterminate (no value) until the page count is known.
  const value = total > 0 ? { "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done } : {};
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
  const [upload, setUpload] = useState<Upload>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const touchedName = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<PickTarget>({ mode: "add" });
  const nextKey = useRef(0);
  // The PDFs being prepared right now. A removed or replaced PDF's render (or every render, when
  // the page is hidden or goes away) is ignored and stopped at its next page.
  const alive = useRef(new Set<number>());
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
    touchedName.current = false;
    setParts([]);
    setStarting(false);
    setUpload(null);
    setError(null);
    setDragging(false);
    setName(defaultLectureName(existingCount, new Date()));
    router.refresh();
  }, [existingCount, router]);

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
    try {
      const result = await renderPdf(file, (done, total) => {
        // Throwing here stops the render at this page (renderPdf cleans up in its finally).
        if (!alive.current.has(key)) throw new Error("cancelled");
        update(key, { status: "preparing", done, total });
      });
      if (!alive.current.has(key)) return;
      alive.current.delete(key);
      update(key, { status: "ready", blobs: result.blobs, firstLines: result.firstLines });
    } catch (e) {
      if (!alive.current.has(key)) return;
      alive.current.delete(key);
      setParts((list) => list.filter((p) => p.key !== key));
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
    setParts((list) => list.filter((p) => p.key !== key));
    setError(null);
  }

  const ready = parts.length > 0 && parts.every((p) => p.prep.status === "ready");
  const readyParts = ready ? (parts.map((p) => p.prep) as Extract<Part["prep"], { status: "ready" }>[]) : [];
  const totalSlides = readyParts.reduce((n, p) => n + p.blobs.length, 0);
  const thumbs = readyParts.flatMap((p) => p.blobs).slice(0, THUMBS);

  async function start() {
    if (!ready || starting) return;
    const lectureName = name.trim();
    if (!lectureName) return;
    // The images made when the PDFs were picked, in order: nothing is rendered again here.
    const blobs = readyParts.flatMap((p) => p.blobs);
    const firstLines = readyParts.flatMap((p) => p.blobs.map((_, i) => p.firstLines[i] ?? ""));

    setStarting(true);
    setError(null);
    const supabase = createBrowserSupabase();
    // The images that reached storage, so a start that fails can take them back out.
    const uploadedPaths: string[] = [];
    try {
      const lectureId = crypto.randomUUID();
      const slides = blobs.map((blob, i) => ({
        number: i + 1,
        image_path: `${lectureId}/${i + 1}.${blob.type === "image/webp" ? "webp" : "jpg"}`,
        first_line: firstLines[i] ?? "",
      }));

      let next = 0;
      let uploaded = 0;
      setUpload({ done: 0, total: blobs.length });
      const worker = async () => {
        while (next < blobs.length) {
          const i = next++;
          const { error: uploadError } = await supabase.storage
            .from("slides")
            .upload(slides[i].image_path, blobs[i], { contentType: blobs[i].type, upsert: false });
          if (uploadError) throw new UploadError(uploadError.message);
          uploadedPaths.push(slides[i].image_path);
          setUpload({ done: ++uploaded, total: blobs.length });
        }
      };
      // One failure stops the others from picking up more work.
      try {
        await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, blobs.length) }, worker));
      } catch (e) {
        next = blobs.length;
        throw e;
      }

      const { error: rpcError } = await supabase.rpc("start_lecture", {
        p_lecture_id: lectureId,
        p_course_id: courseId,
        p_name: lectureName,
        p_slides: slides,
      });
      if (rpcError) throw new StartError(rpcError.message);

      // Replace, not push: Back from the projector goes to the course (with the live lecture
      // and its Resume and End class), never to this form for a second start of the same class.
      started.current = true;
      router.replace(`/teach/l/${lectureId}/present`);
    } catch (e) {
      // No lecture uses these images (start_lecture never made one), so they go back out. Best
      // effort: anything left is removed by the cleanup a day later. Workers still uploading stop
      // at their next image; one that lands after this is left for that cleanup too.
      if (uploadedPaths.length > 0) {
        void supabase.storage
          .from("slides")
          .remove([...uploadedPaths])
          .catch(() => {});
      }
      if (e instanceof UploadError) setError("Could not upload your slides. Try again.");
      else if (e instanceof StartError) setError("Could not start the lecture. Try again.");
      else setError("Could not start the lecture. Try again.");
      setStarting(false);
      setUpload(null);
    }
  }

  const preparing = parts.find((p) => p.prep.status === "preparing");
  const preparingText = (prep: { done: number; total: number }) =>
    prep.total > 0 ? `Preparing slide ${prep.done} of ${prep.total}` : "Preparing slides";
  // The upload after Start, in words: the slides are not prepared again, they are sent.
  const uploadText = upload ? `Uploading ${upload.done} of ${upload.total}` : "";
  // One live region that is always there, so screen readers hear the progress as it changes.
  const status =
    starting && upload
      ? uploadText
      : preparing && preparing.prep.status === "preparing"
        ? preparingText(preparing.prep)
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
                  {part.prep.status === "preparing" && (
                    <>
                      <ProgressBar done={part.prep.done} total={part.prep.total} label="Preparing slides" />
                      <p aria-hidden className="type-small text-secondary">
                        {preparingText(part.prep)}
                      </p>
                    </>
                  )}
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
                  {slidesWord(totalSlides)} ready
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
        {starting && upload && (
          // The prepared slides are being sent, not prepared again: say so next to the button.
          <div className="flex min-w-0 flex-1 basis-56 animate-fade-in items-center gap-3">
            <ProgressBar done={upload.done} total={upload.total} label="Uploading slides" className="w-40 shrink-0" />
            <p aria-hidden className="type-small whitespace-nowrap text-secondary">
              {uploadText}
            </p>
          </div>
        )}
      </div>
    </form>
  );
}
