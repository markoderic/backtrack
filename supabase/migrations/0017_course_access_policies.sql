-- 0017: students lose a lecture's slides once the course's window has closed (0016).
-- Run 0016 first: this file uses its function.
--
-- WHAT CHANGES (plain English, for Marko)
--
-- Two read rules change. Nothing is dropped or deleted and no data changes: both
-- statements are "alter policy", which rewrites the rule in place.
--
-- 1. slides_select_joined on public.slides: a student who joined a lecture used to
--    read its slide rows (image path, first line) forever. Now only while the lecture
--    is live, or after it while the course's "Students can see slides until" allows it
--    (end of semester, 30 days after class, or always).
-- 2. slides_select on storage.objects (the slide images): the same for the images.
--    The teacher's own part of the rule is copied word for word: the uploader and
--    the course's teacher can always read the images.
--
-- STILL WORKS
-- - Teachers: their own slides and images, always (slides_select_own and the owner
--   parts of the storage rule are untouched), and the projector, the live data view,
--   the past lecture page and the semester CSV (course_export runs with its own rights).
-- - Live lectures: every student who joined sees every slide while the lecture is live.
-- - Students after the window: My spots still lists the lecture and their own spots and
--   notes (lost_taps, lectures and participants rules are untouched). Only the slide
--   picture and its first line go ("This slide is no longer available.").
-- - Images already on a student's screen keep working until their signed link runs out
--   (at most 4 hours); a new link is refused.
--
-- Supabase's destructive operations box looks for statements that start with drop,
-- delete, truncate or alter table ... drop column. These start with alter policy, so
-- the box should not appear.

alter policy slides_select_joined on public.slides
  using (public.student_can_see_lecture(lecture_id));

alter policy slides_select on storage.objects
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
      or public.student_can_see_lecture(
        case
          when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[1])::uuid
        end
      )
    )
  );
