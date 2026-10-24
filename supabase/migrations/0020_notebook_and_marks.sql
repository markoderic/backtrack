-- 0020: the student's private notebook, several marks (highlights) per slide, and a longer
-- note to the teacher (Marko's hand test 3, batch J). Run it after 0019. The app already works
-- before this file (it keeps the old highlight on the tap and the 140 character note) and uses
-- the new tables and the 2000 character note once it has run. It can run twice.
--
-- WHAT CHANGES (plain English, for Marko)
--
-- 1. notebook_notes (new table): the notes a student types on the page, one per slide of a
--    lecture, up to 20000 characters. Only the student who wrote a note can read, add, change or
--    delete it, and only for a lecture they joined. No teacher can read it, ever (no rule lets
--    them). Students can write in it during class and later from My spots.
-- 2. slide_marks (new table): the boxes a student draws on a slide. Several per slide, each a
--    rectangle stored as fractions of the slide, with a kind ('lost' red, 'save' yellow) and a
--    private note up to 2000 characters. At most 30 marks a slide and 300 a lecture for one
--    student. A student adds marks while the lecture is live, up to 15 minutes after it ends
--    (like taps), and after class from My spots for as long as the course lets them see the
--    slides; they change or delete their own marks any time (like Remove and Edit note in My
--    spots). The teacher of the course reads a 'lost' mark of their lecture only while that
--    student is lost on that slide (a lost tap there that is not undone): where the box is, never
--    its note (the note column can not be read by any signed in user directly; a student reads
--    their own notes through my_slide_marks), and never a 'save' mark.
-- 3. The highlight already on a tap (lost_taps.hl_x, hl_y, hl_w, hl_h) keeps working. Every
--    highlight that is on a tap that is not undone is copied into slide_marks (the mark gets the
--    tap's id, so running the file twice copies nothing twice), and from now on a highlight
--    saved, cleared, undone or moved on a tap is copied over by a trigger. So My spots and the
--    data view read marks from one place, whichever version of the app a student has open.
--    Deleting such a mark also clears the highlight on its tap, so it does not come back.
-- 4. slide_marks is added to Realtime (as 0007 did for lost_taps), for the live data view.
-- 5. PART 2, at the end: the note to the teacher (lost_taps.note) goes from 140 to 2000
--    characters. See the note there.
--
-- Nothing is dropped from the data and no existing row changes: part 1 creates two tables and
-- adds rows to one of them (the copied highlights); part 2 swaps one check for a wider one.

-- Before anything else: the 140 limit on the note to the teacher must be the check Postgres named
-- lost_taps_note_check (0007), the one part 2 replaces. If some other check on lost_taps.note is
-- there, part 2 would leave it in place and notes would still stop at 140, so the file stops here.
do $guard$
begin
  if exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.lost_taps'::regclass
      and c.contype = 'c'
      and c.conname <> 'lost_taps_note_check'
      and pg_get_constraintdef(c.oid) ~ '\mnote\M'
  ) then
    raise exception 'Stopped: lost_taps has a check on note that is not lost_taps_note_check, so the note limit could not be raised. Nothing was changed.';
  end if;
end
$guard$;

-- ============================================================================================
-- PART 1: adds only
-- ============================================================================================

-- 1. The notebook. ----------------------------------------------------------------------------

create table if not exists public.notebook_notes (
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  anon_id uuid not null default auth.uid(),
  slide_number int not null constraint notebook_notes_slide_check check (slide_number >= 1),
  body text not null default '' constraint notebook_notes_body_check check (length(body) <= 20000),
  updated_at timestamptz not null default now(),
  constraint notebook_notes_pkey primary key (lecture_id, anon_id, slide_number)
);

alter table public.notebook_notes enable row level security;

-- Signed in users read, add and delete rows (row level security picks whose) and change only the
-- text. Visitors get nothing. updated_at is the server's time, set by the trigger below.
revoke all on public.notebook_notes from anon, authenticated;
grant select, delete on public.notebook_notes to authenticated;
grant insert (lecture_id, anon_id, slide_number, body) on public.notebook_notes to authenticated;
grant update (body) on public.notebook_notes to authenticated;

create or replace function public.notebook_notes_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger notebook_notes_touch
  before insert or update on public.notebook_notes
  for each row execute function public.notebook_notes_touch();

-- 2. Marks. ---------------------------------------------------------------------------------

create table if not exists public.slide_marks (
  id uuid not null default gen_random_uuid() constraint slide_marks_pkey primary key,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  anon_id uuid not null default auth.uid(),
  slide_number int not null constraint slide_marks_slide_check check (slide_number >= 1),
  x real not null,
  y real not null,
  w real not null,
  h real not null,
  kind text not null default 'save' constraint slide_marks_kind_check check (kind in ('lost', 'save')),
  note text constraint slide_marks_note_check check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The box lies inside the slide (the same rule as the highlight on lost_taps, 0007).
  constraint slide_marks_rect_check check (
    x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= 1 and y + h <= 1
  )
);

create index if not exists slide_marks_lecture_anon_slide_idx
  on public.slide_marks (lecture_id, anon_id, slide_number);

alter table public.slide_marks enable row level security;

-- Column rights. note is left out of select on purpose: the teacher and the students are the same
-- database role, so no signed in user can select it from the table (nor does Realtime send it,
-- as it only sends the columns the role may select). A student reads their own notes through
-- my_slide_marks below. Who, which lecture, which slide and when are fixed at insert.
revoke all on public.slide_marks from anon, authenticated;
grant select (id, lecture_id, anon_id, slide_number, x, y, w, h, kind, created_at, updated_at)
  on public.slide_marks to authenticated;
grant insert (id, lecture_id, anon_id, slide_number, x, y, w, h, kind, note) on public.slide_marks to authenticated;
grant update (x, y, w, h, kind, note) on public.slide_marks to authenticated;
grant delete on public.slide_marks to authenticated;

create or replace function public.slide_marks_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger slide_marks_touch
  before update on public.slide_marks
  for each row execute function public.slide_marks_touch();

-- At most 30 marks on one slide and 300 in one lecture for one student (like 0012 for taps). Only
-- a signed in user adding their own mark is counted; owner-side inserts (the copy below) and
-- marks the tap trigger copies over (pg_trigger_depth() > 1: the highlight of a tap, which 0012
-- already counts as that tap) are left alone. A resend of a mark that already saved adds no row,
-- so it is never refused. The error is BT429, as for taps, with its own message. Two marks sent at
-- the same moment by one student wait for each other (a lock for that student and lecture, held
-- until the insert commits), so a burst can not slip past the count.
create or replace function public.slide_marks_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slide int;
  v_total int;
begin
  if auth.uid() is null or new.anon_id is distinct from auth.uid() or pg_trigger_depth() > 1 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('slide_marks:' || new.lecture_id::text || ':' || new.anon_id::text, 0));

  if exists (select 1 from public.slide_marks m where m.id = new.id) then
    return new;
  end if;

  select
    count(*) filter (where m.slide_number = new.slide_number),
    count(*)
  into v_slide, v_total
  from public.slide_marks m
  where m.lecture_id = new.lecture_id
    and m.anon_id = new.anon_id;

  if v_slide >= 30 then
    raise exception 'Too many marks on this slide.' using errcode = 'BT429';
  end if;
  if v_total >= 300 then
    raise exception 'Too many marks in this lecture.' using errcode = 'BT429';
  end if;

  return new;
