'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createClient } from '@/backend/lib/supabase/server'
import type { Angle, Format, Look, TemplateVariant, Slide } from '@/backend/lib/types'
import { DEFAULT_BRAND_FONT, MAX_ATTACHMENT_MB } from '@/backend/lib/types'
import { renderAndGuard } from '@/backend/lib/generation/pipeline'
import type { CarouselGenerationJob } from '@/backend/lib/generation/runGeneration'
import { classifyAngle, classifyColors } from '@/backend/lib/generation/captions'
import {
  classifyEdit,
  rewriteCopy,
  generateSwapBrief,
  swapPhoto,
  generateMoveDelta,
  generateColorEdit,
  generateFontEdit,
  wrapTextWithStyle,
} from '@/backend/lib/generation/edit'
import { loadTemplate, fillTemplate, renderSlide } from '@/backend/lib/generation/render'
import { EDITABLE_FIELDS, type EditableField } from '@/backend/lib/generation/editableFields'
import { createDurableObjectTokenLimiter } from '@/backend/lib/generation/anthropicLimiter'
import {
  stripe,
  PLAN_PRICE_IDS,
  PLAN_CAROUSEL_LIMITS,
  FREE_LIFETIME_CAROUSEL_LIMIT,
  PACK_PRICE_IDS,
  type Plan,
  type PackSize,
} from '@/backend/lib/stripe'

/** Every deploy target (localhost, a Cloudflare preview, caroslide.com) reads its own origin
 * straight off the incoming request instead of a hardcoded env var, so Checkout/Portal
 * success/cancel/return URLs always point back at wherever this action was actually called from. */
async function siteOrigin() {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('host')
  return `${proto}://${host}`
}

export async function createCheckoutSession(plan: Plan) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const origin = await siteOrigin()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    // Do NOT pass payment_method_types -- Stripe determines eligible methods dynamically.
    line_items: [{ price: PLAN_PRICE_IDS[plan], quantity: 1 }],
    ...(existing?.stripe_customer_id
      ? { customer: existing.stripe_customer_id }
      : { customer_email: user!.email }),
    client_reference_id: user!.id,
    subscription_data: { metadata: { user_id: user!.id } },
    // Dashboard, not Settings (2026-08-01, Jaylen: one path regardless of entry point) -- checkout
    // can be started either from Settings directly or from the free-tier wall on /new (which links
    // to Settings), but there's only this one real success_url either way, so redirecting it to
    // /dashboard already unifies both without any extra branching.
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/settings`,
  })

  if (!session.url) throw new Error('Stripe did not return a Checkout URL.')
  redirect(session.url)
}

/** One-time purchase, not a subscription -- extra carousel generations for whenever someone goes
 * over their plan's monthly cap. Replaces the old flat-rate Unlimited plan (unbounded cost exposure
 * for a fixed subscription price); credited via the same webhook, tracked in a real ledger (see
 * migration 009) so a webhook retry can't double-credit the same purchase. */
export async function createPackCheckoutSession(size: PackSize) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const origin = await siteOrigin()
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: PACK_PRICE_IDS[size], quantity: 1 }],
    ...(existing?.stripe_customer_id
      ? { customer: existing.stripe_customer_id }
      : { customer_email: user!.email }),
    client_reference_id: user!.id,
    metadata: { user_id: user!.id, credit_quantity: String(size) },
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/settings`,
  })

  if (!session.url) throw new Error('Stripe did not return a Checkout URL.')
  redirect(session.url)
}

export async function createPortalSession() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user!.id)
    .maybeSingle()
  if (!existing?.stripe_customer_id) {
    throw new Error('No billing account yet -- subscribe to a plan first.')
  }

  const origin = await siteOrigin()
  const session = await stripe.billingPortal.sessions.create({
    customer: existing.stripe_customer_id,
    return_url: `${origin}/settings`,
  })
  redirect(session.url)
}

// Real, Stripe-tied plan enforcement (2026-07-26) -- replaces the old flat 20-per-account
// stopgap. Free/past_due/no-subscription accounts get a lifetime cap (matches the marketing
// page's "1 carousel free when you sign up"); an active paid plan gets a per-billing-period cap
// instead, counted from carousels created since current_period_start -- not a stored counter, so
// it can't drift out of sync with what Stripe actually reports.
//
// Shared by createCarousel's real (consuming) check and getCarouselLimitStatus's read-only peek,
// so the two can never quietly disagree on what "at limit" means.
async function resolvePlanLimit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<{ isActivePaid: boolean; limit: number; periodStart: string | null }> {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_start')
    .eq('user_id', userId)
    .maybeSingle()

  const isActivePaid = !!(subscription?.status === 'active' && subscription.plan)
  // Falls back to the free limit (fail closed) on any plan value PLAN_CAROUSEL_LIMITS doesn't
  // recognize -- a stale/out-of-band DB value (e.g. the pre-2026-07-27 'unlimited' plan the schema
  // used to allow) must never silently grant unlimited generation just because the lookup misses.
  const limit = isActivePaid
    ? (PLAN_CAROUSEL_LIMITS[subscription!.plan as Plan] ?? FREE_LIFETIME_CAROUSEL_LIMIT)
    : FREE_LIFETIME_CAROUSEL_LIMIT

  return {
    isActivePaid,
    limit,
    periodStart: isActivePaid && subscription!.current_period_start ? subscription!.current_period_start : null,
  }
}

