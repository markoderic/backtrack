import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMark,
  deleteMark,
  loadLostMarks,
  loadMyMarks,
  lostMarkFromRow,
  markFromRow,
  setSlideMarksKind,
  updateMark,
} from "./marksApi";

type Res = { data?: unknown; error: { code?: string; message: string; status?: number } | null; status?: number };

const LECTURE = "11111111-1111-1111-1111-111111111111";
const ME = "44444444-4444-4444-4444-000000000001";
const MARK = "77777777-7777-7777-7777-000000000001";

// Every call on the client is recorded; a query is a chain that ends in `result`.
let calls: [string, ...unknown[]][] = [];
let result: Res | (() => Promise<Res>) = { data: [], error: null, status: 200 };
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "order", "update", "delete", "upsert", "insert"]) {
    c[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return c;
    };
  }
  c.then = (ok: (v: Res) => unknown, bad: (e: unknown) => unknown) =>
    (typeof result === "function" ? result() : Promise.resolve(result)).then(ok, bad);
  return c;
}
const client = {
  from: (t: string) => (calls.push(["from", t]), chain()),
  rpc: (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), chain()),
} as unknown as SupabaseClient;

const row = (o: Record<string, unknown> = {}) => ({
  id: MARK,
  lecture_id: LECTURE,
  anon_id: ME,
  slide_number: 4,
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.25,
  kind: "save",
  note: null,
  created_at: "2026-10-26T14:00:00Z",
  updated_at: "2026-10-26T14:01:00Z",
  ...o,
});

beforeEach(() => {
  calls = [];
  result = { data: [], error: null, status: 200 };
});

describe("reading marks", () => {
  it("loadMyMarks reads the student's own marks with their notes through my_slide_marks", async () => {
    result = { data: [row({ kind: "lost", note: "stuck here" }), row({ id: "m2", note: "  " }), row({ id: "bad", w: 0 })], error: null };
    const got = await loadMyMarks(client, LECTURE);
    expect(calls).toEqual([["rpc", "my_slide_marks", { p_lecture_id: LECTURE }]]);
    expect(got).toEqual({
      status: "ok",
      data: [
        {
          id: MARK,
          lectureId: LECTURE,
          slide: 4,
          rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
          kind: "lost",
          note: "stuck here",
          createdAt: "2026-10-26T14:00:00Z",
          updatedAt: "2026-10-26T14:01:00Z",
        },
        // A note of only spaces is no note; a row that is not a box inside the slide is skipped.
        expect.not.objectContaining({ note: expect.anything() }),
      ],
    });
  });

  it("loadMyMarks(null) asks for every lecture", async () => {
    await loadMyMarks(client, null);
    expect(calls).toEqual([["rpc", "my_slide_marks", { p_lecture_id: null }]]);
  });

  it("says missing before 0020, offline without a connection, and throws on anything else", async () => {
    result = { data: null, error: { code: "PGRST202", message: "Could not find the function" }, status: 404 };
    expect(await loadMyMarks(client, LECTURE)).toEqual({ status: "missing" });
    result = { data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 };
    expect(await loadLostMarks(client, LECTURE)).toEqual({ status: "missing" });
    result = { data: null, error: { code: "", message: "Failed to fetch" }, status: 0 };
    expect(await loadMyMarks(client, LECTURE)).toEqual({ status: "offline" });
    result = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await loadLostMarks(client, LECTURE)).toEqual({ status: "offline" });
    result = { data: null, error: { code: "42501", message: "permission denied for column note" }, status: 403 };
    await expect(loadLostMarks(client, LECTURE)).rejects.toThrow("permission denied for column note");
  });

  it("loadLostMarks (the teacher) asks for the box and whose, never the note, and only 'lost'", async () => {
    result = { data: [row({ kind: "lost" })], error: null };
    const got = await loadLostMarks(client, LECTURE);
    expect(calls[0]).toEqual(["from", "slide_marks"]);
    const select = calls.find((c) => c[0] === "select")!;
    expect(select[1]).toBe("id, anon_id, slide_number, x, y, w, h, created_at, updated_at");
    expect(String(select[1])).not.toContain("note");
    expect(calls).toContainEqual(["eq", "lecture_id", LECTURE]);
    expect(calls).toContainEqual(["eq", "kind", "lost"]);
    expect(got).toEqual({
      status: "ok",
      data: [
        {
          id: MARK,
          anonId: ME,
          slide: 4,
          rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
          createdAt: "2026-10-26T14:00:00Z",
          updatedAt: "2026-10-26T14:01:00Z",
        },
      ],
    });
  });

  it("markFromRow and lostMarkFromRow read Realtime records too, and skip what is not a mark", () => {
    expect(markFromRow(row())).toMatchObject({ id: MARK, kind: "save", slide: 4 });
    expect(markFromRow({ id: MARK })).toBeNull();
    expect(lostMarkFromRow(row({ kind: "lost" }))).toMatchObject({ id: MARK, anonId: ME });
    // The teacher's own read never selects kind (only 'lost' rows come back): no kind is fine.
    const { kind: _kind, ...noKind } = row();
    void _kind;
    expect(lostMarkFromRow(noKind)).toMatchObject({ id: MARK });
    expect(lostMarkFromRow({ id: MARK })).toBeNull();
    // A Realtime record that is not 'lost' (a race the database already settled) is not shown.
    expect(lostMarkFromRow(row({ kind: "save" }))).toBeNull();
    expect(lostMarkFromRow(row({ kind: "lost" }))).toMatchObject({ id: MARK });
    // A teacher's Realtime record has no note: nothing breaks.
    const { note: _note, ...noNote } = row({ kind: "lost" });
    void _note;
    expect(lostMarkFromRow(noNote)).toMatchObject({ id: MARK });
  });
});

