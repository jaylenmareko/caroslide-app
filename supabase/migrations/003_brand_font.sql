-- Adds a Brand Kit font preference. Run this once in the SQL editor on top of
-- the original schema.sql + 002_reference_images.sql.

alter table public.brand_kits add column if not exists font text not null default 'Inter Tight';
