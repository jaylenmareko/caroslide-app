-- Billing (Stripe). One row per user, created/updated by the webhook (service-role client,
-- bypasses RLS -- Stripe's webhook call has no user session to satisfy auth.uid()). Usage counts
-- are NOT stored here -- they're derived by counting public.carousels rows, so there's no counter
-- to drift out of sync with reality.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  plan text check (plan in ('starter', 'pro', 'unlimited')),
  status text not null default 'none' check (status in ('none', 'active', 'past_due', 'canceled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Users read their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
