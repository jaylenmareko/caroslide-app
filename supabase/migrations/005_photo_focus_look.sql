-- Adds "Photo Focus" as a new Look value. Side by Side, Photo Column, and
-- Editorial never actually had circles -- they were only nested under
-- "Circles + Photo" because that was the one Look with more than one
-- template. This splits them into their own Look, leaving Circles + Photo as
-- just Classic + Flipped (the two that genuinely use circle proofs). Bold
-- Stat is unaffected -- it keeps its own stat-captioned versions of the same
-- three layouts. Run this once in the SQL editor on top of the prior
-- migrations.

alter table public.carousels drop constraint if exists carousels_look_check;
alter table public.carousels add constraint carousels_look_check
  check (look in ('Circles + Photo', 'Plain Text', 'Bold Stat', 'Photo Focus'));
