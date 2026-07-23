-- Adds 'Bold Hook' to the carousels.look check constraint. Added 2026-07-22 alongside the new
-- 12-hook-block.html template -- the TypeScript Look union was updated but this DB-side constraint
-- was missed, so the very first real Bold Hook generation completed a full (real-cost) AI run and
-- then failed at the final insert with "violates check constraint carousels_look_check". Real gap,
-- same pattern as migration 005's Photo Focus addition.
alter table public.carousels drop constraint if exists carousels_look_check;
alter table public.carousels add constraint carousels_look_check
  check (look in ('Circles + Photo', 'Plain Text', 'Bold Stat', 'Photo Focus', 'Bold Hook'));
