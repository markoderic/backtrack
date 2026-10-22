-- 0016: how long students can see a course's slides. Adds only: two columns, one
-- column grant and one function. Nothing is dropped, revoked or rewritten, and no
-- row changes. Nothing reads the new function until 0017 puts it in the policies, so
-- after this file alone students see exactly what they saw before.
--
-- courses.student_access, the teacher's choice for "Students can see slides until":
--   'semester'  the end of the semester (the default for every course, old and new)
--   '30d'       30 days after each class ends
--   'always'    no end
-- courses.semester_end, the semester's last day for 'semester'. Empty means the
-- usual end of the semester the lecture was in: May 15 for a lecture on or before
-- May 15, else Dec 18 (a lecture after Dec 18 runs to May 15 of the next year).
-- A date before a lecture's own date is not taken as that lecture's end (a course
-- whose date is still last semester's never hides a new lecture right after class);
-- that lecture gets the usual end instead.
--
-- Days end at midnight in Oxford, Ohio (America/New_York): "until Dec 18" means
-- students can still open the slides all of Dec 18.

alter table public.courses
  add column if not exists student_access text not null default 'semester'
    constraint courses_student_access_check check (student_access in ('semester', '30d', 'always')),
  add column if not exists semester_end date
    constraint courses_semester_end_check check (semester_end is null or semester_end between date '2020-01-01' and date '2100-12-31');

-- 0014 gave teachers back only (name, archived) on courses. The setting needs these
-- two as well; row level security (courses_update_own) still keeps it to their own course.
grant update (student_access, semester_end) on public.courses to authenticated;

-- True when the signed in student joined this lecture and may still see its slides:
-- always while the lecture is live, then as long as the course's setting allows.
-- security definer so the policies on slides and storage (0017) can call it. A teacher
-- reading their own slides never needs it: their own policies (owns_lecture) allow it.
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

revoke all on function public.student_can_see_lecture(uuid) from public, anon;
grant execute on function public.student_can_see_lecture(uuid) to authenticated;
