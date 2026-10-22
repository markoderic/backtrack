"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { defaultLectureName } from "@/lib/lectureName";
import { renderPdf, NotPdfError, PasswordPdfError } from "@/lib/pdf/renderPdf";

const NAME_MAX = 120;
const UPLOAD_PARALLEL = 4;

class UploadError extends Error {}
class StartError extends Error {}

type Progress = { phase: "Preparing" | "Uploading"; done: number; total: number } | null;

export function StartForm({ courseId, existingCount }: { courseId: string; existingCount: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const touchedName = useRef(false);

  // Filled in after mount so the date is the teacher's own, not the server's.
  useEffect(() => {
    if (!touchedName.current) setName(defaultLectureName(existingCount, new Date()));
  }, [existingCount]);

  function pick(files: FileList | null | undefined) {
    const next = files?.[0];
    if (next) {
      setFile(next);
      setError(null);
    }
  }

  async function start() {
    if (!file || busy) return;
    const lectureName = name.trim();
    if (!lectureName) return;

    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const { blobs, firstLines } = await renderPdf(file, (done, total) => setProgress({ phase: "Preparing", done, total }));

      const lectureId = crypto.randomUUID();
      const supabase = createBrowserSupabase();
      const slides = blobs.map((blob, i) => ({
        number: i + 1,
        image_path: `${lectureId}/${i + 1}.${blob.type === "image/webp" ? "webp" : "jpg"}`,
        first_line: firstLines[i] ?? "",
      }));

      let next = 0;
      let uploaded = 0;
      setProgress({ phase: "Uploading", done: 0, total: blobs.length });
      const worker = async () => {
        while (next < blobs.length) {
          const i = next++;
          const { error: uploadError } = await supabase.storage
            .from("slides")
            .upload(slides[i].image_path, blobs[i], { contentType: blobs[i].type, upsert: false });
          if (uploadError) throw new UploadError(uploadError.message);
          setProgress({ phase: "Uploading", done: ++uploaded, total: blobs.length });
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
      if (e instanceof NotPdfError || e instanceof PasswordPdfError) setError(e.message);
      else if (e instanceof UploadError) setError("Could not upload your slides. Try again.");
      else if (e instanceof StartError) setError("Could not start the lecture. Try again.");
      else setError("Could not read that PDF. Try again.");
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
      className="flex flex-col gap-6"
    >
      <div
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) pick(e.dataTransfer?.files);
        }}
        className={`flex flex-col items-start gap-3 border border-dashed border-current p-6 ${dragging ? "bg-black/5" : ""}`}
      >
        <p>Drop your PDF here</p>
        <input
          type="file"
          accept="application/pdf,.pdf"
          aria-label="PDF file"
          disabled={busy}
          onChange={(e) => pick(e.target.files)}
        />
        {file && <p>{file.name}</p>}
      </div>

      <label className="flex flex-col gap-1">
        Lecture name
        <input
          value={name}
          maxLength={NAME_MAX}
          disabled={busy}
          onChange={(e) => {
            touchedName.current = true;
            setName(e.target.value);
          }}
          className="w-full border border-current px-3 py-2"
        />
      </label>

      {error && <p role="alert">{error}</p>}

      {progress && (
        <div className="flex flex-col gap-2">
          <p>{`${progress.phase} slide ${progress.done} of ${progress.total}`}</p>
          <progress value={progress.done} max={progress.total} className="w-full" />
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !file || name.trim() === ""}
        className="self-start border border-current px-6 py-3 disabled:opacity-40"
      >
        Start lecture
      </button>
    </form>
  );
}
