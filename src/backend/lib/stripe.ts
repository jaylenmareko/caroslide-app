import Stripe from 'stripe'

// This module is server-only (constructs a real Stripe client from a secret env var) --
// never import a value (only `import type`) from here in a 'use client' component, or the
// Stripe SDK + this constructor call get bundled into the browser and throw on load
// (STRIPE_SECRET_KEY doesn't exist client-side). Client-safe plan/pack constants live in
// `./plans` instead -- re-exported below for existing server-side callers.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  httpClient: Stripe.createFetchHttpClient(),
})

export * from './plans'
import type { Plan, PackSize } from './plans'

export const PLAN_PRICE_IDS: Record<Plan, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
}

export const PACK_PRICE_IDS: Record<PackSize, string> = {
  5: process.env.STRIPE_PRICE_PACK_5!,
  15: process.env.STRIPE_PRICE_PACK_15!,
}
