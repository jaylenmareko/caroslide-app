-- Snapshots the brand colors/logo/font actually used on each carousel, instead
-- of only ever reading the account-level brand_kits row. Fixes a real gap: a
-- user managing multiple brands (agencies, social managers) needs THIS
-- carousel's branding to stick even if they later change their account
-- default, or if they overrode it just for this one project. brand_kits stays
-- as the pre-fill default for new carousels, not the source of truth for
-- carousels that already exist. Run this once in the SQL editor on top of the
-- prior migrations.

alter table public.carousels add column if not exists brand_colors text[];
alter table public.carousels add column if not exists logo_url text;
alter table public.carousels add column if not exists font text;
