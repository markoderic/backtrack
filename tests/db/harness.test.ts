// @vitest-environment node
import { describe, it, expect } from "vitest";
import { newDb, as } from "./harness";

const SUB = "11111111-1111-1111-1111-111111111111";

describe("PGlite harness", () => {
  it("starts and returns the given sub from auth.uid() inside as(), null outside", async () => {
    const db = await newDb();
    const inside = await as(db, { sub: SUB, email: "a@miamioh.edu" }, async () => {
      const r = await db.query<{ uid: string | null }>("select auth.uid() as uid");
      return r.rows[0].uid;
    });
    expect(inside).toBe(SUB);
    const outside = await db.query<{ uid: string | null }>("select auth.uid() as uid");
    expect(outside.rows[0].uid).toBeNull();
  });
});

describe("PGlite harness roles", () => {
  it("applies row level security and storage.foldername as the stubbed roles", async () => {
    const db = await newDb();
    await db.exec(`
      create table public.notes (id serial primary key, owner uuid not null, body text);
      alter table public.notes enable row level security;
      create policy own on public.notes for select using (owner = auth.uid());
      create policy folder on storage.objects for select
        using (bucket_id = 'slides' and (storage.foldername(name))[1] = auth.uid()::text);
    `);
    const other = "22222222-2222-2222-2222-222222222222";
    await db.query("insert into public.notes (owner, body) values ($1, 'mine'), ($2, 'theirs')", [SUB, other]);
    await db.query(
      "insert into storage.objects (bucket_id, name, owner) values ('slides', $1 || '/a/1.png', $1::uuid), ('slides', $2 || '/b/1.png', $2::uuid)",
      [SUB, other],
    );

    const seen = await as(db, { sub: SUB }, async () =>
      (await db.query<{ body: string }>("select body from public.notes")).rows.map((r) => r.body),
    );
    expect(seen).toEqual(["mine"]);

    const files = await as(db, { sub: SUB }, async () =>
      (await db.query<{ name: string }>("select name from storage.objects")).rows.map((r) => r.name),
    );
    expect(files).toEqual([`${SUB}/a/1.png`]);

    const anonSeen = await as(db, null, async () =>
      (await db.query("select body from public.notes")).rows,
    );
    expect(anonSeen).toEqual([]);

    // back to the superuser afterwards
    expect((await db.query("select body from public.notes")).rows).toHaveLength(2);
  });
});
