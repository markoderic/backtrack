// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };

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
  `);
});

const insertCourse = (teacherId: string, name: string) =>
  db.query("insert into public.courses (teacher_id, name) values ($1, $2)", [teacherId, name]);

describe("courses RLS", () => {
  it("lets a teacher insert and read their own course", async () => {
    const rows = await as(db, marko, async () => {
      await insertCourse(MARKO, "IMS 452");
      return (await db.query<{ name: string; archived: boolean }>("select name, archived from public.courses")).rows;
    });
    expect(rows).toEqual([{ name: "IMS 452", archived: false }]);
  });

  it("shows another teacher 0 rows", async () => {
    await insertCourse(MARKO, "IMS 452");
    const seen = await as(db, other, async () => (await db.query("select * from public.courses")).rows);
    expect(seen).toHaveLength(0);
  });

  it("rejects inserting a course for somebody else", async () => {
    await expect(as(db, other, () => insertCourse(MARKO, "Stolen"))).rejects.toThrow(/row-level security/i);
  });

  it("rejects an anonymous JWT", async () => {
    const anon = { sub: "44444444-4444-4444-4444-444444444444", is_anonymous: true, app_metadata: { provider: "anonymous" } };
    await expect(as(db, anon, () => insertCourse(MARKO, "Nope"))).rejects.toThrow(/row-level security|foreign key/i);
    await expect(as(db, null, () => insertCourse(MARKO, "Nope"))).rejects.toThrow();
  });

  it("rejects an empty or blank name", async () => {
    await expect(as(db, marko, () => insertCourse(MARKO, ""))).rejects.toThrow(/check/i);
    await expect(as(db, marko, () => insertCourse(MARKO, "   "))).rejects.toThrow(/check/i);
  });

  it("rejects a name over 120 characters", async () => {
    await expect(as(db, marko, () => insertCourse(MARKO, "x".repeat(121)))).rejects.toThrow(/check/i);
    await as(db, marko, () => insertCourse(MARKO, "x".repeat(120)));
  });

  it("lets a teacher archive their course but not touch someone else's", async () => {
    await insertCourse(MARKO, "IMS 452");
    await insertCourse(OTHER, "BIO 121");
    await as(db, marko, () => db.query("update public.courses set archived = true"));
    const after = await db.query<{ name: string; archived: boolean }>("select name, archived from public.courses order by name");
    expect(after.rows).toEqual([
      { name: "BIO 121", archived: false },
      { name: "IMS 452", archived: true },
    ]);
  });

  it("lets the owner unarchive their course", async () => {
    await insertCourse(MARKO, "IMS 452");
    await as(db, marko, () => db.query("update public.courses set archived = true"));
    await as(db, marko, () => db.query("update public.courses set archived = false"));
    const rows = await as(db, marko, async () => (await db.query<{ archived: boolean }>("select archived from public.courses")).rows);
    expect(rows).toEqual([{ archived: false }]);
  });

  it("does not let another teacher or a student archive a course (no row changes)", async () => {
    await insertCourse(MARKO, "IMS 452");
    await as(db, other, () => db.query("update public.courses set archived = true"));
    await as(db, { sub: "44444444-4444-4444-4444-000000000001", is_anonymous: true, app_metadata: { provider: "anonymous" } }, () =>
      db.query("update public.courses set archived = true"),
    );
    const rows = await db.query<{ archived: boolean }>("select archived from public.courses");
    expect(rows.rows).toEqual([{ archived: false }]);
  });

  it("does not let a teacher hand a course to someone else", async () => {
    await insertCourse(MARKO, "IMS 452");
    await expect(
      as(db, marko, () => db.query("update public.courses set teacher_id = $1", [OTHER])),
    ).rejects.toThrow(/permission denied/i); // 0014: only name and archived can be updated
  });

  it("lets a teacher delete only their own courses", async () => {
    await insertCourse(MARKO, "IMS 452");
    await insertCourse(OTHER, "BIO 121");
    await as(db, marko, () => db.query("delete from public.courses"));
    const left = await db.query<{ name: string }>("select name from public.courses");
    expect(left.rows).toEqual([{ name: "BIO 121" }]);
  });

  it("removes courses when the teacher is removed", async () => {
    await insertCourse(MARKO, "IMS 452");
    await db.query("delete from public.teachers where id = $1", [MARKO]);
    expect((await db.query("select 1 from public.courses")).rows).toHaveLength(0);
  });
});