end;
$$;

create or replace trigger slide_marks_limit
  before insert on public.slide_marks
  for each row execute function public.slide_marks_limit();

-- Trigger functions only run as triggers; nobody needs to call them.
revoke all on function public.notebook_notes_touch() from public, anon, authenticated;
revoke all on function public.slide_marks_touch() from public, anon, authenticated;
revoke all on function public.slide_marks_limit() from public, anon, authenticated;

-- A student's own marks, with their notes (the only way to read a note). One lecture, or every
-- lecture when p_lecture_id is null (My lectures). Never anyone else's marks.
create or replace function public.my_slide_marks(p_lecture_id uuid default null)
returns table (
  id uuid,
  lecture_id uuid,
  slide_number int,
  x real,
  y real,
  w real,
  h real,
  kind text,
  note text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.lecture_id, m.slide_number, m.x, m.y, m.w, m.h, m.kind, m.note, m.created_at, m.updated_at
  from public.slide_marks m
  where auth.uid() is not null
    and m.anon_id = auth.uid()
    and (p_lecture_id is null or m.lecture_id = p_lecture_id)
  order by m.lecture_id, m.slide_number, m.created_at, m.id
$$;

revoke all on function public.my_slide_marks(uuid) from public, anon;
grant execute on function public.my_slide_marks(uuid) to authenticated;

-- 3. Saving a notebook note in one call. ------------------------------------------------------
--
-- Adds the note for that slide or replaces its text; an empty (or only spaces) text removes the
-- note. Security invoker: row level security decides, exactly as for a direct insert, update or
-- delete by the student. Returns when it was saved (null when removed).
create or replace function public.save_notebook_note(p_lecture_id uuid, p_slide_number int, p_body text)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  if btrim(coalesce(p_body, ''), E' \t\r\n') = '' then
    delete from public.notebook_notes n
    where n.lecture_id = p_lecture_id and n.anon_id = auth.uid() and n.slide_number = p_slide_number;
    return null;
  end if;

  insert into public.notebook_notes as n (lecture_id, anon_id, slide_number, body)
  values (p_lecture_id, auth.uid(), p_slide_number, p_body)
  on conflict (lecture_id, anon_id, slide_number) do update set body = excluded.body
  returning n.updated_at into v_at;

  return v_at;
end;
$$;

revoke all on function public.save_notebook_note(uuid, int, text) from public, anon;
grant execute on function public.save_notebook_note(uuid, int, text) to authenticated;

-- 4. Row level security. ------------------------------------------------------------------------
--
-- "create policy" has no "if not exists", so each one is made only when it is missing (the file
-- can run twice without dropping anything).

do $policies$
begin
  -- Notebook: the student's own rows of lectures they joined. No teacher policy at all.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notebook_notes' and policyname = 'notebook_notes_select_own') then
    create policy notebook_notes_select_own on public.notebook_notes
      for select to authenticated
      using (anon_id = auth.uid() and public.joined_lecture(lecture_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notebook_notes' and policyname = 'notebook_notes_insert_own') then
    create policy notebook_notes_insert_own on public.notebook_notes
      for insert to authenticated
      with check (
        anon_id = auth.uid()
        and public.joined_lecture(lecture_id)
        and exists (
          select 1
          from public.lectures l
          where l.id = notebook_notes.lecture_id
            and notebook_notes.slide_number between 1 and l.slide_count
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notebook_notes' and policyname = 'notebook_notes_update_own') then
    create policy notebook_notes_update_own on public.notebook_notes
      for update to authenticated
      using (anon_id = auth.uid() and public.joined_lecture(lecture_id))
      with check (anon_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notebook_notes' and policyname = 'notebook_notes_delete_own') then
    create policy notebook_notes_delete_own on public.notebook_notes
      for delete to authenticated
      using (anon_id = auth.uid() and public.joined_lecture(lecture_id));
  end if;

  -- Marks: the student's own rows of lectures they joined; added while the lecture is live, up
  -- to 15 minutes after it ended (as taps, 0007), or after class from My spots while the course
  -- still lets the student see the slides (student_can_see_lecture, 0016/0019); changed or
  -- deleted any time.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'slide_marks' and policyname = 'slide_marks_select_own') then
    create policy slide_marks_select_own on public.slide_marks
      for select to authenticated
      using (anon_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'slide_marks' and policyname = 'slide_marks_insert_own') then
    create policy slide_marks_insert_own on public.slide_marks
      for insert to authenticated
      with check (
        anon_id = auth.uid()
        and public.joined_lecture(lecture_id)
        and exists (
          select 1
          from public.lectures l
          where l.id = slide_marks.lecture_id
            and slide_marks.slide_number between 1 and l.slide_count
            and (
              l.status = 'live'
              or l.ended_at > now() - interval '15 minutes'
              or public.student_can_see_lecture(l.id)
            )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'slide_marks' and policyname = 'slide_marks_update_own') then
    create policy slide_marks_update_own on public.slide_marks
      for update to authenticated
      using (anon_id = auth.uid() and public.joined_lecture(lecture_id))
      with check (anon_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'slide_marks' and policyname = 'slide_marks_delete_own') then
    create policy slide_marks_delete_own on public.slide_marks
      for delete to authenticated
      using (anon_id = auth.uid() and public.joined_lecture(lecture_id));
  end if;

  -- The teacher reads the 'lost' marks of their own lectures (the box, not the note: see the
  -- column rights above), never a 'save', and only while that student is lost on that slide: a
  -- lost tap of theirs on it that is not undone (read as the teacher, who may read the lecture's
  -- lost taps, 0007). A mark whose student took the I'm lost back leaves the teacher's view.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'slide_marks' and policyname = 'slide_marks_select_teacher') then
    create policy slide_marks_select_teacher on public.slide_marks
      for select to authenticated
      using (
        kind = 'lost'
        and public.owns_lecture(lecture_id)
        and exists (
          select 1
          from public.lost_taps t
          where t.lecture_id = slide_marks.lecture_id
            and t.anon_id = slide_marks.anon_id
            and t.slide_number = slide_marks.slide_number
            and t.kind = 'lost'
            and not t.undone
        )
      );
  end if;
end
$policies$;

-- 5. The highlight on a tap, copied into slide_marks. -----------------------------------------
--
-- The mark gets the tap's id. Whenever a tap's highlight is saved, cleared or moved, or the tap is
-- undone (or brought back), the mark follows, so an app that still saves the highlight on the tap
-- (an open tab from before) keeps the marks right. Only for that student's own mark with that id.
create or replace function public.lost_taps_copy_mark() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the slide moved: the mark moves with it and keeps its box.
  if tg_op = 'UPDATE'
    and new.hl_x is not distinct from old.hl_x and new.hl_y is not distinct from old.hl_y
    and new.hl_w is not distinct from old.hl_w and new.hl_h is not distinct from old.hl_h
    and new.undone = old.undone
  then
    update public.slide_marks m
    set slide_number = new.slide_number
    where m.id = new.id and m.anon_id = new.anon_id and m.slide_number <> new.slide_number;
    return null;
  end if;

  if new.hl_x is not null and not new.undone then
    insert into public.slide_marks as m (id, lecture_id, anon_id, slide_number, x, y, w, h, kind, created_at, updated_at)
    values (new.id, new.lecture_id, new.anon_id, new.slide_number, new.hl_x, new.hl_y, new.hl_w, new.hl_h, new.kind,
            coalesce(new.created_at, now()), now())
    on conflict (id) do update
      set slide_number = excluded.slide_number, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
          kind = excluded.kind
      where m.anon_id = excluded.anon_id and m.lecture_id = excluded.lecture_id;
    return null;
  end if;

  -- Cleared or undone: the mark goes too.
  if tg_op = 'UPDATE' then
    delete from public.slide_marks m where m.id = new.id and m.anon_id = new.anon_id;
  end if;
  return null;
end;
$$;

revoke all on function public.lost_taps_copy_mark() from public, anon, authenticated;

create or replace trigger lost_taps_copy_mark
  after insert or update of hl_x, hl_y, hl_w, hl_h, undone, slide_number on public.lost_taps
  for each row execute function public.lost_taps_copy_mark();

-- Deleting the copy of a tap's highlight (in My spots or on the live screen) clears the highlight
-- on the tap too, so an older open tab does not show it and running this file again does not copy
-- it back. Not when the delete comes from another trigger (a lecture being deleted, or the tap
-- trigger above): there is nothing to clear then.
create or replace function public.slide_marks_clear_tap() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 then
    update public.lost_taps t
    set hl_x = null, hl_y = null, hl_w = null, hl_h = null
    where t.id = old.id and t.anon_id = old.anon_id and t.hl_x is not null;
  end if;
  return null;
end;
$$;

revoke all on function public.slide_marks_clear_tap() from public, anon, authenticated;

create or replace trigger slide_marks_clear_tap
  after delete on public.slide_marks
  for each row execute function public.slide_marks_clear_tap();

-- The highlights already saved on taps that are not undone. on conflict: a second run (or a mark
-- the trigger above already copied) adds nothing.
insert into public.slide_marks (id, lecture_id, anon_id, slide_number, x, y, w, h, kind, created_at, updated_at)
select t.id, t.lecture_id, t.anon_id, t.slide_number, t.hl_x, t.hl_y, t.hl_w, t.hl_h, t.kind,
       coalesce(t.created_at, t.tapped_at), coalesce(t.created_at, t.tapped_at)
from public.lost_taps t
where t.hl_x is not null and t.hl_y is not null and t.hl_w is not null and t.hl_h is not null
  and not t.undone
on conflict (id) do nothing;

-- 6. Realtime, for the live data view. ---------------------------------------------------------
--
-- Like 0007_realtime.remote.sql for lost_taps, but only when the publication is there (hosted
-- Supabase) and the table is not in it yet, so the file can run twice and anywhere. Replica
-- identity full lets a deleted mark reach a teacher listening to one lecture (lecture_id=eq.…);
-- Realtime still sends only the deleted mark's id, never its other columns.
alter table public.slide_marks replica identity full;

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'slide_marks'
    )
  then
    alter publication supabase_realtime add table public.slide_marks;
  end if;
end
$realtime$;

-- ============================================================================================
-- PART 2: the note to the teacher, 140 to 2000 characters (marked: this statement says "drop")
--
-- A check constraint can not be changed in place, so the 140 check that 0007 put on
-- lost_taps.note (named lost_taps_note_check by Postgres) is dropped and added again with the same
-- name and 2000 in ONE statement: there is no moment without a limit, and the new check is tested
-- against every existing note as it is added (they all pass: every one is 140 or less). No column,
-- no note and no row is dropped or changed; "drop constraint" removes only the old rule. "if
-- exists" lets the file run twice. Supabase's destructive operations box looks for statements
-- that start with drop, delete or truncate, or "alter table ... drop column"; this one starts with
-- "alter table" and drops a constraint, not a column (replayed: see the batch J report).
-- ============================================================================================

alter table public.lost_taps
  drop constraint if exists lost_taps_note_check,
  add constraint lost_taps_note_check check (length(note) <= 2000);