function limitExceededMessage(isActivePaid: boolean, limit: number): string {
  return isActivePaid
    ? `You've used all ${limit} carousels for this billing period. It renews automatically, or buy a carousel pack in Settings.`
    : `You've used your free carousel. Upgrade or buy a carousel pack in Settings.`
}

// Read-only peek at whether the account is at its carousel limit, purely to gate the "New
// Carousel" entry point in the UI before a free/exhausted-paid user sinks time into the whole
// wizard. NOT the enforcement boundary -- createCarousel's atomic RPC below is the only thing
// that actually decides and consumes; this can theoretically be stale by the time they submit
// (e.g. a pack purchase completes in another tab), which is fine for a UI hint and would never be
// fine for the real check.
export async function getCarouselLimitStatus(): Promise<{ atLimit: boolean; message: string | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { atLimit: false, message: null }

  const { isActivePaid, limit, periodStart } = await resolvePlanLimit(supabase, user.id)

  let countQuery = supabase.from('carousels').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  if (periodStart) countQuery = countQuery.gte('created_at', periodStart)
  const { count } = await countQuery
  if ((count ?? 0) < limit) return { atLimit: false, message: null }

  const { data: ledgerRows } = await supabase.from('credit_ledger').select('delta').eq('user_id', user.id)
  const creditBalance = (ledgerRows ?? []).reduce((sum, row) => sum + row.delta, 0)
  if (creditBalance > 0) return { atLimit: false, message: null }

  return { atLimit: true, message: limitExceededMessage(isActivePaid, limit) }
}

// Real gap found in security review (2026-08-03): the wizard's own MAX_ATTACHMENT_MB check and
// the file input's `accept="image/*"` are both client-side hints only -- neither stops a caller
// that invokes this server action directly (or a modified client) from sending an oversized file
// or an arbitrary content type. `carousel-uploads` is a fully PUBLIC-read bucket (see
// 002_reference_images.sql), and the upload below used to pass attacker-controlled `file.type`
// straight through as the stored object's Content-Type with zero validation -- e.g. `text/html`
// or `image/svg+xml` with embedded script, served back out from a public URL on this app's own
// Storage domain, is a real stored-content/XSS-hosting risk, not just hardening. Both checks below
// are the actual enforcement boundary; the client-side ones are only there to fail fast/politely.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Photo Continuous's single-photo upload (2026-08-02) -- the wizard's old multi-photo attachment
// composer was removed entirely for v1 (2026-08-01), but the `carousel-uploads` Storage bucket and
// its owner-scoped RLS policies survived that removal untouched (see 002_reference_images.sql /
// 012_storage_delete_policy.sql: both require the object's top-level path segment to equal
// auth.uid()). This reuses that exact same bucket and the same `${userId}/${randomId}-${filename}`
// path convention the old client-side upload used (see git history, a14e29e) -- just moved
// server-side so the upload runs under a real authenticated action instead of a raw client call,
// consistent with every other write in this file.
export async function uploadReferenceImage(formData: FormData): Promise<{ url: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new Error('No photo was attached.')
  }
  if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
    throw new Error(`That photo is over ${MAX_ATTACHMENT_MB}MB -- try a smaller one.`)
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Unsupported file type -- attach a JPEG, PNG, or WebP photo.')
  }

  // Path is scoped to this user's own top-level folder -- the ONLY thing the bucket's insert
  // policy checks (auth.uid()::text = (storage.foldername(name))[1]); a random id after that
  // keeps two uploads of a same-named file from colliding, same as the removed composer's own
  // convention did.
  const path = `${user!.id}/${crypto.randomUUID()}-${file.name}`
  const { data, error } = await supabase.storage
    .from('carousel-uploads')
    .upload(path, file, { contentType: file.type })
  if (error) throw new Error(`Failed to upload photo: ${error.message}`)

  const { data: pub } = supabase.storage.from('carousel-uploads').getPublicUrl(data.path)
  return { url: pub.publicUrl }
}

