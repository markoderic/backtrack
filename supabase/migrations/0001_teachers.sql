-- Teachers: Miami accounts that signed in with Google.
create table public.teachers (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.teachers enable row level security;

create policy teachers_select_own on public.teachers
  for select to authenticated
  using (id = auth.uid());

create policy teachers_update_own on public.teachers
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- The database checks the Miami address itself, so a forged client call cannot
-- add a gmail or anonymous account as a teacher.
create policy teachers_insert_own_miami on public.teachers
  for insert to authenticated
  with check (
    id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and lower(auth.jwt() ->> 'email') like '%@miamioh.edu'
  );

-- True when the signed in user has a teachers row. security definer so other
-- tables' policies can call it without needing their own read access here.
create function public.is_teacher() returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.teachers where id = auth.uid())
$$;
