-- Adds 'Photo Continuous' to the carousels.look check constraint. Real gap found live during
-- Task 7's manual UI verification (2026-08-02) -- Tasks 1-6 added the 'Photo Continuous' Look
-- everywhere in application code (types.ts, actions.ts, runGeneration.ts, the templates
-- themselves) but never touched this constraint, so the wizard's Generate button correctly built
-- and submitted a real createCarousel() call and it failed at the DB insert with "new row for
-- relation carousels violates check constraint carousels_look_check". Same class of gap
-- 007_bold_hook_look.sql's own comment describes hitting for Bold Hook -- this project's established
-- fix is a fresh drop+add of the whole constraint (Postgres has no ADD VALUE for a plain check
-- constraint), additive only, never narrows what was already allowed.

alter table public.carousels drop constraint if exists carousels_look_check;
alter table public.carousels add constraint carousels_look_check
  check (look in ('Circles + Photo', 'Plain Text', 'Bold Stat', 'Photo Focus', 'Bold Hook', 'Photo Continuous'));
