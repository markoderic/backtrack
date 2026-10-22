-- Courses: what a teacher teaches. Each course belongs to one teacher.
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index courses_teacher_id_idx on public.courses (teacher_id);

alter table public.courses enable row level security;

create policy courses_select_own on public.courses
  for select to authenticated
  using (teacher_id = auth.uid());

create policy courses_insert_own on public.courses
  for insert to authenticated
  with check (teacher_id = auth.uid());

create policy courses_update_own on public.courses
  for update to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy courses_delete_own on public.courses
  for delete to authenticated
  using (teacher_id = auth.uid());
