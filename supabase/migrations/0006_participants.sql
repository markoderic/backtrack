-- Students join a live lecture with its code. An anonymous Supabase user (role
-- authenticated, is_anonymous) is the student; anon_id is their auth.uid().
create table public.participants (
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  anon_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (lecture_id, anon_id)
);

alter table public.participants enable row level security;

-- True when the signed in user has joined this lecture.
-- security definer so the policies on lectures, slides and storage can call it.
create function public.joined_lecture(p_lecture_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants p
    where p.lecture_id = p_lecture_id and p.anon_id = auth.uid()
  )
$$;

revoke all on function public.joined_lecture(uuid) from public, anon;
grant execute on function public.joined_lecture(uuid) to authenticated;

-- No insert, update or delete policies: only join_lecture adds a participant.
create policy participants_select_own on public.participants
  for select to authenticated
  using (anon_id = auth.uid());

create policy participants_select_teacher on public.participants
  for select to authenticated
  using (public.owns_lecture(lecture_id));

-- A student reads the lectures they joined, ended ones too (My spots needs the images).
create policy lectures_select_joined on public.lectures
  for select to authenticated
  using (public.joined_lecture(id));

create policy slides_select_joined on public.slides
  for select to authenticated
  using (public.joined_lecture(lecture_id));

-- Replaces the policy from 0004 to add students who joined the lecture.
drop policy slides_select on storage.objects;

create policy slides_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'slides'
    and (
      owner = auth.uid()
      or public.owns_lecture(
        case
          when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[1])::uuid
        end
      )
      or public.joined_lecture(
        case
          when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[1])::uuid
        end
      )
    )
  );

-- Adds the caller to the live lecture with this code and returns the lecture id.
-- The error is the same for a code that never existed and a lecture that ended:
-- a code stops resolving when the lecture ends.
create function public.join_lecture(p_code text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  select l.id into v_id
  from public.lectures l
  where l.status = 'live' and l.code = btrim(coalesce(p_code, ''), E' \t\r\n');

  if v_id is null then
    raise exception 'not_found';
  end if;

  insert into public.participants (lecture_id, anon_id)
  values (v_id, auth.uid())
  on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.join_lecture(text) from public, anon;
grant execute on function public.join_lecture(text) to authenticated;

-- The names the student screen shows. Students cannot read courses, so this is
-- the only way they get the course name. No row unless the caller joined the
-- lecture or owns it.
create function public.lecture_header(p_lecture_id uuid)
returns table (lecture_name text, course_name text)
language sql stable security definer
set search_path = ''
as $$
  select l.name, c.name
  from public.lectures l
  join public.courses c on c.id = l.course_id
  where l.id = p_lecture_id
    and (public.joined_lecture(l.id) or public.owns_lecture(l.id))
$$;

revoke all on function public.lecture_header(uuid) from public, anon;
grant execute on function public.lecture_header(uuid) to authenticated;
