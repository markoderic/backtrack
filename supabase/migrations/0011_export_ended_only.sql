-- The semester CSV export now includes only ended lectures. A live lecture is still
-- being taught, so its slides and taps are left out until it ends. Everything else is
-- the same as in 0010: owner of the course only, one row per slide with zeros filled
-- in, only lost taps that are not undone, counts and never notes.
--
-- create or replace keeps the permissions 0010 set (signed in teachers only), so this
-- file only replaces the function body.
create or replace function public.course_export(p_course_id uuid)
returns table (lecture_date date, lecture_name text, slide_number int, first_line text, lost_taps int, students int)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
    or not exists (select 1 from public.courses c where c.id = p_course_id and c.teacher_id = auth.uid()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return query
  select l.lecture_date,
         l.name,
         g.n,
         coalesce(s.first_line, ''),
         coalesce(c.tap_count, 0)::int,
         coalesce(c.student_count, 0)::int
  from public.lectures l
  cross join lateral generate_series(1, l.slide_count) as g(n)
  left join public.slides s on s.lecture_id = l.id and s.number = g.n
  left join (
    select t.lecture_id as lid,
           t.slide_number as sn,
           count(*) as tap_count,
           count(distinct t.anon_id) as student_count
    from public.lost_taps t
    where t.kind = 'lost'
      and not t.undone
      and t.lecture_id in (select l2.id from public.lectures l2 where l2.course_id = p_course_id)
    group by t.lecture_id, t.slide_number
  ) c on c.lid = l.id and c.sn = g.n
  where l.course_id = p_course_id
    and l.status = 'ended'
  order by l.lecture_date, l.started_at, l.id, g.n;
end;
$$;
