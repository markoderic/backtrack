-- Write limits for one student (final review I2). The class has the code on Demo Day, by
-- design, and a student is anonymous, so one browser (or a script with the code) could
-- otherwise insert taps and notes without end. A student may add at most 20 rows to a
-- lecture in any 60 seconds and 300 in the whole lecture. Real use is a few taps a lecture.
--
-- Only a signed in user adding their own row is counted (the insert policy already makes
-- anon_id = auth.uid() for every student insert). Owner-side inserts, like the demo
-- semester seed, are left alone. created_at is set to the server's time for those rows,
-- so the minute can not be dodged by sending an old created_at.
--
-- The error has its own SQLSTATE, BT429, which the app reads as "too many taps": the tap
-- is dropped (never retried) and the student sees "Too many taps. Try again in a minute."
--
-- Nothing here drops, revokes or alters anything: one new function, one new trigger, and
-- type and size limits on the slides bucket.

create or replace function public.lost_taps_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent int;
  v_total int;
begin
  if auth.uid() is null or new.anon_id is distinct from auth.uid() then
    return new;
  end if;

  -- A resend of a tap that already saved (on conflict do nothing) adds no row, so it is
  -- never counted or refused.
  if exists (select 1 from public.lost_taps t where t.id = new.id) then
    return new;
  end if;

  new.created_at := now();

  select
    count(*) filter (where t.created_at > now() - interval '60 seconds'),
    count(*)
  into v_recent, v_total
  from public.lost_taps t
  where t.lecture_id = new.lecture_id
    and t.anon_id = new.anon_id;

  if v_recent >= 20 then
    raise exception 'Too many taps. Try again in a minute.' using errcode = 'BT429';
  end if;
  if v_total >= 300 then
    raise exception 'Too many taps in this lecture.' using errcode = 'BT429';
  end if;

  return new;
end;
$$;

create or replace trigger lost_taps_limit
  before insert on public.lost_taps
  for each row execute function public.lost_taps_limit();

-- The app uploads each slide as a 1920 px wide WebP (or JPEG where the browser can not
-- make WebP) at quality 0.85: usually 100 to 500 KB, a few MB for a tall page. Only those
-- two types, at most 10 MB each, may go in the bucket.
update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg'],
    file_size_limit = 10485760
where id = 'slides';
