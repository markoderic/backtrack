-- 0018: a course's color, section and meeting time, for the courses dashboard. Adds
-- only: five columns (all empty to start) and one column grant. Nothing is dropped,
-- revoked or rewritten, and no row changes. The app runs the same before this file
-- (it reads courses without these columns and leaves the color, section and schedule
-- out), and shows them once it has run.
--
-- courses.color         one of eight calm swatches (never the red used for I'm lost),
--                       or empty for none
-- courses.section       short text such as "Section B" or "001", 1 to 40 characters
-- courses.meet_days     the days the class meets, 1 = Monday ... 7 = Sunday
-- courses.start_minute  when it starts and ends, in minutes after midnight in
-- courses.end_minute    Oxford, Ohio (America/New_York), like lecture_date. Both
--                       or neither, and the end after the start (no class runs
--                       past midnight).

alter table public.courses
  add column if not exists color text
    constraint courses_color_check
    check (color is null or color in ('slate', 'blue', 'indigo', 'plum', 'teal', 'green', 'olive', 'ochre')),
  add column if not exists section text
    constraint courses_section_check
    check (section is null or (char_length(section) between 1 and 40 and btrim(section) <> '')),
  add column if not exists meet_days smallint[]
    constraint courses_meet_days_check
    check (meet_days is null or (cardinality(meet_days) between 1 and 7
                                 and meet_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
                                 and array_position(meet_days, null) is null)),
  add column if not exists start_minute integer
    constraint courses_start_minute_check
    check (start_minute is null or start_minute between 0 and 1439),
  add column if not exists end_minute integer
    constraint courses_end_minute_check
    check ((start_minute is null and end_minute is null)
           or (start_minute is not null and end_minute is not null
               and end_minute > start_minute and end_minute <= 1440));

-- 0014 gave teachers back only (name, archived) on courses, 0016 added the slide access
-- setting. The dashboard details need these five as well; row level security
-- (courses_update_own) still keeps every change to the teacher's own course.
grant update (color, section, meet_days, start_minute, end_minute) on public.courses to authenticated;
