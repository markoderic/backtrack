// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser } }) }));

import { GET } from "./route";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab";
const call = (id: string | null = ID) => GET(new Request(`http://localhost/teach/google-slides${id === null ? "" : `?id=${encodeURIComponent(id)}`}`));
const fetchMock = vi.fn();

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "t1" } } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /teach/google-slides", () => {
  it("is only for a signed in teacher", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an id that is not one, and never fetches anything else", async () => {
    for (const id of [null, "short", "../../x", `${ID}/../../x`]) {
      expect((await call(id)).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks only Google's PDF export for that id, and streams the PDF back with the deck's name", async () => {
    fetchMock.mockResolvedValue(
      new Response("%PDF-1.7 deck", {
        headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Week 8 slides.pdf"' },
      }),
    );
    const res = await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://docs.google.com/presentation/d/${ID}/export/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(decodeURIComponent(res.headers.get("x-slides-name") ?? "")).toBe("Week 8 slides");
    expect(await res.text()).toBe("%PDF-1.7 deck");
  });

  it("calls a deck that is not shared (Google's sign in page) not_shared", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }));
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_shared" });
  });

  it("calls a missing deck not_shared too", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404, headers: { "content-type": "text/html" } }));
    expect((await call()).status).toBe(404);
  });

  it("says 502 when Google cannot be reached, and 413 for a deck that is too big", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await call()).status).toBe(502);
    fetchMock.mockResolvedValueOnce(
      new Response("%PDF", { headers: { "content-type": "application/pdf", "content-length": String(200 * 1024 * 1024) } }),
    );
    expect((await call()).status).toBe(413);
  });
});
