-- Real gap found in code review (2026-07-30): subscriptions.plan's CHECK constraint (008) still
-- allowed 'unlimited' -- left over from before the 2026-07-27 pricing restructure that dropped the
-- flat-rate Unlimited plan. The app's Plan type only knows 'starter'/'pro'; if any row ever had
-- plan='unlimited' (a stale test row, a manual edit -- checked live, no current row has this),
-- PLAN_CAROUSEL_LIMITS[plan] resolved to undefined, and `count >= undefined` is always false in
-- JS -- silently granting that account unlimited carousel generation forever. actions.ts now falls
-- back to the free lifetime limit on any unrecognized plan value (fail closed, not fail open); this
-- closes the same gap at the DB layer so the value can't be written back in the first place.
--
-- Finds and drops the real constraint by definition (matches on 'unlimited' in its body) rather than
-- assuming Postgres's default auto-generated name, since the original migration never named it explicitly.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.subscriptions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%unlimited%';

  if v_constraint_name is not null then
    execute format('alter table public.subscriptions drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('starter', 'pro'));
