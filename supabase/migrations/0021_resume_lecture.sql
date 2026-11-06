-- 0021: open an ended lecture again (Marko, Nov 6: some professors keep one deck, with hundreds
-- of slides, for the whole semester, so they keep one lecture and open it again each class).
-- Run it after 0020. It can run twice. It only adds a function; nothing that exists changes.
--
-- WHAT CHANGES (plain English, for Marko)
--
-- resume_lecture(lecture): the teacher who owns an ended lecture opens it again. It goes back to
-- live with a new 6 digit join code (its old code was freed when it ended, so another lecture may
-- be using it now), on the slide it was on. Its slides, I'm lost taps, notes and marks all stay.
-- Students who joined before join again with the new code and pick up where they were (join
-- already lets a student back into a lecture they joined). The lecture keeps its name and date.
-- Ending it again works as before (End class). Resuming a lecture that is already live changes
-- nothing and gives back its code. Only the owner can do it, the same rule as End class.
create or replace function public.resume_lecture(p_lecture_id uuid)
returns table (lecture_id uuid, code text)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text;
  v_code text;
  v_tries int := 0;
  v_constraint text;
begin
  if auth.uid() is null or not public.is_teacher() or not public.owns_lecture(p_lecture_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select l.status, l.code into v_status, v_code
  from public.lectures l
  where l.id = p_lecture_id
  for update;

  if v_status = 'live' then
    lecture_id := p_lecture_id;
    code := v_code;
    return next;
    return;
  end if;

  -- A new free code, the same way start_lecture picks one.
  loop
    v_tries := v_tries + 1;
    v_code := (100000 + floor(random() * 900000)::int)::text;
    begin
      update public.lectures l
      set status = 'live', code = v_code, ended_at = null
      where l.id = p_lecture_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'lectures_live_code_idx' then
        raise;
      end if;
      if v_tries >= 20 then
        raise exception 'Could not find a free lecture code. Try again.' using errcode = '53400';
      end if;
    end;
  end loop;

  lecture_id := p_lecture_id;
  code := v_code;
  return next;
end;
$$;

revoke all on function public.resume_lecture(uuid) from public, anon;
grant execute on function public.resume_lecture(uuid) to authenticated;
