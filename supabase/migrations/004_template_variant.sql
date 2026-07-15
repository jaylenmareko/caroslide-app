-- Adds the specific template-variant choice within the "Circles + Photo" Look
-- (the only Look category that maps to more than one real /carousel skill
-- template). Run this once in the SQL editor on top of the prior migrations.

alter table public.carousels add column if not exists template_variant text;
