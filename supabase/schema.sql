-- Caroslide schema. Run this once in the Supabase SQL editor for a new project.

create table if not exists public.carousels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled carousel',
  angle text not null check (angle in ('Value', 'Growth', 'Education')),
  format text not null check (format in ('Post')),
  look text not null check (look in ('Circles + Photo', 'Plain Text', 'Bold Stat')),
  brief text,
  slides jsonb not null default '[]'::jsonb, -- array of { url: string }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_kits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  colors text[] not null default '{}',
  logo_url text,
  voice_description text,
  updated_at timestamptz not null default now()
);

alter table public.carousels enable row level security;
alter table public.brand_kits enable row level security;

create policy "Users manage their own carousels"
  on public.carousels for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own brand kit"
  on public.brand_kits for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at current on every row update
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger carousels_set_updated_at
  before update on public.carousels
  for each row execute function public.set_updated_at();

create trigger brand_kits_set_updated_at
  before update on public.brand_kits
  for each row execute function public.set_updated_at();

-- Storage bucket for slide images and brand logos (public read, owner write)
insert into storage.buckets (id, name, public)
values ('carousel-slides', 'carousel-slides', true)
on conflict (id) do nothing;

create policy "Public can view carousel slides"
  on storage.objects for select
  using (bucket_id = 'carousel-slides');

create policy "Users upload their own carousel slides"
  on storage.objects for insert
  with check (bucket_id = 'carousel-slides' and auth.uid()::text = (storage.foldername(name))[1]);
