"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { defaultLectureName } from "@/lib/lectureName";
import { renderPdf, NotPdfError, PasswordPdfError } from "@/lib/pdf/renderPdf";
import { ButtonPrimary } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { fieldClass, labelClass, textLinkClass } from "../../../ui";

const NAME_MAX = 120;
const UPLOAD_PARALLEL = 4;
const THUMBS = 6;

class UploadError extends Error {}
class StartError extends Error {}

/**
 * The slides are turned into images as soon as a PDF is picked (Figma 33:1014, "so the
 * progress is real"), and Start lecture stays disabled until every slide is ready. Start then
 * uploads the images and creates the lecture in one database call (D5), as before.
 */
type Prep =
  | { status: "idle" }
  | { status: "preparing"; done: number; total: number }
  | { status: "ready"; blobs: Blob[]; firstLines: string[]; thumbs: string[] };

type Upload = { done: number; total: number } | null;

/** 4404019 -> "4.2 MB", 912345 -> "891 KB". */
function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const part = total > 0 ? Math.min(1, done / total) : 0;
  // Indeterminate (no value) until the page count is known.
  const value = total > 0 ? { "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done } : {};
  return (
    <div
      role="progressbar"
      aria-label={label}
      {...value}
      className="h-1.5 w-full overflow-hidden rounded-[3px] bg-hairline"
    >
      {/* Grows with transform only (no width animation), from the left. */}
      <div
        className="h-full w-full origin-left rounded-[3px] bg-ink transition-transform duration-(--dur-base) ease-out"
        style={{ transform: `scaleX(${part})` }}
      />
    </div>
  );
}

