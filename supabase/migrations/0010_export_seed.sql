-- The semester CSV export and a function that seeds a fake semester for Demo Day.

-- One row per slide per lecture of a course, for the CSV. Ordered by lecture date,
-- then start time, then slide. Every slide from 1 to slide_count is there, zeros
-- included. Only a tap with kind 'lost' that is not undone counts: a save never
-- does, and an undone tap is taken back. lost_taps counts the rows, students the
-- different people behind them. Owner of the course only. Returns counts, never notes.
create function public.course_export(p_course_id uuid)
returns table (lecture_date date, lecture_name text, slide_number int, first_line text, lost_taps int, students int)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
    or not exists (select 1 from public.courses c where c.id = p_course_id and c.teacher_id = auth.uid()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return query
  select l.lecture_date,
         l.name,
         g.n,
         coalesce(s.first_line, ''),
         coalesce(c.tap_count, 0)::int,
         coalesce(c.student_count, 0)::int
  from public.lectures l
  cross join lateral generate_series(1, l.slide_count) as g(n)
  left join public.slides s on s.lecture_id = l.id and s.number = g.n
  left join (
    select t.lecture_id as lid,
           t.slide_number as sn,
           count(*) as tap_count,
           count(distinct t.anon_id) as student_count
    from public.lost_taps t
    where t.kind = 'lost'
      and not t.undone
      and t.lecture_id in (select l2.id from public.lectures l2 where l2.course_id = p_course_id)
    group by t.lecture_id, t.slide_number
  ) c on c.lid = l.id and c.sn = g.n
  where l.course_id = p_course_id
  order by l.lecture_date, l.started_at, l.id, g.n;
end;
$$;

revoke all on function public.course_export(uuid) from public, anon;
grant execute on function public.course_export(uuid) to authenticated;

-- Fills an empty course with p_lectures ended lectures (default 8) on past Mondays
-- and Wednesdays, counting back from today in Eastern time, each starting at
-- 10:05 AM Eastern. Every lecture has 10 slides with ACC 221 style first lines, all
-- pointing at one shared placeholder image (demo/placeholder.webp, a storage object
-- that does not exist, so a past lecture view must not need the images), 20 to 35
-- fake participants with random ids (participants.anon_id has no foreign key, so
-- no auth.users rows are made), and taps: a couple of slides stand out, some taps
-- carry notes, some are undone and some rows are saves, so the export proves it
-- leaves the last two out. Owner only. Refuses a course that has any lecture, so it
-- can not seed twice. It uses no random() and no setseed: the counts come out the
-- same every time, and the caller's random() is left alone.
create function public.seed_demo_semester(p_course_id uuid, p_lectures int default 8)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := public.eastern_date(now());
  v_months text[] := array['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  v_titles text[] := array[
    'The Accounting Equation',
    'Debits, Credits and the T Account',
    'Journal Entries and the Ledger',
    'The Trial Balance',
    'Revenue Recognition',
    'Accruals and Deferrals',
    'The Accounting Cycle',
    'Adjusting Entries',
    'Financial Statements',
    'Closing Entries',
    'Merchandising and Inventory',
    'Receivables and Bad Debts'
  ];
  v_templates text[] := array[
    'Why this matters: %s',
    'A first example',
    'The rule in one line',
    'Worked example: %s',
    'A common mistake',
    'Your turn',
    'Check your answer',
    'What to remember'
  ];
  v_notes text[] := array[
    'what''s the difference between deferral and accrual',
    'too fast',
    'why is wages payable a credit'
  ];
  v_dates date[];
  v_k int;
  v_id uuid;
  v_start timestamptz;
  v_title text;
  v_students int;
  v_h1 int;
  v_h2 int;
begin
  if auth.uid() is null
    or not exists (select 1 from public.courses c where c.id = p_course_id and c.teacher_id = auth.uid()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  if p_lectures is null or p_lectures not between 1 and 30 then
    raise exception 'p_lectures must be 1 to 30.' using errcode = '22023';
  end if;

  if exists (select 1 from public.lectures l where l.course_id = p_course_id) then
    raise exception 'This course already has lectures, so the demo semester was not added.' using errcode = '55000';
  end if;

  -- The p_lectures most recent Mondays and Wednesdays before today, oldest first.
  -- Any 7 days hold exactly 2 of them, so this window always has enough.
  select array_agg(x.d order by x.d)
  into v_dates
  from (
    select g::date as d
    from generate_series(
      (v_today - 1 - 7 * (ceil(p_lectures / 2.0)::int + 1))::timestamp,
      (v_today - 1)::timestamp,
      interval '1 day'
    ) as g
    where extract(dow from g) in (1, 3)
    order by g desc
    limit p_lectures
  ) x;

  for v_k in 1..p_lectures loop
    v_id := gen_random_uuid();
    v_start := (v_dates[v_k] + time '10:05') at time zone 'America/New_York';
    v_title := v_titles[1 + (v_k - 1) % 12];

    insert into public.lectures (id, course_id, name, lecture_date, status, code, current_slide, slide_count, started_at, ended_at)
    values (
      v_id,
      p_course_id,
      'Lecture ' || v_k || ', ' || v_months[extract(month from v_dates[v_k])::int] || ' ' || extract(day from v_dates[v_k])::int,
      v_dates[v_k],
      'ended',
      null,
      10,
      10,
      v_start,
      v_start + interval '50 minutes'
    );

    insert into public.slides (lecture_id, number, image_path, first_line)
    select v_id,
           i,
           'demo/placeholder.webp',
           case i
             when 1 then 'Week ' || v_k || ': ' || v_title
             when 2 then 'Where we left off'
             else format(v_templates[i - 2], v_title)
           end
    from generate_series(1, 10) as i;

    v_students := 20 + (v_k * 7) % 16;
    insert into public.participants (lecture_id, anon_id, joined_at)
    select v_id, gen_random_uuid(), v_start + g * interval '5 seconds'
    from generate_series(1, v_students) as g;

    -- Two slides stand out per lecture (never slide 1 or 2), and they differ.
    v_h1 := 3 + (v_k * 2) % 8;
    v_h2 := 3 + ((v_h1 - 3) + 1 + (v_k * 3) % 7) % 8;

    with base as (
      select s.anon_id,
             s.sn::int as sn,
             g.sl,
             ((s.sn * 7 + g.sl * 13 + v_k * 29) % 100)::int as v,
             case when g.sl = v_h1 then 60 when g.sl = v_h2 then 35 else 6 end as cut,
             g.sl in (v_h1, v_h2) as hot
      from (
        select p.anon_id, row_number() over (order by p.anon_id) as sn
        from public.participants p
        where p.lecture_id = v_id
      ) s
      cross join generate_series(2, 10) as g(sl)
    ), ev as (
      -- The first lost tap; some are taken back.
      select b.anon_id, b.sn, b.sl, b.v, 'lost' as kind, 0 as rep, (b.v % 11 = 3) as undone
      from base b where b.v < b.cut
      union all
      -- Some students tap a standout slide a second time.
      select b.anon_id, b.sn, b.sl, b.v, 'lost', 1, false
      from base b where b.hot and b.v < 12
      union all
      -- Saves, which are private to the student and never counted.
      select b.anon_id, b.sn, b.sl, b.v, 'save', 0, false
      from base b where not b.hot and b.v >= b.cut and b.v % 9 = 4
    )
    insert into public.lost_taps (lecture_id, anon_id, kind, tapped_on_slide, slide_number, note, undone, tapped_at)
    select v_id,
           e.anon_id,
           e.kind,
           e.sl,
           e.sl,
           case when e.kind = 'lost' and e.v % 10 = 0 then v_notes[1 + (e.sn + e.sl + v_k) % 3] end,
           e.undone,
           v_start + (e.sl - 1) * interval '4 minutes' + e.sn * interval '3 seconds' + e.rep * interval '20 seconds'
    from ev e;
  end loop;
end;
$$;

revoke all on function public.seed_demo_semester(uuid, int) from public, anon;
grant execute on function public.seed_demo_semester(uuid, int) to authenticated;
