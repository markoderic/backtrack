-- Delete lecture and security hardening that adds things only.
--
-- Nothing here drops, revokes or rewrites data when it runs: only create or replace
-- function, create index if not exists, and new policies. (The changes that need
-- revoke or drop are in 0014.)

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
