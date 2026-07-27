import { createClient } from '@supabase/supabase-js'

/** Bypasses RLS -- only for server-side code with no user session to satisfy auth.uid(), like the
 * Stripe webhook, which needs to write a subscriptions row for whichever user's stripe_customer_id
 * the event names, not whichever user (if any) happens to be logged in when it fires. */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}
