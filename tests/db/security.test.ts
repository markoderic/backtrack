// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MARKO_COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LIVE = "cccccccc-cccc-cccc-cccc-000000000001";
const OTHERS_LIVE = "cccccccc-cccc-cccc-cccc-000000000002";
const NEW_ID = "dddddddd-dddd-dddd-dddd-000000000001";

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
      ('${MARKO_COURSE}', '${MARKO}', 'IMS 452'),
      ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LIVE}', '${MARKO_COURSE}', 'Lecture 1, Oct 26', '482916', 'live', 1, 3),
      ('${OTHERS_LIVE}', '${OTHER_COURSE}', 'Cells, Oct 26', '735018', 'live', 1, 2);
    insert into public.slides (lecture_id, number, image_path) values
      ('${LIVE}', 1, '${LIVE}/1.webp'),
      ('${OTHERS_LIVE}', 1, '${OTHERS_LIVE}/1.webp');
  `);
});

const rows = <T extends object>(claims: Claims | null, sql: string, params: unknown[] = []) =>
  as(db, claims, async () => (await db.query<T>(sql, params)).rows);

const slides = (id: string, n: number, ext = "webp") =>
  Array.from({ length: n }, (_, i) => ({ number: i + 1, image_path: `${id}/${i + 1}.${ext}`, first_line: "" }));

const putObject = (name: string, owner: string | null = MARKO, age = "0 seconds", bucket = "slides") =>
  db.query("insert into storage.objects (bucket_id, name, owner, created_at) values ($1, $2, $3, now() - $4::interval)", [
    bucket,
    name,
    owner,
    age,
  ]);

const startLecture = (claims: Claims, id: string, s: unknown) =>
  rows<{ lecture_id: string; code: string }>(claims, "select * from public.start_lecture($1, $2, 'Lecture 2', $3::jsonb)", [
    id,
    MARKO_COURSE,
    JSON.stringify(s),
  ]);

describe("start_lecture checks the images are in storage (D5 on the server)", () => {
  it("starts when every image is in the slides bucket", async () => {
    for (const s of slides(NEW_ID, 3)) await putObject(s.image_path);
    const out = await startLecture(marko, NEW_ID, slides(NEW_ID, 3));
    expect(out[0].lecture_id).toBe(NEW_ID);
  });

  it("refuses when no image was uploaded, and makes no lecture or slides", async () => {
    await expect(startLecture(marko, NEW_ID, slides(NEW_ID, 2))).rejects.toMatchObject({ code: "22023", message: "missing_images" });
    expect((await db.query("select 1 from public.lectures where id = $1", [NEW_ID])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.slides where lecture_id = $1", [NEW_ID])).rows).toHaveLength(0);
  });

  it("refuses when one image of many is missing", async () => {
    await putObject(`${NEW_ID}/1.webp`);
    await putObject(`${NEW_ID}/3.webp`);
    await expect(startLecture(marko, NEW_ID, slides(NEW_ID, 3))).rejects.toThrow("missing_images");
  });

  it("does not count an object with the same name in another bucket", async () => {
    await putObject(`${NEW_ID}/1.webp`, MARKO, "0 seconds", "avatars");
    await expect(startLecture(marko, NEW_ID, slides(NEW_ID, 1))).rejects.toThrow("missing_images");
  });
});

describe("lost_taps.tapped_at can not be in the future", () => {
  const tap = (id: string, tappedAt: string) =>
    rows(
      student,
      "insert into public.lost_taps (id, lecture_id, anon_id, tapped_on_slide, slide_number, tapped_at) values ($1, $2, auth.uid(), 1, 1, $3::timestamptz)",
      [id, LIVE, tappedAt],
    );
  const stored = async (id: string) =>
    (
      await db.query<{ ahead: number }>(
        "select extract(epoch from (tapped_at - now()))::float8 as ahead from public.lost_taps where id = $1",
        [id],
      )
    ).rows[0].ahead;

  beforeEach(async () => {
    await as(db, student, () => db.query("select public.join_lecture('482916')"));
  });

  it("keeps a time up to a minute ahead (a slightly fast clock) as sent", async () => {
    const at = new Date(Date.now() + 30_000).toISOString();
    await tap("99999999-9999-9999-9999-000000000001", at);
    const row = (await db.query<{ t: string }>("select tapped_at::text as t from public.lost_taps")).rows[0];
    expect(new Date(row.t).getTime()).toBe(new Date(at).getTime());
  });

  it("stores the server's time for a tap stamped more than a minute ahead, and keeps the tap", async () => {
    await tap("99999999-9999-9999-9999-000000000002", new Date(Date.now() + 10 * 60_000).toISOString());
    expect(Math.abs(await stored("99999999-9999-9999-9999-000000000002"))).toBeLessThan(5);
    await tap("99999999-9999-9999-9999-000000000003", "2099-01-01T00:00:00Z");
    expect(Math.abs(await stored("99999999-9999-9999-9999-000000000003"))).toBeLessThan(5);
  });

  it("keeps a time in the past (a tap queued offline) as sent", async () => {
    await tap("99999999-9999-9999-9999-000000000004", new Date(Date.now() - 5 * 60_000).toISOString());
    expect(await stored("99999999-9999-9999-9999-000000000004")).toBeLessThan(-290);
  });

  it("a future stamp can not sneak a tap in after the lecture ended", async () => {
    await db.query("update public.lectures set status = 'ended', code = null, ended_at = now() - interval '1 minute' where id = $1", [LIVE]);
    await expect(tap("99999999-9999-9999-9999-000000000005", "2099-01-01T00:00:00Z")).rejects.toThrow(/row-level security/i);
  });
});

describe("slides uploads only into a folder of the teacher's own lecture (restrictive policy)", () => {
  const upload = (claims: Claims, name: string, bucket = "slides") =>
    as(db, claims, () => db.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())", [bucket, name]));

  it("lets a teacher upload into a lecture id that is still free (before start_lecture)", async () => {
    await upload(marko, `${NEW_ID}/1.webp`);
    await upload(marko, `${NEW_ID}/2.jpg`);
    await upload(marko, `${NEW_ID}/120.webp`);
    expect((await db.query("select 1 from storage.objects")).rows).toHaveLength(3);
  });

  it("lets a teacher upload into their own lecture's folder", async () => {
    await upload(marko, `${LIVE}/2.webp`);
  });

  it("refuses another teacher's lecture folder", async () => {
    await expect(upload(marko, `${OTHERS_LIVE}/2.webp`)).rejects.toThrow(/row-level security/i);
    await expect(upload(other, `${LIVE}/2.webp`)).rejects.toThrow(/row-level security/i);
  });

  it("refuses paths that are not <lecture uuid>/<slide number>.webp or .jpg", async () => {
    for (const name of [
      "loose.webp",
      "not-a-uuid/1.webp",
      `${NEW_ID}/1.png`,
      `${NEW_ID}/0.webp`,
      `${NEW_ID}/01.webp`,
      `${NEW_ID}/a/1.webp`,
      `${NEW_ID}/1.webp/x`,
      `${NEW_ID.toUpperCase()}/1.webp`,
      `../${NEW_ID}/1.webp`,
      `${NEW_ID}/1.svg`,
    ]) {
      await expect(upload(marko, name), name).rejects.toThrow(/row-level security/i);
    }
    expect((await db.query("select 1 from storage.objects")).rows).toHaveLength(0);
  });

  it("still refuses students", async () => {
    await expect(upload(student, `${NEW_ID}/1.webp`)).rejects.toThrow(/row-level security/i);
  });
});

describe("my_orphan_slide_images", () => {
  const list = (claims: Claims) => rows<{ name: string }>(claims, "select name from public.my_orphan_slide_images() as name");

  beforeEach(async () => {
    await putObject(`${NEW_ID}/1.webp`, MARKO, "2 days"); // left by a failed start: listed
    await putObject(`${NEW_ID}/2.webp`, MARKO, "25 hours"); // listed
    await putObject("eeeeeeee-eeee-eeee-eeee-000000000001/1.webp", MARKO, "1 hour"); // too new: an upload may be in progress
    await putObject(`${LIVE}/1.webp`, MARKO, "3 days"); // a lecture uses it
    await putObject("ffffffff-ffff-ffff-ffff-000000000001/1.webp", OTHER, "3 days"); // another teacher's
  });

  it("lists the caller's own uploads older than a day that no lecture uses", async () => {
    expect((await list(marko)).map((r) => r.name).sort()).toEqual([`${NEW_ID}/1.webp`, `${NEW_ID}/2.webp`]);
    expect((await list(other)).map((r) => r.name)).toEqual(["ffffffff-ffff-ffff-ffff-000000000001/1.webp"]);
  });

  it("gives a student nothing and anon no access", async () => {
    expect(await list(student)).toEqual([]);
    await expect(as(db, null, () => db.query("select public.my_orphan_slide_images()"))).rejects.toThrow(/permission denied/i);
  });

  it("everything it lists can be removed by the same teacher (slides_delete_unused)", async () => {
    const names = (await list(marko)).map((r) => r.name);
    const removed = await rows<{ name: string }>(marko, "delete from storage.objects where name = any($1::text[]) returning name", [names]);
    expect(removed).toHaveLength(2);
    expect((await db.query("select 1 from storage.objects")).rows).toHaveLength(3);
  });
});
