-- Carousel packs (one-time purchases, replaces the dropped Unlimited plan -- 2026-07-27). A ledger,
-- not a single balance column: each row is either a +N purchase or a -1 consumption, so a purchase
-- webhook retry can be made idempotent (unique stripe_checkout_session_id) and the balance is
-- always just sum(delta), never a counter that can drift out of sync with reality.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('purchase', 'consumption')),
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;

create policy "Users read their own credit ledger"
  on public.credit_ledger for select
  using (auth.uid() = user_id);

create index credit_ledger_user_id_idx on public.credit_ledger (user_id);