describe("writing marks", () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.25 };

  it("addMark sends one row with the caller's id (a resend adds nothing) and lets the database fill in the student", async () => {
    result = { error: null, status: 201 };
    expect(await addMark(client, { id: MARK, lectureId: LECTURE, slide: 4, rect, kind: "save", note: "look" })).toBe("ok");
    const upsert = calls.find((c) => c[0] === "upsert")!;
    expect(upsert[1]).toEqual({ id: MARK, lecture_id: LECTURE, slide_number: 4, x: 0.1, y: 0.2, w: 0.3, h: 0.25, kind: "save", note: "look" });
    expect(upsert[2]).toEqual({ onConflict: "id", ignoreDuplicates: true });
    expect(upsert[1]).not.toHaveProperty("anon_id");
  });

  it("addMark leaves out an empty note and cuts one past 2000", async () => {
    result = { error: null, status: 201 };
    await addMark(client, { id: MARK, lectureId: LECTURE, slide: 4, rect, kind: "lost", note: "   " });
    expect(calls.find((c) => c[0] === "upsert")![1]).not.toHaveProperty("note");
    calls = [];
    await addMark(client, { id: MARK, lectureId: LECTURE, slide: 4, rect, kind: "lost", note: "n".repeat(2100) });
    expect((calls.find((c) => c[0] === "upsert")![1] as { note: string }).note).toHaveLength(2000);
  });

  it("cuts a long note by whole characters, never half an emoji", async () => {
    result = { error: null, status: 201 };
    await addMark(client, { id: MARK, lectureId: LECTURE, slide: 4, rect, kind: "lost", note: "😀".repeat(2005) });
    const note = (calls.find((c) => c[0] === "upsert")![1] as { note: string }).note;
    expect(Array.from(note)).toHaveLength(2000);
    expect(note.endsWith("😀")).toBe(true);
    calls = [];
    await updateMark(client, MARK, { note: "a" + "😀".repeat(2000) });
    const updated = (calls[1][1] as { note: string }).note;
    expect(Array.from(updated)).toHaveLength(2000);
    expect(/[\uD800-\uDBFF]$/.test(updated)).toBe(false);
  });

  it("addMark refuses a box outside the slide without asking the database", async () => {
    expect(await addMark(client, { id: MARK, lectureId: LECTURE, slide: 4, rect: { x: 0.9, y: 0, w: 0.2, h: 0.1 }, kind: "save" })).toBe("rejected");
    expect(calls).toEqual([]);
  });

  it("addMark tells the two limits apart, and says missing, offline or rejected", async () => {
    const add = () => addMark(client, { id: MARK, lectureId: LECTURE, slide: 4, rect, kind: "save" });
    result = { error: { code: "BT429", message: "Too many marks on this slide." }, status: 400 };
    expect(await add()).toBe("slide_full");
    result = { error: { code: "BT429", message: "Too many marks in this lecture." }, status: 400 };
    expect(await add()).toBe("lecture_full");
    result = { error: { code: "PGRST205", message: "Could not find the table" }, status: 404 };
    expect(await add()).toBe("missing");
    result = { error: { code: "", message: "Failed to fetch" }, status: 0 };
    expect(await add()).toBe("offline");
    result = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await add()).toBe("offline");
    result = { error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 };
    expect(await add()).toBe("rejected");
  });

  it("updateMark sends only what changed; an empty note clears it", async () => {
    result = { error: null, status: 204 };
    expect(await updateMark(client, MARK, { rect })).toBe("ok");
    expect(calls).toEqual([
      ["from", "slide_marks"],
      ["update", { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }],
      ["eq", "id", MARK],
    ]);
    calls = [];
    await updateMark(client, MARK, { note: "  ", kind: "lost" });
    expect(calls[1]).toEqual(["update", { note: null, kind: "lost" }]);
    calls = [];
    await updateMark(client, MARK, { note: "why?" });
    expect(calls[1]).toEqual(["update", { note: "why?" }]);
  });

  it("updateMark with nothing to change or a bad box sends nothing", async () => {
    expect(await updateMark(client, MARK, {})).toBe("ok");
    expect(await updateMark(client, MARK, { rect: { x: 0, y: 0, w: 0, h: 0.1 } })).toBe("rejected");
    expect(calls).toEqual([]);
  });

  it("setSlideMarksKind changes every mark of a slide in one request", async () => {
    result = { error: null, status: 204 };
    expect(await setSlideMarksKind(client, LECTURE, 4, "lost")).toBe("ok");
    expect(calls).toEqual([
      ["from", "slide_marks"],
      ["update", { kind: "lost" }],
      ["eq", "lecture_id", LECTURE],
      ["eq", "slide_number", 4],
      ["neq", "kind", "lost"],
    ]);
  });

  it("deleteMark deletes by id, and says missing before 0020", async () => {
    result = { error: null, status: 204 };
    expect(await deleteMark(client, MARK)).toBe("ok");
    expect(calls).toEqual([["from", "slide_marks"], ["delete"], ["eq", "id", MARK]]);
    result = { error: { code: "42P01", message: "relation does not exist" }, status: 404 };
    expect(await deleteMark(client, MARK)).toBe("missing");
  });
});
