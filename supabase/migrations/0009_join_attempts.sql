-- Part 1: limit wrong join codes.
--
-- Per user, not per IP, because Postgres can't see the client IP: Supabase already caps anonymous sign ins at 500 per hour per IP, so per session limiting bounds a brute forcer to ~5000 guesses an hour per IP against 900,000 codes.
create table public.join_attempts (
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);

create index join_attempts_user_id_attempted_at_idx
  on public.join_attempts (user_id, attempted_at);

-- No policies and no grants: only join_lecture (security definer) touches it.
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

-- Replaces join_lecture from 0006. A wrong code now returns null instead of
-- raising not_found, because a raise would roll back the attempt row.
-- After 10 wrong codes in 10 minutes the caller gets too_many_attempts, even for
-- a right code. A successful join adds no attempt row.
create or replace function public.join_lecture(p_code text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  if (
    select count(*)
    from public.join_attempts a
    where a.user_id = auth.uid() and a.attempted_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'too_many_attempts';
  end if;

  select l.id into v_id
  from public.lectures l
  where l.status = 'live' and l.code = btrim(coalesce(p_code, ''), E' \t\r\n');

  if v_id is null then
    insert into public.join_attempts (user_id) values (auth.uid());
    delete from public.join_attempts
    where user_id = auth.uid() and attempted_at < now() - interval '1 day';
    return null;
  end if;

  insert into public.participants (lecture_id, anon_id)
  values (v_id, auth.uid())
  on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.join_lecture(text) from public, anon;
grant execute on function public.join_lecture(text) to authenticated;

-- Part 2: lecture_date in Eastern time.
--
-- The default current_date is UTC on Supabase, so a lecture started after about
-- 8 PM Eastern got tomorrow's date. start_lecture (0003) does not set
-- lecture_date, so it picks up this default and needs no change.
create or replace function public.eastern_date(p_at timestamptz) returns date
language sql stable
as $$
  select (p_at at time zone 'America/New_York')::date
$$;

alter table public.lectures alter column lecture_date set default public.eastern_date(now());

-- Fixes the lectures already stored with a UTC date.
update public.lectures
set lecture_date = public.eastern_date(started_at)
where lecture_date <> public.eastern_date(started_at);
