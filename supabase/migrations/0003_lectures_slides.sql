-- Lectures and their slides. A lecture is created only through start_lecture,
-- which checks the caller owns the course and makes the lecture, its slides and
-- a free 6 digit code in one transaction.
create table public.lectures (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  lecture_date date not null default current_date,
  code char(6) check (code ~ '^[1-9][0-9]{5}$'),
  status text not null check (status in ('live', 'ended')),
  current_slide int not null default 1,
  slide_count int not null check (slide_count >= 1),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (current_slide between 1 and slide_count),
  check (status <> 'live' or code is not null)
);

create index lectures_course_id_idx on public.lectures (course_id);

-- A code is only unique among live lectures, so an ended lecture frees its code.
create unique index lectures_live_code_idx on public.lectures (code) where status = 'live';

create table public.slides (
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  number int not null check (number >= 1),
  image_path text not null,
  first_line text not null default '',
  primary key (lecture_id, number)
);

-- True when the signed in user owns the course this lecture belongs to.
-- security definer so policies on lectures, slides and storage can call it.
create function public.owns_lecture(p_lecture_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lectures l
    join public.courses c on c.id = l.course_id
    where l.id = p_lecture_id and c.teacher_id = auth.uid()
  )
$$;

alter table public.lectures enable row level security;
alter table public.slides enable row level security;

-- No insert or delete policies: lectures are created by start_lecture only.
create policy lectures_select_own on public.lectures
  for select to authenticated
  using (public.owns_lecture(id));

-- The check reads the course directly, because owns_lecture would still see the
-- old course_id while the update is running.
create policy lectures_update_own on public.lectures
  for update to authenticated
  using (public.owns_lecture(id))
  with check (
    exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

create policy slides_select_own on public.slides
  for select to authenticated
  using (public.owns_lecture(lecture_id));

create policy slides_update_own on public.slides
  for update to authenticated
  using (public.owns_lecture(lecture_id))
  with check (public.owns_lecture(lecture_id));

-- Creates a live lecture with its slides and a random free code.
-- p_slides: [{number, image_path, first_line}, ...] numbered 1 to n, and every
-- image_path starts with "<p_lecture_id>/".
create function public.start_lecture(p_lecture_id uuid, p_course_id uuid, p_name text, p_slides jsonb)
returns table (lecture_id uuid, code text)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_name text := trim(coalesce(p_name, ''));
  v_count int;
  v_code text;
  v_tries int := 0;
  v_constraint text;
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception 'Only teachers can start a lecture.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.courses c where c.id = p_course_id and c.teacher_id = auth.uid()) then
    raise exception 'You do not own that course.' using errcode = '42501';
  end if;

  if length(v_name) not between 1 and 120 then
    raise exception 'The lecture name must be 1 to 120 characters.' using errcode = '22023';
  end if;

  if p_slides is null or jsonb_typeof(p_slides) <> 'array' or jsonb_array_length(p_slides) = 0 then
    raise exception 'p_slides must be a non empty array of slides.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_slides);

  -- Every element needs an integer number, a path inside this lecture's folder and
  -- (when present) a text first_line, and the numbers must be exactly 1 to n.
  if exists (
    select 1
    from jsonb_array_elements(p_slides) as e(el)
    where jsonb_typeof(el) <> 'object'
      or jsonb_typeof(el -> 'number') is distinct from 'number'
      or (el ->> 'number') !~ '^[1-9][0-9]{0,5}$'
      or jsonb_typeof(el -> 'image_path') is distinct from 'string'
      or left(el ->> 'image_path', length(p_lecture_id::text) + 1) <> p_lecture_id::text || '/'
      or (el ? 'first_line' and jsonb_typeof(el -> 'first_line') not in ('string', 'null'))
  ) or (
    select count(distinct (el ->> 'number')::int) <> v_count or max((el ->> 'number')::int) <> v_count
    from jsonb_array_elements(p_slides) as e(el)
  ) then
    raise exception 'p_slides must be objects numbered 1 to % with an image_path inside the lecture folder.', v_count
      using errcode = '22023';
  end if;

  loop
    v_tries := v_tries + 1;
    v_code := (100000 + floor(random() * 900000)::int)::text;
    begin
      insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count)
      values (p_lecture_id, p_course_id, v_name, v_code, 'live', 1, v_count);
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Only a taken code is worth retrying; a reused lecture id is the caller's bug.
      if v_constraint is distinct from 'lectures_live_code_idx' then
        raise;
      end if;
      if v_tries >= 20 then
        raise exception 'Could not find a free lecture code. Try again.' using errcode = '53400';
      end if;
    end;
  end loop;

  insert into public.slides (lecture_id, number, image_path, first_line)
  select p_lecture_id,
         (el ->> 'number')::int,
         el ->> 'image_path',
         left(coalesce(el ->> 'first_line', ''), 200)
  from jsonb_array_elements(p_slides) as e(el);

  lecture_id := p_lecture_id;
  code := v_code;
  return next;
end;
$$;

revoke all on function public.start_lecture(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.start_lecture(uuid, uuid, text, jsonb) to authenticated;