export async function createCarousel(input: {
  format: Format
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  referenceImageUrls: string[]
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Real gap found in code review (2026-08-03): the wizard blocks submission client-side unless
  // exactly 5 photos are attached, and runGeneration.ts/pipeline.ts both lean on "exactly 5 URLs
  // guaranteed" (runGeneration.ts even casts referenceImageUrls to a 5-tuple on that assumption) --
  // but this is a Next.js Server Action, directly network-reachable, not actually gated by the
  // wizard's UI. Fewer than 5 URLs wouldn't crash: generateSplitPhotoCarousel's .map over a short
  // photoUrls array would just silently produce fewer than 5 slides (wrong output, not a caught
  // error). More than 5 would eventually throw (caught by runGeneration.ts's try/catch, surfaces as
  // status: 'failed'), but that's not a clean validation rejection either. Same posture as
  // uploadReferenceImage's own ALLOWED_IMAGE_TYPES/MAX_ATTACHMENT_MB comment above: client checks
  // are hints only, the server re-validates. Checked before the limit-consuming RPC below so a bad
  // request doesn't burn a real carousel credit.
  if (input.look === 'Photo Continuous' && input.referenceImageUrls.length !== 5) {
    throw new Error('Photo Continuous needs exactly 5 photos.')
  }

  const { isActivePaid, limit, periodStart } = await resolvePlanLimit(supabase, user!.id)

  // Real bug found in code review (2026-07-30): counting existing carousels, checking the credit
  // balance, and inserting the consumption row used to be three separate round trips with the real
  // generation pipeline (many seconds) in between -- concurrent requests from the same account could
  // all read the same pre-consumption state and all pass. Migration 013's check_and_consume_carousel_limit
  // does the whole check-and-consume atomically in one Postgres function (advisory-locked per user),
  // closing that race.
  const { data: limitCheck, error: limitError } = await supabase.rpc('check_and_consume_carousel_limit', {
    p_limit: limit,
    p_period_start: periodStart,
  })
  if (limitError) throw new Error(`Failed to check carousel limit: ${limitError.message}`)
  if (!limitCheck?.[0]?.allowed) {
    throw new Error(limitExceededMessage(isActivePaid, limit))
  }

  // voice_description is read live from the account's brand_kits row, not snapshotted onto the
  // carousel the way colors/logo/font are -- unlike those, it only shapes NEW writing choices,
  // it isn't baked pixel-for-pixel into a past rendered image, so there's no consistency reason
  // to freeze it at creation time.
  const { data: brandKit } = await supabase
    .from('brand_kits')
    .select('voice_description')
    .eq('user_id', user!.id)
    .maybeSingle()

  // Real, cross-instance Anthropic rate limiter (2026-08-01) -- these two calls spend from the
  // same account-wide per-minute budget the Queue consumer's initial-generation calls do (see
  // generateCarousel's own anthropicLimiter comment), so they need to coordinate through the same
  // real Durable Object, not run unthrottled just because they happen to run here instead of in
  // the consumer. Fetched once, reused below for CAROUSEL_QUEUE too.
  const { env } = await getCloudflareContext({ async: true })
  const anthropicLimiter = createDurableObjectTokenLimiter(env.ANTHROPIC_LIMITER)

  // Angle (Value/Growth/Education) is no longer a wizard question (2026-08-01) -- a real
  // usability test found a first-time user with zero context got stuck on that exact choice
  // before she understood what the product even was. An AI call decides it instead, same as
  // every other judgment call this pipeline already makes on the user's behalf.
  //
  // Photo Continuous (2026-08-02) skips both classifyAngle and classifyColors entirely -- this
  // Look has no brief (always ''), so there's nothing for either call to infer from, and neither
  // output is ever read for it: there's no caption-writing step to use `angle` as framing, and
  // its CTA slide falls back to Caroslide's own default brand colors via buildBrandValues'
  // existing `?? '#512888'` fallback, same as any carousel with an empty brandColors array.
  // Calling them anyway would be a wasted real Anthropic call and would silently break this
  // Look's "zero Anthropic calls" design promise. `angle: 'Value'` is an arbitrary but harmless
  // placeholder -- the `angle` column is NOT NULL and nothing ever reads it for this Look.
  let angle: Angle
  let brandColors: string[]
  if (input.look === 'Photo Continuous') {
    angle = 'Value'
    brandColors = []
  } else {
    angle = await classifyAngle(input.brief, anthropicLimiter)
    // Same reasoning for colors (Brand Kit removed for v1 entirely, see classifyColors' own
    // comment) -- picked from the brief instead of a Settings/wizard color picker.
    const { primary, secondary } = await classifyColors(input.brief, anthropicLimiter)
    brandColors = [primary, secondary]
  }
  // Logo: free accounts show the Caroslide wordmark (buildBrandValues' existing fallback,
  // unchanged), paid accounts get a genuinely blank logo slot -- Jaylen's direction. No custom
  // logo upload exists anymore in v1, so logoUrl itself is always null; suppressLogoFallback is
  // what actually distinguishes the two cases.
  const font = DEFAULT_BRAND_FONT

  // One folder per carousel (not one random folder per slide, the previous behavior) -- keeps a
  // carousel's slides grouped together in Storage, and gives runCarouselGeneration's (the Queue
  // consumer's) own partial-failure cleanup a single known prefix to target instead of no way to
  // find what was already uploaded.
  const carouselId = crypto.randomUUID()

  const { error: insertError } = await supabase.from('carousels').insert({
    // Explicit, not the column's own default -- matches the Storage folder name above, so
    // deleteCarousel can find and remove this carousel's images by a single known prefix instead
    // of having no way to associate a DB row with its own uploaded files.
    id: carouselId,
    user_id: user!.id,
    title: input.brief.trim().slice(0, 60) || `${angle} carousel`,
    angle,
    format: input.format,
    look: input.look,
    template_variant: input.templateVariant,
    brief: input.brief,
    slides: [],
    reference_images: input.referenceImageUrls.map((url) => ({ url })),
    // Snapshotted here, not read live from brand_kits at generation time --
    // see the Carousel type's brand_colors/logo_url/font comment.
    brand_colors: brandColors,
    logo_url: null,
    font,
    status: 'generating',
  })
  if (insertError) throw new Error(insertError.message)

  // Real generation work happens in workers/carousel-consumer/, a separate Cloudflare Worker that
  // consumes this queue -- NOT via ctx.waitUntil() (tried first, 2026-07-31): that only buys ~30s
  // past this response before Cloudflare kills whatever's still running, nowhere near enough for a
  // real 2-3 minute generation. A Queue consumer is its own real Worker invocation with the normal
  // full time budget, so there's no risk of the render step getting silently cut off mid-flight.
  const job: CarouselGenerationJob = {
    carouselId,
    userId: user!.id,
    angle,
    format: input.format,
    look: input.look,
    templateVariant: input.templateVariant,
    brief: input.brief,
    voiceDescription: brandKit?.voice_description ?? null,
    referenceImageUrls: input.referenceImageUrls,
    brandColors,
    font,
    suppressLogoFallback: isActivePaid,
  }
  await env.CAROUSEL_QUEUE.send(job)

  redirect(`/carousel/${carouselId}`)
}

// Lightweight poll target for the carousel page's "generating" state -- just the fields that
// actually change once runCarouselGeneration finishes, not the whole row. Uses the normal
// request-scoped client (RLS-governed, same as every other read here), unlike
// runCarouselGeneration's background write.
export async function getCarouselGenerationStatus(
  id: string
): Promise<{ status: 'generating' | 'ready' | 'failed'; title: string; slides: Slide[]; error_message: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('carousels')
    .select('status, title, slides, error_message')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateCarouselTitle(id: string, title: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('carousels').update({ title }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateCarouselSlides(id: string, slides: Slide[]) {
  const supabase = await createClient()
  const { error } = await supabase.from('carousels').update({ slides }).eq('id', id)
  if (error) throw new Error(error.message)
}

// Shared by updateSlideField (a single field-level save, never undo/redo) and editSlide (which
// adds the two client-only variants below).
export type FieldUpdateResult =
  | { type: 'clarify' | 'redirect' | 'unsupported' | 'error'; message: string }
  | { type: 'updated'; slides: Slide[] }

export type EditSlideResult =
  | FieldUpdateResult
  // undo/redo (2026-07-28) never touch the server at all -- undo history only ever exists in
  // Viewer.tsx's local React state (the explicit-Save build made saving deliberate, not automatic
  // per edit, so there's no server-side history to act on). This just confirms the classified
  // intent; the client calls its own existing undo()/redo() directly on receiving it. Two separate
  // variants (not one `client_undo' | 'client_redo'` discriminant) for clean, unambiguous
  // discriminated-union narrowing at every call site.
  | { type: 'client_undo' }
  | { type: 'client_redo' }

/** Pulls the real Storage path back out of a Supabase public URL (everything after the bucket
 * name) so a re-uploaded slide's old file can be cleaned up -- same no-orphaned-storage
 * discipline as createCarousel/deleteCarousel, just for a single edited slide instead of a whole
 * deleted carousel. Bucket defaults to 'carousel-slides' (every existing caller's own bucket);
 * deleteCarousel's own carousel-uploads cleanup passes the other bucket explicitly. */
function storagePathFromPublicUrl(url: string, bucket: string = 'carousel-slides'): string | null {
  const marker = `/${bucket}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : url.slice(idx + marker.length)
}

// Chat-edit abuse guard (2026-07-28, migration 010_chat_edit_rate_limit.sql) -- editSlide is the
// only chat-edit surface that spends real AI tokens per request (at minimum one Haiku classification
// call, up to Opus for copy_rewrite); the click-in-place editor never calls an LLM at all, so it
// isn't covered here. This is a bot/abuse backstop, not a plan-tier feature limit -- Jaylen: real
// per-edit cost is sub-cent to a few cents, a normal user iterating a lot costs a couple dollars over
// a plan's whole lifetime, not worth capping. The threshold below is set high enough that no human
// hand-typing a message and waiting ~5-20s for each reply could ever hit it -- only a script
// hammering the endpoint could.
const CHAT_EDIT_RATE_LIMIT_WINDOW_SECONDS = 60
const CHAT_EDIT_RATE_LIMIT_MAX_REQUESTS = 20

/** Returns false if this user has already made CHAT_EDIT_RATE_LIMIT_MAX_REQUESTS chat-edit requests
 * in the last CHAT_EDIT_RATE_LIMIT_WINDOW_SECONDS (and logs nothing new -- a rejected request never
 * reached classifyEdit, so it never actually cost anything, and shouldn't count against the next
 * check either). Otherwise logs this request and returns true. One row per REQUEST, not per
 * successful edit -- an 'ambiguous'/'clarify' outcome still paid for the classification call. */
async function checkChatEditRateLimit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  const windowStart = new Date(Date.now() - CHAT_EDIT_RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
  const { count } = await supabase
    .from('chat_edit_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', windowStart)
  if ((count ?? 0) >= CHAT_EDIT_RATE_LIMIT_MAX_REQUESTS) return false

  await supabase.from('chat_edit_events').insert({ user_id: userId })
  // Opportunistic cleanup (~1% of requests) instead of a cron job -- this table only needs to stay
  // roughly bounded over time, not exactly pruned the instant a row ages out of the rate window.
  if (Math.random() < 0.01) {
    await supabase
      .from('chat_edit_events')
      .delete()
      .eq('user_id', userId)
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  }
  return true
}

/**
 * Real chat-editing entrypoint (2026-07-21) -- governed by chat-editing-behavior.md (scope) and
 * chat-editing-execution.md (what an edit actually changes). Classifies the message, executes a
 * copy-rewrite or photo-swap on just the in-scope slide(s), re-renders only those, and returns the
 * updated slides array for the caller to run through the existing commitSlides()/undo-redo path --
 * no separate persistence mechanism, this rides the one already built for delete/undo/redo.
 */
export async function editSlide(carouselId: string, message: string, currentSlideIndex: number): Promise<EditSlideResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const withinRateLimit = await checkChatEditRateLimit(supabase, user!.id)
  if (!withinRateLimit) {
    return { type: 'error', message: "You're editing quite fast -- wait about a minute and try again." }
  }

  const { data: carousel, error: fetchError } = await supabase
    .from('carousels')
    .select('slides, user_id, look')
    .eq('id', carouselId)
    .single()
  if (fetchError || !carousel) return { type: 'error', message: 'Could not find this carousel.' }
  if (carousel.user_id !== user!.id) return { type: 'error', message: 'Not authorized to edit this carousel.' }

  // Real gap found in code review (2026-08-02): nothing gated this Look out of chat-editing at
  // all -- a message like "change this photo" matched the existing photo_swap classification and
  // would silently fire real Anthropic/photo-search calls this Look is specifically built to skip
  // (see createCarousel's own angle/brandColors comment), AND would only replace ONE of the N
  // slides' shared source photo, breaking the "one photo split continuously across slides"
  // illusion the whole Look exists for. Properly supporting an edit here means re-splitting the
  // photo across all N slides, not patching one -- new scope, not a bug fix, so out of v1. Reject
  // early and honestly instead, checked immediately after the carousel/ownership fetch and before
  // classifyEdit or any other Anthropic call in this function can ever run.
  if (carousel.look === 'Photo Continuous') {
    return {
      type: 'unsupported',
      message: "Chat editing isn't available for Photo Continuous carousels yet -- this Look doesn't support edits in v1.",
    }
  }

  const slides = carousel.slides as Slide[]
  if (currentSlideIndex < 0 || currentSlideIndex >= slides.length) {
    return { type: 'error', message: 'Invalid slide.' }
  }

  // voice_description read live, same as createCarousel -- it shapes new writing choices, it
  // isn't baked pixel-for-pixel into a past render, so there's no reason to freeze it here either.
  const { data: brandKit } = await supabase
    .from('brand_kits')
    .select('voice_description')
    .eq('user_id', user!.id)
    .maybeSingle()

  // Same real cross-instance Anthropic budget as createCarousel's -- every AI call in this
  // function spends from the same account-wide per-minute pool the Queue consumer's own
  // generation calls do (see anthropicLimiter.ts's own comment).
  const { env } = await getCloudflareContext({ async: true })
  const anthropicLimiter = createDurableObjectTokenLimiter(env.ANTHROPIC_LIMITER)

  const classification = await classifyEdit({ message, currentSlideIndex, slides }, anthropicLimiter)
  console.log(`[chat-edit] classification: ${JSON.stringify(classification)}`)

  if (classification.editType === 'ambiguous') {
    return {
      type: 'clarify',
      message: classification.clarifyingQuestion || 'Which slide(s) do you mean, and what should change?',
    }
  }
  if (classification.editType === 'brand_kit_redirect') {
    // Message updated 2026-08-01 (Brand Kit removed for v1) -- there's no Brand Kit settings page
    // to point to anymore. Colors/font/logo are locked in per-carousel at creation time (colors
    // AI-picked from the brief, font always the default, logo either the Caroslide wordmark or
    // blank by plan) and aren't user-editable at all yet, on this carousel or any other.
    return {
      type: 'redirect',
      message:
        "This carousel's colors, logo, and font are set automatically when it's created and can't be changed yet -- try describing a change to specific text or a photo instead.",
    }
  }
  if (classification.editType === 'template_change') {
    return {
      type: 'unsupported',
      message: "Changing a slide's whole layout isn't supported yet -- try describing a text or photo change instead.",
    }
  }
  // undo/redo (2026-07-28) never touch a slide or the DB at all -- there's no server-side undo
  // history to act on (it only ever exists in Viewer.tsx's local React state, per the explicit-Save
  // build). Just confirm the classified intent; the caller calls its own local undo()/redo().
  if (classification.editType === 'undo') return { type: 'client_undo' }
  if (classification.editType === 'redo') return { type: 'client_redo' }

  const targetIndices = classification.slideIndices.length > 0 ? classification.slideIndices : [currentSlideIndex]
  const updatedSlides = [...slides]

  for (const idx of targetIndices) {
    const slide = slides[idx]
    if (!slide?.template || !slide.values) {
      return {
        type: 'error',
        message: `Slide ${idx + 1} was created before editing was supported on this carousel -- try a new one.`,
      }
    }

    const newValues = { ...slide.values }

    if (classification.editType === 'copy_rewrite') {
      const changed = await rewriteCopy(
        {
          message,
          currentValues: slide.values,
          voiceDescription: brandKit?.voice_description ?? null,
        },
        anthropicLimiter
      )
      console.log(`[chat-edit] rewriteCopy changed fields: ${JSON.stringify(changed)}`)
      Object.assign(newValues, changed)
    } else if (classification.editType === 'photo_swap') {
      const field = classification.targetField
      if (!field || !(field in slide.values)) {
        return { type: 'clarify', message: 'Which photo on this slide do you mean?' }
      }
      const brief = await generateSwapBrief({ message, currentValues: slide.values }, anthropicLimiter)
      const newUrl = await swapPhoto(brief, anthropicLimiter)
      if (!newUrl) {
        return {
          type: 'error',
          message: `Couldn't find a new photo for slide ${idx + 1} -- try again or describe it differently.`,
        }
      }
      newValues[field] = newUrl
    } else if (classification.editType === 'delete_object') {
      // Same two mechanisms the click-in-place hover-X/topbar delete already use -- clear a text
      // field to '', or toggle a move-only/photo field's own `_DISPLAY` placeholder to 'hidden'.
      // No new deletion path, just a chat route to the existing one.
      const field = classification.targetField
      const fieldDef = field ? EDITABLE_FIELDS[slide.template]?.find((f) => f.field === field) : undefined
      if (!field || !fieldDef) {
        return { type: 'clarify', message: 'Which element on this slide do you mean?' }
      }
      if (fieldDef.kind === 'text') {
        newValues[field] = ''
      } else {
        newValues[`${field}_DISPLAY`] = 'hidden'
      }
    } else if (classification.editType === 'move_object') {
      const field = classification.targetField
      const fieldDef = field ? EDITABLE_FIELDS[slide.template]?.find((f) => f.field === field) : undefined
      if (!field || !fieldDef?.movable) {
        return { type: 'clarify', message: 'Which element on this slide do you mean, and how should it move?' }
      }
      const currentPosX = parseInt(slide.values[`${field}_POS_X`] ?? '0', 10) || 0
      const currentPosY = parseInt(slide.values[`${field}_POS_Y`] ?? '0', 10) || 0
      const delta = await generateMoveDelta({ message, currentPosX, currentPosY }, anthropicLimiter)
      newValues[`${field}_POS_X`] = `${Math.round(currentPosX + delta.deltaX)}px`
      newValues[`${field}_POS_Y`] = `${Math.round(currentPosY + delta.deltaY)}px`
    } else if (classification.editType === 'color_change' || classification.editType === 'font_change') {
      // Same wrap-in-a-span mechanism the click-in-place color/font pickers already use -- just
      // AI-identified (which exact substring, which color/font) instead of user-selected.
      const field = classification.targetField
      if (!field || !(field in slide.values)) {
        return { type: 'clarify', message: 'Which text on this slide do you mean?' }
      }
      const currentHtml = slide.values[field]
      const edit =
        classification.editType === 'color_change'
          ? await generateColorEdit(
              { message, currentHtml, primary: slide.values.PRIMARY, secondary: slide.values.SECONDARY },
              anthropicLimiter
            )
          : await generateFontEdit({ message, currentHtml }, anthropicLimiter)
      if (!edit) {
        return { type: 'clarify', message: 'Which exact word(s) do you want to change, and to what?' }
      }
      const styleProp = classification.editType === 'color_change' ? 'color' : 'font-family'
      const styleValue = classification.editType === 'color_change' ? (edit as { hex: string }).hex : (edit as { fontFamily: string }).fontFamily
      const wrapped = wrapTextWithStyle(currentHtml, edit.matchText, styleProp, styleValue)
      if (!wrapped) {
        return {
          type: 'error',
          message: `Couldn't apply that -- the exact text "${edit.matchText}" spans more than this field allows. Try a shorter or different word.`,
        }
      }
      newValues[field] = wrapped
    }

    const result = await renderAndGuard(slide.template, newValues, idx + 1, brandKit?.voice_description ?? null, undefined, anthropicLimiter)

    // Fresh filename per edit, not an overwrite at the same path -- a same-path overwrite keeps
    // the exact same public URL, which risks the browser/any CDN serving a stale cached copy of
    // the OLD image even though the file itself changed. Old file cleaned up best-effort after,
    // same no-orphaned-storage discipline as createCarousel/deleteCarousel.
    const newPath = `${user!.id}/${carouselId}/slide-${idx + 1}-${Date.now()}.jpg`
    const { error: uploadError } = await supabase.storage
      .from('carousel-slides')
      .upload(newPath, result.png, { contentType: 'image/jpeg' })
    if (uploadError) return { type: 'error', message: `Failed to save the edited slide: ${uploadError.message}` }

    const { data: pub } = supabase.storage.from('carousel-slides').getPublicUrl(newPath)

    const oldPath = storagePathFromPublicUrl(slide.url)
    if (oldPath) {
      await supabase.storage.from('carousel-slides').remove([oldPath])
    }

    updatedSlides[idx] = { url: pub.publicUrl, template: slide.template, values: result.values }
  }

  return { type: 'updated', slides: updatedSlides }
}

