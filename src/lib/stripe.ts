import Stripe from 'stripe'

// Cloudflare Workers only supports outbound fetch(), not raw Node sockets -- the SDK's default
// httpClient uses node:https and hangs indefinitely in this runtime without this override.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  httpClient: Stripe.createFetchHttpClient(),
})

export type Plan = 'starter' | 'pro'

export const PLAN_PRICE_IDS: Record<Plan, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
}

export const PLAN_CAROUSEL_LIMITS: Record<Plan, number> = {
  starter: 10,
  pro: 30,
}

export const FREE_LIFETIME_CAROUSEL_LIMIT = 1

export type Subscription = {
  plan: Plan | null
  status: 'none' | 'active' | 'past_due' | 'canceled'
  current_period_end: string | null
}

// Carousel packs (2026-07-27) -- one-time purchases for going over the monthly plan limit,
// replaces the old Unlimited plan (unbounded generation cost with a flat subscription price).
export type PackSize = 5 | 15

export const PACK_PRICE_IDS: Record<PackSize, string> = {
  5: process.env.STRIPE_PRICE_PACK_5!,
  15: process.env.STRIPE_PRICE_PACK_15!,
}
