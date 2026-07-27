// Plan/pack constants that are safe to import from client components -- no Stripe SDK,
// no server-only env vars. `stripe.ts` re-exports these for server-side callers.
export type Plan = 'starter' | 'pro'

export const PLAN_CAROUSEL_LIMITS: Record<Plan, number> = {
  starter: 10,
  pro: 20,
}

// Display-only -- must match the real Stripe Price amounts (PLAN_PRICE_IDS in stripe.ts).
export const PLAN_PRICES: Record<Plan, string> = {
  starter: '$15/mo',
  pro: '$25/mo',
}

export const FREE_LIFETIME_CAROUSEL_LIMIT = 1

export type Subscription = {
  plan: Plan | null
  status: 'none' | 'active' | 'past_due' | 'canceled'
  current_period_end: string | null
}

export type PackSize = 5 | 15
