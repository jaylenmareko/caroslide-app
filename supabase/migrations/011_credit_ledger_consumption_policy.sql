-- Real bug found live (2026-07-29, tracing the pack-purchase path before it's fire-testable):
-- migration 009 enabled RLS on credit_ledger with only a SELECT policy for users -- the
-- app's own consumption insert (actions.ts, createCarousel's over-limit fallback) runs on the
-- user's regular authenticated client, not the service-role client, so it was being rejected
-- outright. Confirmed directly against the live project: a real authenticated user's insert of
-- their own {delta:-1, reason:'consumption'} row returned a real 403
-- ("new row violates row-level security policy for table credit_ledger", code 42501). This meant
-- nobody who ever bought a carousel pack could actually use a credit -- every attempt would throw
-- instead of generating.
--
-- Scoped tightly on purpose: only allows the EXACT shape the app code inserts (own user_id,
-- reason='consumption', delta=-1). A purchase row (positive delta, reason='purchase') must still
-- only ever come from the webhook's service-role client -- if this policy allowed arbitrary
-- deltas/reasons, any user could grant themselves free credits directly via the client.
create policy "Users can consume their own credits"
  on public.credit_ledger for insert
  with check (auth.uid() = user_id and reason = 'consumption' and delta = -1);
