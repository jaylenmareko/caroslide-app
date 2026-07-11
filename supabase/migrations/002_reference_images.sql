-- Adds support for user-attached reference images in the "Tell us everything" composer.
-- Run this once in the SQL editor on top of the original schema.sql.

alter table public.carousels add column if not exists reference_images jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('carousel-uploads', 'carousel-uploads', true)
on conflict (id) do nothing;

create policy "Public can view carousel uploads"
  on storage.objects for select
  using (bucket_id = 'carousel-uploads');

create policy "Users upload their own reference images"
  on storage.objects for insert
  with check (bucket_id = 'carousel-uploads' and auth.uid()::text = (storage.foldername(name))[1]);
