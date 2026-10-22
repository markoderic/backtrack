-- "I'm lost" taps. A student taps while viewing a slide; the row says which one.
-- kind 'save' is for a later feature and is private to the student: a teacher
-- never reads one. anon_id is the student's auth.uid(). The id is made in the
-- browser so a resend after a dropped connection can not count twice.
create table public.lost_taps (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  anon_id uuid not null,
  kind text not null default 'lost' check (kind in ('lost', 'save')),
  tapped_on_slide int not null,
  slide_number int not null,
  note text check (length(note) <= 140),
  hl_x real,
  hl_y real,
  hl_w real,
  hl_h real,
  undone boolean not null default false,
  tapped_at timestamptz not null,
  created_at timestamptz default now(),
  -- A highlight is all four numbers inside the slide, or none of them.
  check (
    (hl_x is null and hl_y is null and hl_w is null and hl_h is null)
    or (
      hl_x is not null and hl_y is not null and hl_w is not null and hl_h is not null
      and hl_x >= 0 and hl_y >= 0 and hl_w > 0 and hl_h > 0
      and hl_x + hl_w <= 1 and hl_y + hl_h <= 1
    )
  )
);

create index lost_taps_lecture_anon_idx on public.lost_taps (lecture_id, anon_id);

alter table public.lost_taps enable row level security;

-- A student changes only these columns of their own rows. Everything else
-- (who, which lecture, when, what kind, the slide tapped on) is fixed at insert.
revoke update on public.lost_taps from authenticated, anon;
grant update (note, slide_number, undone, hl_x, hl_y, hl_w, hl_h) on public.lost_taps to authenticated;

-- A student who joined the lecture adds their own tap while it is live, or up to
-- 15 minutes after it ended for a tap made before the end (a phone that was
-- offline). The lecture is read as the student, who may select it once joined.
create policy lost_taps_insert_own on public.lost_taps
  for insert to authenticated
  with check (
    anon_id = auth.uid()
    and undone = false
    and public.joined_lecture(lecture_id)
    and slide_number = tapped_on_slide
    and exists (
      select 1
      from public.lectures l
      where l.id = lost_taps.lecture_id
        and lost_taps.tapped_on_slide between 1 and l.slide_count
        and (
          l.status = 'live'
          or (l.ended_at > now() - interval '15 minutes' and lost_taps.tapped_at <= l.ended_at)
        )
    )
  );

-- A student reads their own rows, both kinds.
create policy lost_taps_select_own on public.lost_taps
  for select to authenticated
  using (anon_id = auth.uid());

-- The teacher reads every lost tap of their lecture, undone ones included, and never a save.
create policy lost_taps_select_teacher on public.lost_taps
  for select to authenticated
  using (public.owns_lecture(lecture_id) and kind = 'lost');

create policy lost_taps_update_own on public.lost_taps
  for update to authenticated
  using (anon_id = auth.uid())
  with check (anon_id = auth.uid() and slide_number between 1 and tapped_on_slide);

-- No delete policy: a tap is undone, not deleted.
