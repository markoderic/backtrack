-- The live data view and ending a lecture.

-- How many students are lost on each slide. One row per slide from 1 to
-- slide_count, zeros included. Only a tap with kind 'lost' that is not undone
-- counts: a save never does, and an undone tap is taken back. taps counts the
-- rows, students counts the different people behind them. The caller must own
-- the lecture or have joined it. It returns counts only, never notes.
create function public.lecture_slide_stats(p_lecture_id uuid)
returns table (slide_number int, taps int, students int)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_count int;
begin
  if auth.uid() is null
    or not (public.owns_lecture(p_lecture_id) or public.joined_lecture(p_lecture_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select l.slide_count into v_count from public.lectures l where l.id = p_lecture_id;

  return query
  select g.n,
         coalesce(c.tap_count, 0)::int,
         coalesce(c.student_count, 0)::int
  from generate_series(1, v_count) as g(n)
  left join (
    select t.slide_number as sn,
           count(*) as tap_count,
           count(distinct t.anon_id) as student_count
    from public.lost_taps t
    where t.lecture_id = p_lecture_id and t.kind = 'lost' and not t.undone
    group by t.slide_number
  ) c on c.sn = g.n
  order by g.n;
end;
$$;

revoke all on function public.lecture_slide_stats(uuid) from public, anon;
grant execute on function public.lecture_slide_stats(uuid) to authenticated;

-- Ends a lecture: status ended, ended_at now, and the code is cleared so it
-- stops working (join_lecture then raises not_found, and the code is free again).
-- Owner only. Ending a lecture that already ended changes nothing.
create function public.end_lecture(p_lecture_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.owns_lecture(p_lecture_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  update public.lectures
  set status = 'ended', ended_at = now(), code = null
  where id = p_lecture_id and status = 'live';
end;
$$;

revoke all on function public.end_lecture(uuid) from public, anon;
grant execute on function public.end_lecture(uuid) to authenticated;
