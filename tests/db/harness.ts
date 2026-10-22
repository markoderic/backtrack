import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

// Just enough of Supabase's built-in objects for the real policies to run.
const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;

create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create table storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  allowed_mime_types text[],
  file_size_limit bigint
);

create table storage.objects (
  bucket_id text,
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(cardinality(string_to_array(name, '/')) - 1, 0)]
$$;

-- Supabase gives anon and authenticated access to everything created in public;
-- row level security is what actually limits them.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;

/**
 * A fresh in-memory Postgres with Supabase stubs and every migration applied.
 * Migrations ending in .remote.sql (Realtime publication, storage bucket insert)
 * only work on hosted Supabase and are skipped.
 */
export async function newDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".remote.sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

export type Claims = {
  sub: string;
  email?: string;
  is_anonymous?: boolean;
  app_metadata?: Record<string, unknown>;
};

/**
 * Runs fn as role `authenticated` with the given JWT claims, or as `anon` when
 * claims is null, then puts the session back to the superuser. One at a time:
 * PGlite has a single connection, so do not run two as() calls concurrently.
 */
export async function as<T>(
  db: PGlite,
  claims: Claims | null,
  fn: (db: PGlite) => Promise<T>,
): Promise<T> {
  const jwt = claims
    ? { role: "authenticated", is_anonymous: false, ...claims }
    : { role: "anon" };
  try {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(jwt)]);
    await db.exec(`set role ${claims ? "authenticated" : "anon"}`);
    return await fn(db);
  } finally {
    await db.exec("reset role");
    await db.exec("select set_config('request.jwt.claims', '', false)");
  }
}
