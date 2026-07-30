-- Real bug found in code review (2026-07-30): createCarousel (actions.ts) counted existing
-- carousels, checked credit_ledger balance, and inserted a consumption row across three separate
-- round trips -- with the real generation pipeline (multiple AI calls + Cloudflare renders, real
-- seconds) happening AFTER the check and BEFORE the carousel row itself is ever inserted. Concurrent
-- requests from the same account (a script calling the server action directly bypasses the client's
-- isPending double-click guard entirely, since that's a UX guard, not a security boundary) could all
-- read the same pre-consumption state and all pass -- generating more carousels than a plan allows,
-- or draining more pack credits than were ever bought. This is exactly the unbounded-cost exposure
-- the pack/ledger system (migration 009) was built to prevent.
--
-- Fix: do the whole check-and-consume as one atomic Postgres function instead of three application
-- round trips. pg_advisory_xact_lock serializes concurrent calls for the SAME user only (keyed off
-- auth.uid(), can't be spoofed by a caller-supplied id) -- other users are never blocked, and the
-- lock releases automatically at transaction end. SECURITY INVOKER (the default) -- runs as the
-- calling user, still fully governed by the existing RLS policies on carousels/credit_ledger, no
-- new privilege granted.
create or replace function public.check_and_consume_carousel_limit(
  p_limit integer,
  p_period_start timestamptz
)
returns table (allowed boolean, reason text)
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_balance integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  select count(*) into v_count
  from public.carousels
  where user_id = v_user_id
    and (p_period_start is null or created_at >= p_period_start);

  if v_count < p_limit then
    return query select true, 'within_limit'::text;
    return;
  end if;

  select coalesce(sum(delta), 0) into v_balance
  from public.credit_ledger
  where user_id = v_user_id;

  if v_balance <= 0 then
    return query select false, 'no_credit'::text;
    return;
  end if;

  insert into public.credit_ledger (user_id, delta, reason)
  values (v_user_id, -1, 'consumption');

  return query select true, 'consumed_credit'::text;
end;
$$;