// posX/posY resolved server-side from this slide's real values (2026-07-24, move/resize support)
// -- the client never parses CSS transform back into a number itself (a baked-in translate() in a
// stylesheet rule computes to an opaque matrix() string via getComputedStyle, and the raw inline
// style attribute is empty since the offset comes from a `{{FIELD_POS_X|0px}}` placeholder, not
// JS -- neither is a reliable source to read a plain number back out of). The server already knows
// the real current offset from `slide.values`, so it just sends the number directly.
export type SlideEditorField = EditableField & { posX?: number; posY?: number }
// primaryColor/secondaryColor: this carousel's own brand colors, already baked into slide.values
// as PRIMARY/SECONDARY by pipeline.ts at generation time -- exposed here so the click-in-place
// editor's per-word color toolbar can offer them as one-click swatches (2026-07-26).
export type SlideEditorData = {
  html: string
  canvasH: number
  fields: SlideEditorField[]
  primaryColor: string
  secondaryColor: string
  values: Record<string, string>
}

/**
 * Click-in-place editor support (2026-07-22): returns the slide's real filled template HTML (not
 * the PNG) so the client can render it live in an iframe and let the user click directly on the
 * actual text/photo elements -- see editableFields.ts for the selector map that makes this
 * possible without hand-annotating every template file.
 *
 * localValues (2026-07-28, explicit-Save build): field edits no longer persist to the DB the
 * instant they happen -- they accumulate client-side in Viewer.tsx's `slides` state until the
 * user hits Save. That means the DB's own `slide.values` goes stale the moment you make an
 * unsaved edit; re-fetching it here on every slide switch would silently revert whatever hasn't
 * been saved yet. When provided, localValues (the caller's current in-memory values for this
 * slide) is used to fill the template instead of the DB row's -- the DB fetch still happens, for
 * the auth check and the slide's `template` name, just not for `values` when a fresher local copy
 * exists.
 */