export function StartForm({ courseId, existingCount }: { courseId: string; existingCount: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [prep, setPrep] = useState<Prep>({ status: "idle" });
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [upload, setUpload] = useState<Upload>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const touchedName = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Each picked file gets a new run; a cancelled or replaced run is ignored and stopped at its next page.
  const run = useRef(0);

  // Filled in after mount so the date is the teacher's own, not the server's.
  useEffect(() => {
    if (!touchedName.current) setName(defaultLectureName(existingCount, new Date()));
  }, [existingCount]);

  // The slide previews are blob urls; let them go when the slides are replaced or the page goes away.
  const thumbs = prep.status === "ready" ? prep.thumbs : null;
  useEffect(() => {
    if (!thumbs) return;
    return () => thumbs.forEach((u) => URL.revokeObjectURL(u));
  }, [thumbs]);

  // Stop a run that is still going when the page goes away.
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  async function prepare(next: File) {
    const mine = ++run.current;
    setFile(next);
    setError(null);
    setPrep({ status: "preparing", done: 0, total: 0 });
    try {
      const result = await renderPdf(next, (done, total) => {
        // Throwing here stops the render at this page (renderPdf cleans up in its finally).
        if (run.current !== mine) throw new Error("cancelled");
        setPrep({ status: "preparing", done, total });
      });
      if (run.current !== mine) return;
      // Small previews of the first slides.
      const previews =
        typeof URL.createObjectURL === "function" ? result.blobs.slice(0, THUMBS).map((b) => URL.createObjectURL(b)) : [];
      setPrep({ status: "ready", blobs: result.blobs, firstLines: result.firstLines, thumbs: previews });
    } catch (e) {
      if (run.current !== mine) return;
      setFile(null);
      setPrep({ status: "idle" });
      if (e instanceof NotPdfError || e instanceof PasswordPdfError) setError(e.message);
      else setError("Could not read that PDF. Try again.");
    }
  }

  function pick(files: FileList | null | undefined) {
    const next = files?.[0];
    if (next && !starting) void prepare(next);
  }

  function cancel() {
    run.current++;
    setFile(null);
    setPrep({ status: "idle" });
    setError(null);
  }

  async function start() {
    if (prep.status !== "ready" || starting) return;
    const lectureName = name.trim();
    if (!lectureName) return;
    const { blobs, firstLines } = prep;

    setStarting(true);
    setError(null);
    try {
      const lectureId = crypto.randomUUID();
      const supabase = createBrowserSupabase();
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

      router.push(`/teach/l/${lectureId}/present`);
    } catch (e) {
      if (e instanceof UploadError) setError("Could not upload your slides. Try again.");
      else if (e instanceof StartError) setError("Could not start the lecture. Try again.");
      else setError("Could not start the lecture. Try again.");
      setStarting(false);
      setUpload(null);
    }
  }

  const ready = prep.status === "ready";
  // One live region that is always there, so screen readers hear the progress as it changes.
  const status =
    starting && upload
      ? `Uploading slide ${upload.done} of ${upload.total}`
      : prep.status === "preparing"
        ? prep.total > 0
          ? `Preparing slide ${prep.done} of ${prep.total}`
          : "Preparing slides"
        : prep.status === "ready"
          ? `${prep.blobs.length} ${prep.blobs.length === 1 ? "slide" : "slides"} ready`
          : "";
  const pages = prep.status === "ready" ? prep.blobs.length : prep.status === "preparing" ? prep.total : 0;

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
          (file
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
          disabled={starting}
          onChange={(e) => {
            pick(e.target.files);
            // Lets the same file be picked again after Cancel.
            e.target.value = "";
          }}
          className="sr-only"
        />

        {!file ? (
          <label
            htmlFor="pdf-file"
            className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <Icon name="upload" size={28} />
            <span className="type-body-strong text-ink">Drop the slides PDF here</span>
            <span className="type-small text-ink underline decoration-from-font underline-offset-[3px]">
              or choose a file
            </span>
          </label>
        ) : (
          <div className="flex animate-fade-in flex-col gap-3">
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
              <p className="min-w-0 truncate type-body-strong text-ink">{file.name}</p>
              <p className="type-small whitespace-nowrap text-secondary">
                {pages > 0 ? `${pages} ${pages === 1 ? "page" : "pages"}, ${fileSize(file.size)}` : fileSize(file.size)}
              </p>
              <div className="min-w-0 flex-1" />
              {prep.status === "preparing" && (
                <button type="button" onClick={cancel} className={textLinkClass}>
                  Cancel
                </button>
              )}
              {ready && !starting && (
                <button type="button" onClick={() => fileInput.current?.click()} className={textLinkClass}>
                  Change file
                </button>
              )}
            </div>

            {prep.status === "preparing" && (
              <>
                <ProgressBar done={prep.done} total={prep.total} label="Preparing slides" />
                <p aria-hidden className="type-small text-secondary">
                  {prep.total > 0 ? `Preparing slide ${prep.done} of ${prep.total}` : "Preparing slides"}
                </p>
              </>
            )}

            {ready && starting && upload && (
              <>
                <ProgressBar done={upload.done} total={upload.total} label="Uploading slides" />
                <p aria-hidden className="type-small text-secondary">{`Uploading slide ${upload.done} of ${upload.total}`}</p>
              </>
            )}

            {ready && !starting && (
              <>
                {prep.thumbs.length > 0 && (
                  <div className="flex items-start gap-2">
                    {prep.thumbs.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
                      <img
                        key={src}
                        src={src}
                        alt={`Slide ${i + 1}`}
                        className="aspect-[104/59] h-auto w-26 min-w-0 shrink animate-pop-in rounded-sm bg-surface object-contain shadow-slide [animation-delay:calc(var(--i)*30ms)] motion-reduce:[animation-delay:0ms]"
                        style={{ "--i": i } as React.CSSProperties}
                      />
                    ))}
                    {prep.blobs.length > prep.thumbs.length && (
                      <span className="shrink-0 type-small text-secondary">+{prep.blobs.length - prep.thumbs.length}</span>
                    )}
                  </div>
                )}
                <p aria-hidden className="type-small text-secondary">
                  {prep.blobs.length} {prep.blobs.length === 1 ? "slide" : "slides"} ready
                </p>
              </>
            )}
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

      <div className="flex flex-wrap items-center gap-4">
        <ButtonPrimary type="submit" disabled={!ready || starting || name.trim() === ""} className="w-auto!">
          Start lecture
        </ButtonPrimary>
        {ready && !starting && (
          <p className="animate-fade-in type-small text-secondary">Opens the projector view with the join code.</p>
        )}
      </div>
    </form>
  );
}
