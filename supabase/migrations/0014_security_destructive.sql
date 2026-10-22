-- 0014: take away write permissions the app never uses.
--
-- WHAT EACH STATEMENT CHANGES, AND WHAT STILL WORKS (plain English, for Marko)
--
-- Deploy the app first. Sign in used to rewrite the teacher's own row on every sign in
-- (it set the email again). The app from this commit on only adds the row the first
-- time and never rewrites it. If this file runs while the old app is still live,
-- every teacher sign in fails until the new app is deployed.
--
-- Nothing is dropped or deleted and no data changes. Every statement is a revoke
-- (takes a permission away) or a grant (gives a smaller one back). "Signed in users"
-- means teachers and students (students are anonymous sign ins), and "visitors" means
-- signed out browsers. Row level security still decides WHICH ROWS anyone can touch, and
-- this file narrows WHICH COLUMNS can be changed, to exactly what the app changes.
--
-- 1. revoke update on teachers: signed in users and visitors can no longer change any
--    column of a teachers row.
-- 2. grant update (display_name) on teachers: gives one column back, so a teacher can
--    change their own name. Before 1 and 2 a teacher could also rewrite their own
--    email, id and created_at.
-- 3. revoke update on courses: nobody can change any column of a course directly.
-- 4. grant update (name, archived) on courses: gives back the course name and
--    archived. Before, a teacher could also rewrite a course's id, teacher and
--    created_at (row level security already kept the course theirs).
-- 5. revoke update on lectures: nobody can change any column of a lecture directly.
-- 6. grant update (name, current_slide) on lectures: gives back the lecture name and
--    the slide on the projector. Before, the owner could also rewrite the join code,
--    status (live or ended), slide count, dates, course and slide_version.
--    slide_version (0015) is still counted up by its trigger on every change.
-- 7. revoke update on slides: nobody can change a slides row directly any more (the
--    app never did). Before, the owner could point a slide's image_path at any file.
-- 8. revoke insert, delete on lectures and slides: no policy ever allowed these, so
--    row level security already refused every row. Now the permission itself is gone.
-- 9. revoke insert, update, delete on participants: same, no policy allowed them.
--    Joining still adds the row through join_lecture.
-- 10. revoke delete on teachers and lost_taps: same, no policy allowed them. Undo
--    still marks a tap undone (an update), it never deletes it.
-- 11. revoke truncate, references, trigger on the six app tables: emptying a whole
--    table, pointing a foreign key at it or adding a trigger to it. The website's
--    database API can't send any of these. This closes them for good.
--
-- Still works afterwards: sign in (new and returning teachers), first setup
-- (save_setup), Settings (your name, add, rename, archive and unarchive a course),
-- start lecture (start_lecture), moving slides on the projector, rename a lecture,
-- end lecture (end_lecture), delete lecture (delete_lecture), the demo semester
-- (seed_demo_semester), and for students: join, I'm lost, save, Undo, move a tap one
-- slide earlier, notes and highlights. Students, the projector, the data view, My
-- spots, the CSV and Realtime only read, and reading is not touched. The functions
-- named above run with their own rights, so these revokes don't reach them.
--
-- It doesn't matter whether 0015 ran before or after this file: the result is the same.
--
-- The SQL editor's "destructive operations" warning looks for statements that start
-- with drop, delete or truncate. Every statement here starts with revoke or grant, so
-- the warning may not appear at all.

-- 1 and 2. Teachers: their own name only.
revoke update on public.teachers from authenticated, anon;
grant update (display_name) on public.teachers to authenticated;

-- 3 and 4. Courses: name and archived only.
revoke update on public.courses from authenticated, anon;
grant update (name, archived) on public.courses to authenticated;

-- 5 and 6. Lectures: name and current_slide only.
revoke update on public.lectures from authenticated, anon;
grant update (name, current_slide) on public.lectures to authenticated;

-- 7. Slides: no direct updates.
revoke update on public.slides from authenticated, anon;

-- 8 to 11. Writes no policy allows, and table privileges the API never needs.
revoke insert, delete on public.lectures, public.slides from authenticated, anon;
revoke insert, update, delete on public.participants from authenticated, anon;
revoke delete on public.teachers, public.lost_taps from authenticated, anon;
revoke truncate, references, trigger
  on public.teachers, public.courses, public.lectures, public.slides, public.participants, public.lost_taps
  from authenticated, anon;