export async function getSlideEditorHtml(
  carouselId: string,
  slideIndex: number,
  localValues?: Record<string, string>
): Promise<SlideEditorData | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: carousel, error } = await supabase
    .from('carousels')
    .select('slides, user_id')
    .eq('id', carouselId)
    .single()
  if (error || !carousel) return { error: 'Could not find this carousel.' }
  if (carousel.user_id !== user!.id) return { error: 'Not authorized to edit this carousel.' }

  const slides = carousel.slides as Slide[]
  const slide = slides[slideIndex]
  if (!slide?.template || !slide.values) {
    return { error: 'This slide was created before editing was supported -- try a new one.' }
  }

  const values = localValues ?? slide.values
  const templateHtml = await loadTemplate(slide.template)
  const html = fillTemplate(templateHtml, values)
  const fields: SlideEditorField[] = (EDITABLE_FIELDS[slide.template] ?? []).map((f) =>
    f.movable
      ? { ...f, posX: parseInt(values[`${f.field}_POS_X`] ?? '0', 10) || 0, posY: parseInt(values[`${f.field}_POS_Y`] ?? '0', 10) || 0 }
      : f
  )
  return {
    html,
    canvasH: Number(values.CANVAS_H) || 1350,
    fields,
    primaryColor: values.PRIMARY || '#D97757',
    secondaryColor: values.SECONDARY || '#F4C95D',
    values,
  }
}

