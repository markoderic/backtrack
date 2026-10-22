-- Hosted Supabase only: the private bucket for slide images.
insert into storage.buckets (id, name, public) values ('slides', 'slides', false) on conflict do nothing;
