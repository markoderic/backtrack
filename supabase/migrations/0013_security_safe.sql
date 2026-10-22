-- Delete lecture and security hardening that only adds things.
--
-- Nothing here drops, revokes, deletes or rewrites data when it runs: a guard that stops
-- the file if start_lecture could not read storage (part 2), create or replace function,
-- create or replace trigger, create index if not exists, and three new policies. The
-- changes that need revoke are in 0014.
--
-- 1. delete_lecture, and a storage delete policy for images no lecture uses.
-- 2. start_lecture refuses to start unless every slide image is in the slides bucket.
-- 3. lost_taps.tapped_at more than 1 minute in the future is stored as the server's time.
-- 4. Slide uploads only into a free lecture id or a lecture the teacher owns, named
--    <lecture uuid>/<n>.webp or .jpg (a restrictive policy, added on top of 0004's).
-- 5. my_orphan_slide_images: a teacher's own unused uploads older than a day.

-- Part 1: deleting a lecture.

-- True when a slides row points at this storage object. Storage policies call it to
-- keep an image that a lecture still uses. security definer so it sees every lecture's
-- slides, not only the caller's.
create or replace function public.slide_image_in_use(p_name text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.slides s where s.image_path = p_name)
$$;

revoke all on function public.slide_image_in_use(text) from public, anon;
grant execute on function public.slide_image_in_use(text) to authenticated;

create index if not exists slides_image_path_idx on public.slides (image_path);

-- A teacher may remove a slide image they uploaded once no lecture uses it: after the
-- lecture is deleted, or when a start failed and left the image behind. The image of a
-- lecture that still exists can not be removed. (Storage's remove() runs this check as
-- the signed in user.)
create policy slides_delete_unused on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'slides'
    and owner = auth.uid()
    and not public.slide_image_in_use(name)
  );

-- Deletes an ended lecture of the caller's own course and everything attached to it:
-- its slides rows, participants and taps go with it through the on delete cascade
-- foreign keys (0003, 0006, 0007). A live lecture is refused: end it first.
-- Returns the course and the storage paths of the lecture's slide images, so the app
-- can remove them from the slides bucket with the Storage API (SQL can not remove
-- storage files). Only paths inside the lecture's own folder are returned, so a shared
-- image (the demo semester's demo/placeholder.webp) is never removed.
create or replace function public.delete_lecture(p_lecture_id uuid)
returns table (course_id uuid, image_paths text[])
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_course uuid;
  v_status text;
  v_paths text[];
  v_gone int;
begin
  if auth.uid() is null or not public.owns_lecture(p_lecture_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select l.course_id, l.status into v_course, v_status
  from public.lectures l
  where l.id = p_lecture_id
  for update;

  if v_status = 'live' then
    raise exception 'live_lecture' using errcode = '55000', hint = 'End the lecture first, then delete it.';
  end if;

  select coalesce(array_agg(distinct s.image_path), '{}')
  into v_paths
  from public.slides s
  where s.lecture_id = p_lecture_id
    and left(s.image_path, 37) = p_lecture_id::text || '/';

  with gone as (
    delete from public.lectures l where l.id = p_lecture_id returning l.id
  )
  select count(*) into v_gone from gone;

  if v_gone <> 1 then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  course_id := v_course;
  image_paths := v_paths;
  return next;
end;
$$;

revoke all on function public.delete_lecture(uuid) from public, anon;
grant execute on function public.delete_lecture(uuid) to authenticated;

-- Part 2: start_lecture checks that every slide image is in storage.
--
-- start_lecture reads storage.objects as the function's owner (postgres on Supabase).
-- storage.objects has row level security, so that only works when the owner bypasses it
-- (superuser, bypassrls or the table's owner). If it did not, the check below would see
-- no images and refuse every lecture, so this stops the whole migration instead.
do $guard$
begin
  if not exists (
    select 1 from pg_roles r
    where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)
  ) and not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and pg_get_userbyid(c.relowner) = current_user
  ) then
    raise exception 'Stopped: % can not read every row of storage.objects, so start_lecture could not see the slide images. Nothing was changed.', current_user;
  end if;
end
$guard$;

-- Same as 0003 (create or replace keeps its grants: signed in users only), plus the
-- missing_images check before the lecture row is made.
create or replace function public.start_lecture(p_lecture_id uuid, p_course_id uuid, p_name text, p_slides jsonb)
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

  -- D5 on the server too: the browser uploads every image before it calls this, so an
  -- image that is not in the slides bucket means the upload did not finish. A lecture is
  -- never started with a missing slide.
  if exists (
    select 1
    from jsonb_array_elements(p_slides) as e(el)
    where not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'slides' and o.name = el ->> 'image_path'
    )
  ) then
    raise exception 'missing_images' using errcode = '22023',
      detail = 'Every slide image must be uploaded before the lecture starts.';
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


-- Part 3: lost_taps.tapped_at can not be in the future.
--
-- tapped_at is the student's own clock (a tap queued offline keeps the time it was
-- made). A tap stamped more than 1 minute ahead of the server gets the server's time
-- instead. 1 minute: phones and laptops set their clocks from the network and are
-- usually off by well under a second, so 60 s never touches an honest tap, and a wrong
-- clock still gets its tap counted (moved to now) instead of refused. Only inserts:
-- tapped_at is not in the update grant (0007), so it can not change later.
create or replace function public.lost_taps_clamp_tapped_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tapped_at > now() + interval '1 minute' then
    new.tapped_at := now();
  end if;
  return new;
end;
$$;

create or replace trigger lost_taps_clamp_tapped_at
  before insert on public.lost_taps
  for each row execute function public.lost_taps_clamp_tapped_at();

-- Part 4: a teacher uploads slide images only into a lecture folder of their own.
--
-- The images go up before the lecture row exists (D5), so the folder must be a lecture id
-- that is still free or a lecture the teacher owns, and the file must look like what the
-- app uploads: <lecture uuid>/<slide number>.webp or .jpg. This is a restrictive policy:
-- it is added on top of slides_teacher_insert (0004, any teacher) and both must pass, so
-- nothing needs to be dropped. Other buckets are not touched.
create or replace function public.can_upload_slide(p_name text) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_folder uuid;
begin
  if p_name is null
    or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,5}\.(webp|jpg)$' then
    return false;
  end if;
  v_folder := split_part(p_name, '/', 1)::uuid;
  return public.is_teacher()
    and (
      not exists (select 1 from public.lectures l where l.id = v_folder)
      or public.owns_lecture(v_folder)
    );
end;
$$;

revoke all on function public.can_upload_slide(text) from public, anon;
grant execute on function public.can_upload_slide(text) to authenticated;

create policy slides_insert_own_lecture_folder on storage.objects
  as restrictive
  for insert to authenticated
  with check (bucket_id <> 'slides' or public.can_upload_slide(name));

-- Part 5: uploads left behind.
--
-- The images go up before start_lecture; a start that fails, or a teacher who leaves
-- halfway, can leave images that no lecture uses. The app removes them right away when a
-- start fails. This lists the caller's own leftovers older than a day (so an upload in
-- progress in another tab is never touched), for the app to remove with the Storage API
-- (slides_delete_unused allows exactly these).
create or replace function public.my_orphan_slide_images()
returns setof text
language sql stable security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'slides'
    and o.owner = auth.uid()
    and o.created_at < now() - interval '1 day'
    and not public.slide_image_in_use(o.name)
    and public.is_teacher()
  order by o.created_at
  limit 1000
$$;

revoke all on function public.my_orphan_slide_images() from public, anon;
grant execute on function public.my_orphan_slide_images() to authenticated;
