import Stripe from 'stripe'

// Cloudflare Workers only supports outbound fetch(), not raw Node sockets -- the SDK's default
// httpClient uses node:https and hangs indefinitely in this runtime without this override.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  httpClient: Stripe.createFetchHttpClient(),
})

export type Plan = 'starter' | 'pro' | 'unlimited'

export const PLAN_PRICE_IDS: Record<Plan, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
  unlimited: process.env.STRIPE_PRICE_UNLIMITED!,
}

export const PLAN_CAROUSEL_LIMITS: Record<Plan, number | null> = {
  starter: 10,
  pro: 30,
  unlimited: null,
}

export const FREE_LIFETIME_CAROUSEL_LIMIT = 1

export type Subscription = {
  plan: Plan | null
  status: 'none' | 'active' | 'past_due' | 'canceled'
  current_period_end: string | null
}
