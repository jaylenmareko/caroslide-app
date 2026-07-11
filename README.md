# Caroslide

Real AI-generated carousels — pick an angle, drop in a topic, get slides ready to post.

Next.js 16 (App Router) + Supabase, deploying to Cloudflare Pages.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in a real Supabase project URL + anon key
```

Run `supabase/schema.sql` in your Supabase project's SQL editor once (carousels + brand_kits tables, RLS, storage bucket).

```bash
npm run dev
```

Visit `/login` to sign up, then `/dashboard`.

## Status

See `../caroslide/CONTEXT.md` for the current build stage. Short version: UI is real and pixel-matches the design mockup; carousel generation is currently stubbed with placeholder images (`src/lib/actions.ts`) until a real render pipeline is wired up. `/preview/*` routes are temporary, no-auth mock-data pages used for visual QA before a live Supabase project existed — delete once `/dashboard` etc. can be checked directly.

## Structure

- `src/app/(app)/` — auth-gated: dashboard, new, carousel/[id], settings
- `src/app/login/` — signup/signin
- `src/components/` — DashboardGrid, NewCarouselWizard, Viewer, SettingsForm, TopNav
- `src/lib/supabase/` — browser + server Supabase clients
- `src/proxy.ts` — session refresh + route protection (Next.js 16 renamed `middleware.ts` → `proxy.ts`)
- `supabase/schema.sql` — DB schema + RLS policies
