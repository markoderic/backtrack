-- Correctness fixes from the build ledger (item 4). Only create or replace, create
-- index if not exists and add column if not exists: nothing is dropped, revoked or
-- rewritten, so the SQL editor's destructive operations check has nothing to flag.

-- Part 1: first time setup in one transaction.
--
-- saveSetup used to save the name, then insert the courses in a second request, so
-- a failed insert left a named teacher with no courses, and a double click on Done
-- (or a re-run after setup) added every course twice. This saves both or neither,
-- and only the first time: the update takes the teacher row's lock and only matches
-- while the name is still empty, so a second call that waited on it finds the name
-- set and does nothing. Security invoker: row level security still decides what the
-- caller may change, exactly as for the two separate requests before.
create or replace function public.save_setup(p_name text, p_courses text[]) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_courses text[];
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  select coalesce(array_agg(s.c order by s.o), '{}') into v_courses
  from (
    select btrim(u.x) as c, u.o
    from unnest(coalesce(p_courses, '{}'::text[])) with ordinality as u(x, o)
  ) s
  where s.c <> '';

  if length(v_name) not between 1 and 80
    or cardinality(v_courses) not between 1 and 20
    or exists (select 1 from unnest(v_courses) as c(n) where length(c.n) > 120)
  then
    raise exception 'A name of 1 to 80 characters and 1 to 20 courses of 1 to 120.' using errcode = '22023';
  end if;

  update public.teachers t
  set display_name = v_name
  where t.id = auth.uid() and coalesce(t.display_name, '') = '';
  if not found then
    -- Not a teacher, or setup was already done (a second click).
    return false;
  end if;

  insert into public.courses (teacher_id, name)
  select auth.uid(), u.c
  from unnest(v_courses) with ordinality as u(c, o)
  order by u.o;

  return true;
end;
$$;

-- Part 2: let join_lecture use an index for the code.
--
-- lectures.code is char(6) and join_lecture compares it to text, so Postgres casts
-- the column (code::text = $1) and the char(6) index lectures_live_code_idx can't be
-- used: every join scanned all lectures. This index is on the expression the query
-- actually has, for live lectures only, so the planner can match both.
create index if not exists lectures_live_code_text_idx
  on public.lectures ((code::text))
  where status = 'live';

-- Part 3: a version number on each lecture row.
--
-- A student's page hears about slide changes from two places, Realtime events and
-- its own reads, and either can arrive late. Comparing slides can't tell which is
-- newer (the teacher can go back), so every update of a lecture row counts up
-- slide_version and the page shows only what is newer than what it already shows.
-- Set by the trigger only; whatever a client sends for it is replaced.
alter table public.lectures add column if not exists slide_version bigint not null default 0;

create or replace function public.lectures_bump_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.slide_version := old.slide_version + 1;
  return new;
end;
$$;

create or replace trigger lectures_bump_version
  before update on public.lectures
  for each row execute function public.lectures_bump_version();
