import { createServerSupabase } from "@/lib/supabase/server";
import { isGoogleSlidesId, nameFromDisposition } from "@/lib/slides/googleSlides";

/** A deck bigger than this is not fetched. */
const MAX_BYTES = 150 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * A Google Slides deck as a PDF, for the start form: /teach/google-slides?id=<file id>. Google's
 * export does not answer the browser directly (no CORS), so this fetches it and streams it through
 * (streamed, so Vercel's 4.5 MB body limit does not apply). Only for a signed in teacher, and only
 * ever to docs.google.com with an id that looks like one, so it is not an open proxy. The deck must
 * be shared as Anyone with the link; a private one comes back as Google's sign in page, which is
 * refused here as not_shared.
 */
export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out");

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isGoogleSlidesId(id)) return fail(400, "bad_id");

  let upstream: Response;
  try {
    upstream = await fetch(`https://docs.google.com/presentation/d/${id}/export/pdf`, {
      redirect: "follow",
      headers: { Accept: "application/pdf" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return fail(502, "unreachable");
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !type.toLowerCase().startsWith("application/pdf") || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    return fail(404, "not_shared");
  }
  const length = Number(upstream.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    await upstream.body.cancel().catch(() => {});
    return fail(413, "too_big");
  }

  const headers = new Headers({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store" });
  const name = nameFromDisposition(upstream.headers.get("content-disposition"));
  if (name) headers.set("X-Slides-Name", encodeURIComponent(name));
  return new Response(upstream.body, { status: 200, headers });
}
