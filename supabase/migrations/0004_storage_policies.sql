-- Policies for the private "slides" bucket. Objects live at <lecture_id>/<n>.webp
-- (or .jpg). The teacher uploads the images before the lecture row exists, so
-- insert only asks for a teacher. Task 6 replaces the select policy to add
-- students who joined the lecture.
create policy slides_teacher_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'slides' and public.is_teacher());

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
    )
  );
