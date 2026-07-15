-- Adds a Brand Kit name, used for the text-wordmark logo treatment
-- (LOGO_HTML's .a/.b spans) when the user hasn't uploaded a real logo image.
-- Run this once in the SQL editor on top of the prior migrations.

alter table public.brand_kits add column if not exists brand_name text;
