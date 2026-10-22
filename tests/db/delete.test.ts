// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MARKO_COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ENDED = "cccccccc-cccc-cccc-cccc-000000000001";
const LIVE = "cccccccc-cccc-cccc-cccc-000000000002";
const KEPT = "cccccccc-cccc-cccc-cccc-000000000003";
const OTHERS = "cccccccc-cccc-cccc-cccc-000000000004";

const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student: Claims = {
  sub: "44444444-4444-4444-4444-000000000001",
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
};

let db: PGlite;

afterEach(async () => {
  await db.close();
});

beforeEach(async () => {
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
    insert into public.courses (id, teacher_id, name) values
      ('${MARKO_COURSE}', '${MARKO}', 'IMS 228'),
      ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count, ended_at) values
      ('${ENDED}', '${MARKO_COURSE}', 'System check, Oct 22', null, 'ended', 1, 3, now()),
      ('${LIVE}', '${MARKO_COURSE}', 'Live one', '482916', 'live', 1, 2, null),
      ('${KEPT}', '${MARKO_COURSE}', 'Kept', null, 'ended', 1, 2, now()),
      ('${OTHERS}', '${OTHER_COURSE}', 'Cells', null, 'ended', 1, 1, now());
    insert into public.slides (lecture_id, number, image_path, first_line) values
      ('${ENDED}', 1, '${ENDED}/1.webp', 'Welcome'),
      ('${ENDED}', 2, '${ENDED}/2.webp', ''),
      ('${ENDED}', 3, 'demo/placeholder.webp', ''),
      ('${LIVE}', 1, '${LIVE}/1.webp', ''),
      ('${LIVE}', 2, '${LIVE}/2.webp', ''),
      ('${KEPT}', 1, '${KEPT}/1.webp', ''),
      ('${KEPT}', 2, 'demo/placeholder.webp', ''),
      ('${OTHERS}', 1, '${OTHERS}/1.webp', '');
    insert into public.participants (lecture_id, anon_id) values
      ('${ENDED}', '${student.sub}'),
      ('${ENDED}', '55555555-5555-5555-5555-555555555555'),
      ('${KEPT}', '${student.sub}');
    insert into public.lost_taps (lecture_id, anon_id, kind, tapped_on_slide, slide_number, note, tapped_at) values
      ('${ENDED}', '${student.sub}', 'lost', 2, 2, 'too fast', now()),
      ('${ENDED}', '${student.sub}', 'save', 1, 1, null, now()),
      ('${KEPT}', '${student.sub}', 'lost', 1, 1, null, now());
    insert into storage.objects (bucket_id, name, owner) values
      ('slides', '${ENDED}/1.webp', '${MARKO}'),
      ('slides', '${ENDED}/2.webp', '${MARKO}'),
      ('slides', 'demo/placeholder.webp', '${MARKO}'),
      ('slides', '${KEPT}/1.webp', '${MARKO}'),
      ('slides', '${OTHERS}/1.webp', '${OTHER}');
  `);
});

type Deleted = { course_id: string; image_paths: string[] };
const del = (claims: Claims | null, id: string) =>
  as(db, claims, async () => (await db.query<Deleted>("select * from public.delete_lecture($1)", [id])).rows);

async function counts(id: string) {
  const one = async (sql: string) => Number((await db.query<{ n: number }>(sql, [id])).rows[0].n);
  return {
    lectures: await one("select count(*) as n from public.lectures where id = $1"),
    slides: await one("select count(*) as n from public.slides where lecture_id = $1"),
    participants: await one("select count(*) as n from public.participants where lecture_id = $1"),
    taps: await one("select count(*) as n from public.lost_taps where lecture_id = $1"),
  };
}

describe("delete_lecture", () => {
  it("deletes the owner's ended lecture with its slides, participants and taps, saves included", async () => {
    const out = await del(marko, ENDED);
    expect(out).toHaveLength(1);
    expect(out[0].course_id).toBe(MARKO_COURSE);
    // Only the lecture's own folder: the shared demo image is never handed out for removal.
    expect([...out[0].image_paths].sort()).toEqual([`${ENDED}/1.webp`, `${ENDED}/2.webp`]);
    expect(await counts(ENDED)).toEqual({ lectures: 0, slides: 0, participants: 0, taps: 0 });
  });

  it("leaves every other lecture alone", async () => {
    await del(marko, ENDED);
    expect(await counts(KEPT)).toEqual({ lectures: 1, slides: 2, participants: 1, taps: 1 });
    expect(await counts(LIVE)).toMatchObject({ lectures: 1, slides: 2 });
    expect(await counts(OTHERS)).toMatchObject({ lectures: 1, slides: 1 });
  });

  it("refuses a live lecture and changes nothing", async () => {
    await expect(del(marko, LIVE)).rejects.toMatchObject({ code: "55000", message: "live_lecture" });
    expect(await counts(LIVE)).toMatchObject({ lectures: 1, slides: 2 });
  });

  it("refuses another teacher, a student and a signed out caller", async () => {
    await expect(del(other, ENDED)).rejects.toMatchObject({ code: "42501" });
    await expect(del(student, ENDED)).rejects.toMatchObject({ code: "42501" });
    await expect(del(null, ENDED)).rejects.toThrow();
    expect(await counts(ENDED)).toEqual({ lectures: 1, slides: 3, participants: 2, taps: 2 });
  });

  it("refuses a lecture that does not exist (or was already deleted)", async () => {
    await del(marko, ENDED);
    await expect(del(marko, ENDED)).rejects.toMatchObject({ code: "42501" });
  });

  it("drops the deleted lecture from the semester export", async () => {
    const lectures = async () =>
      as(db, marko, async () =>
        (await db.query<{ lecture_name: string }>("select distinct lecture_name from public.course_export($1)", [MARKO_COURSE])).rows
          .map((r) => r.lecture_name)
          .sort(),
      );
    expect(await lectures()).toEqual(["Kept", "System check, Oct 22"]);
    await del(marko, ENDED);
    expect(await lectures()).toEqual(["Kept"]);
  });

  it("can not be called by anon", async () => {
    await expect(as(db, null, () => db.query("select public.delete_lecture($1)", [ENDED]))).rejects.toThrow(/permission denied/i);
  });
});

describe("storage delete policy (slides_delete_unused)", () => {
  const remove = (claims: Claims, name: string) =>
    as(db, claims, async () => (await db.query("delete from storage.objects where bucket_id = 'slides' and name = $1 returning name", [name])).rows.length);

  it("keeps the images of a lecture that still exists, even from its owner", async () => {
    expect(await remove(marko, `${ENDED}/1.webp`)).toBe(0);
    expect(await remove(marko, `${KEPT}/1.webp`)).toBe(0);
  });

  it("lets the owner remove the images once the lecture is deleted", async () => {
    const [{ image_paths }] = await del(marko, ENDED);
    for (const p of image_paths) expect(await remove(marko, p)).toBe(1);
  });

  it("never lets another teacher or a student remove them", async () => {
    await del(marko, ENDED);
    expect(await remove(other, `${ENDED}/1.webp`)).toBe(0);
    expect(await remove(student, `${ENDED}/2.webp`)).toBe(0);
  });

  it("keeps a shared image while any lecture still uses it", async () => {
    await del(marko, ENDED);
    expect(await remove(marko, "demo/placeholder.webp")).toBe(0);
  });

  it("lets a teacher remove their own upload that no slides row uses (a failed start)", async () => {
    await db.exec(`insert into storage.objects (bucket_id, name, owner) values ('slides', 'dddddddd-dddd-dddd-dddd-dddddddddddd/1.webp', '${MARKO}')`);
    expect(await remove(other, "dddddddd-dddd-dddd-dddd-dddddddddddd/1.webp")).toBe(0);
    expect(await remove(marko, "dddddddd-dddd-dddd-dddd-dddddddddddd/1.webp")).toBe(1);
  });
});
