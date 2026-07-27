import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { stripe, PLAN_PRICE_IDS, type Plan } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'

function planFromPriceId(priceId: string): Plan | null {
  const entry = (Object.entries(PLAN_PRICE_IDS) as [Plan, string][]).find(([, id]) => id === priceId)
  return entry ? entry[0] : null
}

async function upsertFromSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata.user_id
  if (!userId) {
    console.error(`[stripe-webhook] subscription ${subscription.id} has no user_id metadata`)
    return
  }

  const priceId = subscription.items.data[0]?.price.id
  const plan = priceId ? planFromPriceId(priceId) : null
  const item = subscription.items.data[0]

  const supabase = createServiceClient()
  const { error } = await supabase.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: subscription.customer as string,
    stripe_subscription_id: subscription.id,
    plan,
    status: subscription.status === 'active' || subscription.status === 'trialing' ? 'active'
      : subscription.status === 'past_due' ? 'past_due'
      : 'canceled',
    current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : null,
    current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
  })
  if (error) console.error(`[stripe-webhook] upsert failed for user ${userId}: ${error.message}`)
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error(`[stripe-webhook] signature verification failed: ${(err as Error).message}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode === 'subscription' && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
        // client_reference_id is the source of truth here -- Checkout Sessions don't otherwise
        // guarantee subscription_data.metadata survives onto the resulting Subscription object
        // the same way it's set on the session itself.
        if (session.client_reference_id && !subscription.metadata.user_id) {
          subscription.metadata.user_id = session.client_reference_id
        }
        await upsertFromSubscription(subscription)
      }
      break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await upsertFromSubscription(event.data.object as Stripe.Subscription)
      break
    }
  }

  return NextResponse.json({ received: true })
}