/**
 * Click-in-place editor support: saves one or more fields' new values (typed text, a URL from a
 * direct photo upload, or a position/size override from a drag) exactly as given. Deliberately
 * does NOT run through renderAndGuard's AI repair pass (repairOverBudget/repairMissingText) --
 * that pipeline exists to fix up AI-GENERATED content that came out wrong; here the user
 * explicitly typed, picked, or dragged this value themselves, so silently resizing or rewriting
 * it out from under them would be wrong, not helpful. Reuses the same fresh-filename-per-edit +
 * old-file-cleanup discipline as editSlide/createCarousel.
 *
 * Accepts a batch (Record<string,string>) as well as a single field/value pair -- a drag commits
 * an X and a Y offset together, and saving them as two separate calls would race (the second call
 * would spread from whatever `slide.values` looked like before the first call's write landed,
 * silently dropping it). One call, one merge, one render.
 */
export async function updateSlideField(
  carouselId: string,
  slideIndex: number,
  field: string | Record<string, string>,
  newValue?: string
): Promise<FieldUpdateResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: carousel, error: fetchError } = await supabase
    .from('carousels')
    .select('slides, user_id')
    .eq('id', carouselId)
    .single()
  if (fetchError || !carousel) return { type: 'error', message: 'Could not find this carousel.' }
  if (carousel.user_id !== user!.id) return { type: 'error', message: 'Not authorized to edit this carousel.' }

  const slides = carousel.slides as Slide[]
  const slide = slides[slideIndex]
  if (!slide?.template || !slide.values) {
    return { type: 'error', message: 'This slide was created before editing was supported -- try a new one.' }
  }

  const updates = typeof field === 'string' ? { [field]: newValue ?? '' } : field
  const newValues = { ...slide.values, ...updates }
  const { png, unresolved } = await renderSlide(slide.template, newValues)
  if (unresolved.length > 0) {
    return {
      type: 'error',
      message: `That left this slide broken (${unresolved.join(', ')} unresolved) -- try a different value.`,
    }
  }

  const newPath = `${user!.id}/${carouselId}/slide-${slideIndex + 1}-${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from('carousel-slides')
    .upload(newPath, png, { contentType: 'image/jpeg' })
  if (uploadError) return { type: 'error', message: `Failed to save: ${uploadError.message}` }

  const { data: pub } = supabase.storage.from('carousel-slides').getPublicUrl(newPath)

  const oldPath = storagePathFromPublicUrl(slide.url)
  if (oldPath) {
    await supabase.storage.from('carousel-slides').remove([oldPath])
  }

  const updatedSlides = [...slides]
  updatedSlides[slideIndex] = { url: pub.publicUrl, template: slide.template, values: newValues }

  return { type: 'updated', slides: updatedSlides }
}

export async function updateCarouselBrand(
  id: string,
  input: { colors: string[]; logoUrl: string | null; font: string }
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('carousels')
    .update({ brand_colors: input.colors, logo_url: input.logoUrl, font: input.font })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteCarousel(id: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // `.select('reference_images')` on the delete itself (not a separate SELECT beforehand) --
  // captures the row's reference_images in the same round trip, right as it's deleted, so there's
  // no window where a second request could race in between a read and the delete. Returns an
  // empty array (not an error) if the id/user_id pair matched no row, same silent-no-op behavior
  // this action already had before this cleanup existed.
  const { data: deletedRows, error } = await supabase
    .from('carousels')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('reference_images')
  if (error) throw new Error(error.message)

  // Real cleanup, not just the DB row -- previously left every deleted carousel's slide PNGs
  // orphaned in Storage forever (no code anywhere ever removed them). The folder name matches
  // this carousel's own `id` (see createCarousel), so this is a real, safe, precisely-scoped
  // cleanup, not a guess at what might belong to it. Best-effort: the DB row is already gone
  // (the part that matters to the user), so a Storage failure here shouldn't surface as an error.
  const folder = `${user.id}/${id}`
  const { data: files } = await supabase.storage.from('carousel-slides').list(folder)
  if (files && files.length > 0) {
    await supabase.storage
      .from('carousel-slides')
      .remove(files.map((f) => `${folder}/${f.name}`))
  }

  // Photo Continuous's single source photo (uploadReferenceImage) lives in `carousel-uploads`,
  // not `carousel-slides` -- and unlike rendered slides, its path isn't scoped under this
  // carousel's own id/folder (it's `${userId}/${randomId}-${filename}`, uploaded before the
  // carousel even existed -- see uploadReferenceImage's own comment). The only way to find it is
  // off `reference_images` on the row itself, captured above before the row was gone. A real
  // DELETE policy for this bucket already exists (012_storage_delete_policy.sql), it just had no
  // caller for this bucket until now -- previously the source photo stayed in this
  // publicly-readable bucket forever, even after the carousel that referenced it was deleted.
  // Same best-effort discipline as the carousel-slides cleanup above.
  const referenceImages = (deletedRows?.[0]?.reference_images as Slide[] | undefined) ?? []
  const uploadPaths = referenceImages
    .map((img) => storagePathFromPublicUrl(img.url, 'carousel-uploads'))
    .filter((p): p is string => p !== null)
  if (uploadPaths.length > 0) {
    await supabase.storage.from('carousel-uploads').remove(uploadPaths)
  }
}

export async function saveBrandKit(input: {
  colors?: string[]
  logoUrl?: string | null
  font?: string
  voiceDescription?: string | null
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // colors made optional alongside the others here (2026-07-25) -- a caller that never touched a
  // field (the wizard's Brand Kit step, when someone only sets a font and clicks Continue) must be
  // able to leave it out entirely rather than force a value in. Supabase's upsert only writes the
  // columns actually present in this object: on a brand-new row the table's own column defaults
  // apply (colors '{}', font 'Inter Tight' -- see schema.sql/003_brand_font.sql), and on an
  // existing row an omitted column is left untouched, not overwritten with whatever the caller
  // happened to have in state.
  const { error } = await supabase.from('brand_kits').upsert({
    user_id: user!.id,
    ...(input.colors !== undefined ? { colors: input.colors } : {}),
    ...(input.logoUrl !== undefined ? { logo_url: input.logoUrl } : {}),
    ...(input.font !== undefined ? { font: input.font } : {}),
    ...(input.voiceDescription !== undefined ? { voice_description: input.voiceDescription } : {}),
  })
  if (error) throw new Error(error.message)
}
