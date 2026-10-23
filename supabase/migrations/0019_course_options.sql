-- 0019: more course colors and more "Students can see slides until" choices (batch H).
-- Run it after 0018. The app already works before this file (it shows the eight colors and the
-- three choices from before) and offers the new ones once it has run.
--
-- WHAT CHANGES (plain English, for Marko)
--
-- Colors (courses.color): the eight names from 0018 still work. Added: red, orange and pink, and
-- any color the teacher picks, stored as '#rrggbb' (lowercase). Nothing else is taken.
--
-- Students can see slides until (courses.student_access): 'semester', '30d' and 'always' still
-- work and mean the same. Added:
--   '7d'           a week after each class ends
--   'custom_days'  a number of days after each class ends, in the new column access_days (1 to 365)
--   'custom_date'  until a date the teacher picks, in the new column access_until. Every lecture,
--                  old or new, is hidden from students after that day (a live one stays visible
--                  while it is live). This is its own column, not semester_end: End of semester
--                  keeps its date (and its "the usual date moves on to the next semester by itself"
--                  rule) when the teacher tries Custom, and a custom date means one hard end for
--                  the whole course instead of the semester rule's "a date before the lecture is
--                  ignored for that lecture".
-- Days end at midnight in Oxford, Ohio (America/New_York), like 0016: "until Mar 3" means the
-- slides can still be opened all of Mar 3.
--
-- Nothing is dropped from the data and no row changes. Two new columns start empty for every
-- course, and every course keeps its color and its choice.
--
-- PART 1 adds and replaces only (new columns, a column grant, the access function).
-- PART 2, at the end, swaps two check constraints for wider ones and adds one more check. Those
-- statements say "drop constraint", so they are kept apart and marked; see the note there.

-- ============================================================================================
-- PART 1: adds and replaces only
-- ============================================================================================

alter table public.courses
  add column if not exists access_days integer
    constraint courses_access_days_check check (access_days is null or access_days between 1 and 365),
  add column if not exists access_until date
    constraint courses_access_until_check
    check (access_until is null or access_until between date '2020-01-01' and date '2100-12-31');

-- 0014 gave teachers back only (name, archived) on courses; 0016 and 0018 added the setting and
-- the details. Row level security (courses_update_own) still keeps every change to their own course.
grant update (access_days, access_until) on public.courses to authenticated;

-- The same function as 0016 (same name, argument and result, so its grants stay as they are:
-- signed in users only, never anon), with the three new choices.
create or replace function public.student_can_see_lecture(p_lecture_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lectures l
    join public.courses c on c.id = l.course_id
    join public.participants p on p.lecture_id = l.id and p.anon_id = auth.uid()
    cross join lateral (
      select make_date(extract(year from l.lecture_date)::int, 5, 15) as spring_end,
             make_date(extract(year from l.lecture_date)::int, 12, 18) as fall_end
    ) d
    where l.id = p_lecture_id
      and (
        l.status = 'live'
        or c.student_access = 'always'
        or (c.student_access = '30d'
            and now() < coalesce(l.ended_at, l.started_at) + interval '30 days')
        or (c.student_access = '7d'
            and now() < coalesce(l.ended_at, l.started_at) + interval '7 days')
        or (c.student_access = 'custom_days'
            and c.access_days is not null
            and now() < coalesce(l.ended_at, l.started_at) + make_interval(days => c.access_days))
        or (c.student_access = 'custom_date'
            and c.access_until is not null
            and now() < (c.access_until + 1)::timestamp at time zone 'America/New_York')
        or (c.student_access = 'semester'
            and now() < (
              (case
                 when c.semester_end is not null and c.semester_end >= l.lecture_date then c.semester_end
                 when l.lecture_date <= d.spring_end then d.spring_end
                 when l.lecture_date <= d.fall_end then d.fall_end
                 else (d.spring_end + interval '1 year')::date
               end + 1)::timestamp at time zone 'America/New_York'))
      )
  )
$$;

-- ============================================================================================
-- PART 2: check constraints swapped for wider ones (marked: these statements contain "drop")
--
-- A check constraint can not be changed in place, so each one is dropped and added again with the
-- same name in ONE statement: there is no moment without it, and the new check is tested against
-- every existing row as it is added (they all pass: the new lists only add values). No column and
-- no data is dropped; "drop constraint" removes only the old rule. "if exists" lets the file run
-- twice. Supabase's destructive operations box looks for statements that start with drop, delete
-- or truncate, or "alter table ... drop column"; these start with "alter table" and drop a
-- constraint, not a column (replayed: see the batch H report).
-- ============================================================================================

alter table public.courses
  drop constraint if exists courses_color_check,
  add constraint courses_color_check
    check (color is null
           or color in ('red', 'orange', 'ochre', 'olive', 'green', 'teal', 'blue', 'indigo', 'plum', 'pink', 'slate')
           or color ~ '^#[0-9a-f]{6}$');

alter table public.courses
  drop constraint if exists courses_student_access_check,
  add constraint courses_student_access_check
    check (student_access in ('semester', '30d', '7d', 'always', 'custom_days', 'custom_date'));

-- A custom choice always comes with its number of days or its date. New, but kept here with the
-- other two so the file can run twice (a constraint has no "add ... if not exists").
alter table public.courses
  drop constraint if exists courses_access_custom_check,
  add constraint courses_access_custom_check
    check ((student_access <> 'custom_days' or access_days is not null)
           and (student_access <> 'custom_date' or access_until is not null));
