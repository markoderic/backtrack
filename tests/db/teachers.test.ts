// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const GMAIL = "33333333-3333-3333-3333-333333333333";
const ANON = "44444444-4444-4444-4444-444444444444";

// What Supabase puts in the token after a Google sign in.
const google = { provider: "google", providers: ["google"] };

let db: PGlite;

afterEach(async () => {
  await db.close();
});

beforeEach(async () => {
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email, is_anonymous) values
      ('${MARKO}', 'dericm@miamioh.edu', false),
      ('${OTHER}', 'other@miamioh.edu', false),
      ('${GMAIL}', 'someone@gmail.com', false),
      ('${ANON}', null, true);
  `);
});

const insertTeacher = (id: string, email: string) =>
  db.query("insert into public.teachers (id, email) values ($1, $2)", [id, email]);

describe("teachers RLS", () => {
  it("lets a Miami account insert its own row", async () => {
    await as(db, { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: google }, () =>
      insertTeacher(MARKO, "dericm@miamioh.edu"),
    );
    const rows = await db.query<{ email: string; display_name: string | null }>(
      "select email, display_name from public.teachers",
    );
    expect(rows.rows).toEqual([{ email: "dericm@miamioh.edu", display_name: null }]);
  });

  it("accepts a mixed case Miami email in the token", async () => {
    await as(db, { sub: MARKO, email: "DericM@MiamiOH.edu", app_metadata: google }, () =>
      insertTeacher(MARKO, "dericm@miamioh.edu"),
    );
    expect((await db.query("select 1 from public.teachers")).rows).toHaveLength(1);
  });

  it("rejects a gmail account", async () => {
    await expect(
      as(db, { sub: GMAIL, email: "someone@gmail.com", app_metadata: google }, () => insertTeacher(GMAIL, "someone@gmail.com")),
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects an email that only contains miamioh.edu", async () => {
    await expect(
      as(db, { sub: GMAIL, email: "x@miamioh.edu.evil.com", app_metadata: google }, () =>
        insertTeacher(GMAIL, "x@miamioh.edu.evil.com"),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects an anonymous session, even with a Miami looking email claim", async () => {
    await expect(
      as(db, { sub: ANON, email: "anon@miamioh.edu", is_anonymous: true, app_metadata: google }, () =>
        insertTeacher(ANON, "anon@miamioh.edu"),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects a Miami email that signed in with email and password", async () => {
    await expect(
      as(db, { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "email", providers: ["email"] } }, () =>
        insertTeacher(MARKO, "dericm@miamioh.edu"),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects a Miami email with no provider in the token", async () => {
    await expect(
      as(db, { sub: MARKO, email: "dericm@miamioh.edu" }, () => insertTeacher(MARKO, "dericm@miamioh.edu")),
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects an anonymous token that changed its email to a Miami one", async () => {
    await expect(
      as(db, { sub: ANON, email: "anon@miamioh.edu", is_anonymous: true, app_metadata: { provider: "anonymous", providers: ["anonymous"] } }, () =>
        insertTeacher(ANON, "anon@miamioh.edu"),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects a signed out visitor", async () => {
    await expect(as(db, null, () => insertTeacher(MARKO, "dericm@miamioh.edu"))).rejects.toThrow();
  });

  it("rejects inserting a row for somebody else", async () => {
    await expect(
      as(db, { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: google }, () => insertTeacher(OTHER, "other@miamioh.edu")),
    ).rejects.toThrow(/row-level security/i);
  });

  it("lets a teacher read and update only their own row", async () => {
    await db.query("insert into public.teachers (id, email) values ($1, 'dericm@miamioh.edu'), ($2, 'other@miamioh.edu')", [
      MARKO,
      OTHER,
    ]);
    const seen = await as(db, { sub: MARKO, email: "dericm@miamioh.edu" }, async () =>
      (await db.query<{ id: string }>("select id from public.teachers")).rows.map((r) => r.id),
    );
    expect(seen).toEqual([MARKO]);

    const updated = await as(db, { sub: MARKO, email: "dericm@miamioh.edu" }, async () => {
      await db.query("update public.teachers set display_name = 'Marko'");
      return (await db.query("select 1 from public.teachers where display_name = 'Marko'")).rows.length;
    });
    expect(updated).toBe(1);

    const untouched = await db.query<{ display_name: string | null }>(
      "select display_name from public.teachers where id = $1",
      [OTHER],
    );
    expect(untouched.rows[0].display_name).toBeNull();
  });

  it("keeps display_name when the callback upserts an existing row", async () => {
    await db.query("insert into public.teachers (id, email, display_name) values ($1, 'dericm@miamioh.edu', 'Marko')", [MARKO]);
    await as(db, { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: google }, () =>
      db.query(
        `insert into public.teachers (id, email) values ($1, 'dericm@miamioh.edu')
         on conflict (id) do update set email = excluded.email`,
        [MARKO],
      ),
    );
    const r = await db.query<{ display_name: string }>("select display_name from public.teachers");
    expect(r.rows[0].display_name).toBe("Marko");
  });
});

describe("is_teacher()", () => {
  const check = (claims: { sub: string; email?: string } | null) =>
    as(db, claims, async () => (await db.query<{ t: boolean }>("select public.is_teacher() as t")).rows[0].t);

  it("is true only for someone with a teachers row", async () => {
    await db.query("insert into public.teachers (id, email) values ($1, 'dericm@miamioh.edu')", [MARKO]);
    expect(await check({ sub: MARKO, email: "dericm@miamioh.edu" })).toBe(true);
    expect(await check({ sub: OTHER, email: "other@miamioh.edu" })).toBe(false);
    expect(await check(null)).toBe(false);
  });
});
