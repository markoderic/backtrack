// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";
import { rectFromDrag } from "../../src/lib/rect";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MARKO_COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LECTURE_A = "cccccccc-cccc-cccc-cccc-000000000001";
const LECTURE_B = "cccccccc-cccc-cccc-cccc-000000000002";
const CODE_A = "482916";
const CODE_B = "735018";

const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student = (n: number): Claims => ({
  sub: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
});
const s1 = student(1);
const s2 = student(2);
const stranger = student(3); // never joins anything

let db: PGlite;
let n = 0;
const tapId = () => `99999999-9999-9999-9999-${String(++n).padStart(12, "0")}`;

afterEach(async () => {
  await db.close();
});

beforeEach(async () => {
  n = 0;
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
    insert into public.courses (id, teacher_id, name) values
      ('${MARKO_COURSE}', '${MARKO}', 'IMS 452'),
      ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LECTURE_A}', '${MARKO_COURSE}', 'Lecture 1, Oct 26', '${CODE_A}', 'live', 2, 10),
      ('${LECTURE_B}', '${OTHER_COURSE}', 'Cells, Oct 26', '${CODE_B}', 'live', 1, 4);
  `);
  await join(s1, CODE_A);
  await join(s2, CODE_A);
});

const join = (claims: Claims, code: string) =>
  as(db, claims, () => db.query("select public.join_lecture($1)", [code]));

const rows = <T extends object>(claims: Claims | null, sql: string, params: unknown[] = []) =>
  as(db, claims, async () => (await db.query<T>(sql, params)).rows);

type Tap = {
  id?: string;
  lecture?: string;
  anon?: string;
  kind?: string;
  slide?: number;
  slideNumber?: number;
  note?: string | null;
  undone?: boolean;
  tappedAt?: string; // sql expression
  hl?: [number | null, number | null, number | null, number | null];
};

/** Inserts a tap as `claims`; the defaults are a valid tap by s1 on slide 3 of lecture A. */
const insertTapNow = (claims: Claims, t: Tap = {}) => insertTap(claims, t);
function insertTap(claims: Claims, t: Tap = {}) {
  const hl = t.hl ?? [null, null, null, null];
  const slide = t.slide ?? 3;
  return as(db, claims, () =>
    db.query(
      `insert into public.lost_taps
         (id, lecture_id, anon_id, kind, tapped_on_slide, slide_number, note, undone, hl_x, hl_y, hl_w, hl_h, tapped_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ${t.tappedAt ?? "now()"})`,
      [
        t.id ?? tapId(),
        t.lecture ?? LECTURE_A,
        t.anon ?? claims.sub,
        t.kind ?? "lost",
        slide,
        t.slideNumber ?? slide,
        t.note ?? null,
        t.undone ?? false,
        ...hl,
      ],
    ),
  );
}

const endLecture = (minutesAgo: number) =>
  db.query(
    `update public.lectures set status = 'ended', ended_at = now() - make_interval(mins => $2) where id = $1`,
    [LECTURE_A, minutesAgo],
  );

const count = async (where = "true") =>
  Number((await db.query<{ n: string }>(`select count(*) as n from public.lost_taps where ${where}`)).rows[0].n);

describe("inserting a tap", () => {
  it("lets a student who joined insert their own tap", async () => {
    await insertTap(s1);
    expect(await count()).toBe(1);
  });

  it("stores created_at and keeps the browser made id", async () => {
    const id = tapId();
    await insertTap(s1, { id });
    const r = await db.query<{ id: string; created_at: string | null; undone: boolean }>(
      "select id, created_at, undone from public.lost_taps",
    );
    expect(r.rows[0].id).toBe(id);
    expect(r.rows[0].created_at).not.toBeNull();
    expect(r.rows[0].undone).toBe(false);
  });

  it("rejects a tap with someone else's anon_id", async () => {
    await expect(insertTap(s1, { anon: s2.sub })).rejects.toThrow(/row-level security/i);
    expect(await count()).toBe(0);
  });

  it("rejects a tap from a student who did not join the lecture", async () => {
    await expect(insertTap(stranger)).rejects.toThrow(/row-level security/i);
    await expect(insertTap(s1, { lecture: LECTURE_B })).rejects.toThrow(/row-level security/i);
    expect(await count()).toBe(0);
  });

  it("rejects a signed out insert", async () => {
    await expect(
      as(db, null, () =>
        db.query(
          "insert into public.lost_taps (id, lecture_id, anon_id, tapped_on_slide, slide_number, tapped_at) values ($1, $2, $3, 1, 1, now())",
          [tapId(), LECTURE_A, s1.sub],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("accepts slide 1 and slide 10 of a 10 slide lecture and rejects 0 and 11", async () => {
    await insertTap(s1, { slide: 1 });
    await insertTap(s1, { slide: 10 });
    await expect(insertTap(s1, { slide: 11 })).rejects.toThrow(/row-level security/i);
    await expect(insertTap(s1, { slide: 0 })).rejects.toThrow(/row-level security/i);
    expect(await count()).toBe(2);
  });

  it("rejects a slide_number that differs from tapped_on_slide", async () => {
    await expect(insertTap(s1, { slide: 5, slideNumber: 4 })).rejects.toThrow(/row-level security/i);
  });

  it("rejects a row that is already undone", async () => {
    await expect(insertTap(s1, { undone: true })).rejects.toThrow(/row-level security/i);
  });

  it("accepts a save row too (a later task sends them)", async () => {
    await insertTap(s1, { kind: "save" });
    expect(await count("kind = 'save'")).toBe(1);
  });

  it("rejects a kind that is not lost or save", async () => {
    await expect(insertTap(s1, { kind: "other" })).rejects.toThrow(/check constraint/i);
  });

  it("rejects a note over 140 characters and accepts exactly 140", async () => {
    await insertTap(s1, { note: "x".repeat(140) });
    await expect(insertTap(s1, { note: "x".repeat(141) })).rejects.toThrow(/check constraint/i);
  });

  it("sending the same id again with on conflict do nothing keeps one row", async () => {
    const id = tapId();
    const send = () =>
      as(db, s1, () =>
        db.query(
          `insert into public.lost_taps (id, lecture_id, anon_id, tapped_on_slide, slide_number, tapped_at)
           values ($1, $2, $3, 3, 3, now()) on conflict (id) do nothing`,
          [id, LECTURE_A, s1.sub],
        ),
      );
    await send();
    await send();
    expect(await count()).toBe(1);
  });
});

describe("taps after the lecture ends (15 minute rule)", () => {
  it("accepts a tap made while live", async () => {
    await insertTap(s1);
    expect(await count()).toBe(1);
  });

  it("accepts a tap made before the end that arrives 5 minutes after it", async () => {
    await endLecture(5);
    await insertTap(s1, { tappedAt: "now() - interval '6 minutes'" });
    expect(await count()).toBe(1);
  });

  it("rejects a tap whose tapped_at is after ended_at, even within the 15 minutes", async () => {
    await endLecture(5);
    await expect(insertTap(s1, { tappedAt: "now()" })).rejects.toThrow(/row-level security/i);
    expect(await count()).toBe(0);
  });

  it("rejects any tap once ended_at is more than 15 minutes ago", async () => {
    await endLecture(16);
    await expect(insertTap(s1, { tappedAt: "now() - interval '30 minutes'" })).rejects.toThrow(/row-level security/i);
    expect(await count()).toBe(0);
  });

  it("accepts a tap just inside the 15 minutes", async () => {
    await endLecture(14);
    await insertTap(s1, { tappedAt: "now() - interval '20 minutes'" });
    expect(await count()).toBe(1);
  });

  it("rejects a tap on an ended lecture with no ended_at", async () => {
    await db.query("update public.lectures set status = 'ended', ended_at = null where id = $1", [LECTURE_A]);
    await expect(insertTap(s1)).rejects.toThrow(/row-level security/i);
  });
});

describe("highlight check", () => {
  it("accepts no highlight and a whole highlight", async () => {
    await insertTap(s1);
    await insertTap(s1, { hl: [0.1, 0.2, 0.5, 0.5] });
    await insertTap(s1, { hl: [0, 0, 1, 1] });
    expect(await count()).toBe(3);
  });

  it("accepts every box rectFromDrag draws, edges included (float4 rounding must not tip it over 1)", async () => {
    const box = { width: 997, height: 331 };
    let n = 0;
    // Over 100 taps from one student: each earlier one is made to look a few minutes old,
    // so the 20 a minute limit (0012) stays out of this check.
    const insertTap = async (claims: Claims, t: Tap) => {
      await db.query("update public.lost_taps set created_at = now() - interval '5 minutes'");
      return insertTapNow(claims, t);
    };
    for (let a = 0; a <= 997; a += 83) {
      for (let b = 0; b <= 997; b += 97) {
        const r = rectFromDrag({ x: a, y: 3 }, { x: b, y: 331 }, box);
        if (!r) continue;
        await insertTap(s1, { hl: [r.x, r.y, r.w, r.h] });
        n++;
      }
    }
    // The widest cases that tip a float4 sum: both edges on thirds and sevenths.
    for (const [x, w] of [[0.3333, 0.6667], [0.1429, 0.8571], [0.7, 0.3], [0.1, 0.9], [0, 1]]) {
      const r = rectFromDrag({ x: x * 10000, y: 0 }, { x: (x + w) * 10000, y: 10000 }, { width: 10000, height: 10000 });
      await insertTap(s1, { hl: [r!.x, r!.y, r!.w, r!.h] });
      n++;
    }
    expect(n).toBeGreaterThan(30);
    expect(await count()).toBe(n);
  });

  it("rejects hl_x + hl_w = 1.2", async () => {
    await expect(insertTap(s1, { hl: [0.6, 0.1, 0.6, 0.2] })).rejects.toThrow(/check constraint/i);
  });

  it("rejects hl_y + hl_h over 1", async () => {
    await expect(insertTap(s1, { hl: [0.1, 0.6, 0.2, 0.6] })).rejects.toThrow(/check constraint/i);
  });

  it("rejects a highlight with only hl_x set, or three of four", async () => {
    await expect(insertTap(s1, { hl: [0.1, null, null, null] })).rejects.toThrow(/check constraint/i);
    await expect(insertTap(s1, { hl: [0.1, 0.1, 0.2, null] })).rejects.toThrow(/check constraint/i);
  });

  it("rejects a negative origin and a zero or negative size", async () => {
    await expect(insertTap(s1, { hl: [-0.1, 0.1, 0.2, 0.2] })).rejects.toThrow(/check constraint/i);
    await expect(insertTap(s1, { hl: [0.1, -0.1, 0.2, 0.2] })).rejects.toThrow(/check constraint/i);
    await expect(insertTap(s1, { hl: [0.1, 0.1, 0, 0.2] })).rejects.toThrow(/check constraint/i);
    await expect(insertTap(s1, { hl: [0.1, 0.1, 0.2, -0.2] })).rejects.toThrow(/check constraint/i);
  });
});

describe("who can read taps", () => {
  let idA: string;
  let idB: string;
  beforeEach(async () => {
    idA = tapId();
    idB = tapId();
    await insertTap(s1, { id: idA, slide: 3, note: "s1 secret note" });
    await insertTap(s2, { id: idB, slide: 4, note: "s2 secret note" });
  });

  it("a student sees only their own tap and note", async () => {
    expect((await rows<{ id: string }>(s1, "select id from public.lost_taps")).map((r) => r.id)).toEqual([idA]);
    expect((await rows<{ id: string }>(s2, "select id from public.lost_taps")).map((r) => r.id)).toEqual([idB]);
    expect(await rows(s1, "select note from public.lost_taps where anon_id = $1", [s2.sub])).toHaveLength(0);
  });

  it("a stranger sees nothing", async () => {
    expect(await rows(stranger, "select id from public.lost_taps")).toHaveLength(0);
  });

  it("the owning teacher sees both students' taps", async () => {
    const seen = await rows<{ id: string }>(marko, "select id from public.lost_taps order by id");
    expect(seen.map((r) => r.id)).toEqual([idA, idB]);
  });

  it("another teacher sees none", async () => {
    expect(await rows(other, "select id from public.lost_taps")).toHaveLength(0);
  });

  it("the teacher sees 0 rows of kind save, the student still sees their own save", async () => {
    await insertTap(s1, { kind: "save", slide: 5 });
    expect(await rows(marko, "select id from public.lost_taps where kind = 'save'")).toHaveLength(0);
    expect(await rows(marko, "select id from public.lost_taps")).toHaveLength(2);
    expect(await rows(s1, "select id from public.lost_taps where kind = 'save'")).toHaveLength(1);
  });
});

describe("updating a tap", () => {
  let id: string;
  beforeEach(async () => {
    id = tapId();
    await insertTap(s1, { id, slide: 5 });
  });

  const update = (claims: Claims, set: string, params: unknown[] = []) =>
    as(db, claims, async () =>
      (await db.query(`update public.lost_taps set ${set} where id = '${id}'`, params)).affectedRows,
    );

  it("a student can set a note", async () => {
    expect(await update(s1, "note = $1", ["what lost me"])).toBe(1);
    expect((await db.query<{ note: string }>("select note from public.lost_taps")).rows[0].note).toBe("what lost me");
  });

  it("a student can set undone on their own tap, and the teacher still selects it", async () => {
    expect(await update(s1, "undone = true")).toBe(1);
    const seen = await rows<{ id: string; undone: boolean }>(marko, "select id, undone from public.lost_taps");
    expect(seen).toEqual([{ id, undone: true }]);
    const own = await rows<{ undone: boolean }>(s1, "select undone from public.lost_taps");
    expect(own).toEqual([{ undone: true }]);
  });

  it("a student can move slide_number inside 1..tapped_on_slide", async () => {
    expect(await update(s1, "slide_number = 1")).toBe(1);
    expect(await update(s1, "slide_number = 5")).toBe(1);
  });

  it("rejects slide_number 0 and slide_number above tapped_on_slide", async () => {
    await expect(update(s1, "slide_number = 0")).rejects.toThrow(/row-level security/i);
    await expect(update(s1, "slide_number = 6")).rejects.toThrow(/row-level security/i);
    expect((await db.query<{ slide_number: number }>("select slide_number from public.lost_taps")).rows[0].slide_number).toBe(5);
  });

  it("rejects updating anon_id or any column outside the grant", async () => {
    await expect(update(s1, "anon_id = $1", [s2.sub])).rejects.toThrow(/permission denied/i);
    await expect(update(s1, "tapped_on_slide = 2")).rejects.toThrow(/permission denied/i);
    await expect(update(s1, "kind = 'save'")).rejects.toThrow(/permission denied/i);
    await expect(update(s1, "lecture_id = $1", [LECTURE_B])).rejects.toThrow(/permission denied/i);
    await expect(update(s1, "tapped_at = now()")).rejects.toThrow(/permission denied/i);
    await expect(update(s1, "id = $1", [tapId()])).rejects.toThrow(/permission denied/i);
  });

  it("a student can set a whole highlight and the check still applies", async () => {
    expect(await update(s1, "hl_x = 0.1, hl_y = 0.1, hl_w = 0.5, hl_h = 0.5")).toBe(1);
    await expect(update(s1, "hl_x = 0.8")).rejects.toThrow(/check constraint/i);
    await expect(update(s1, "hl_x = null")).rejects.toThrow(/check constraint/i);
  });

  it("another student changes nothing of theirs", async () => {
    expect(await update(s2, "undone = true")).toBe(0);
    expect(await update(s2, "note = 'hijack'")).toBe(0);
    expect((await db.query<{ undone: boolean }>("select undone from public.lost_taps")).rows[0].undone).toBe(false);
  });

  it("the teacher cannot change a tap", async () => {
    await expect(update(marko, "undone = true")).resolves.toBe(0);
    await expect(update(marko, "note = 'x'")).resolves.toBe(0);
  });

  it("nobody can delete a tap", async () => {
    for (const claims of [s1, s2, marko]) {
      const deleted = await as(db, claims, async () => (await db.query("delete from public.lost_taps")).affectedRows);
      expect(deleted).toBe(0);
    }
    expect(await count()).toBe(1);
  });
});

describe("lost_taps and its lecture", () => {
  it("is removed with the lecture", async () => {
    await insertTap(s1);
    await db.query("delete from public.courses where id = $1", [MARKO_COURSE]);
    expect(await count()).toBe(0);
  });
});
