'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/backend/lib/supabase/server'
import type { Angle, Format, Look, TemplateVariant, Slide } from '@/backend/lib/types'
import { generateCarousel, renderAndGuard } from '@/backend/lib/generation/pipeline'
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
    success_url: `${origin}/settings?checkout=success`,
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
    success_url: `${origin}/settings?checkout=success`,
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

export async function createCarousel(input: {
  angle: Angle
  format: Format
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  referenceImageUrls: string[]
  brandColors: string[]
  logoUrl: string | null
  font: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Real, Stripe-tied plan enforcement (2026-07-26) -- replaces the old flat 20-per-account
  // stopgap. Free/past_due/no-subscription accounts get a lifetime cap (matches the marketing
  // page's "1 carousel free when you sign up"); an active paid plan gets a per-billing-period cap
  // instead, counted from carousels created since current_period_start -- not a stored counter, so
  // it can't drift out of sync with what Stripe actually reports.
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_start')
    .eq('user_id', user!.id)
    .maybeSingle()

  const isActivePaid = subscription?.status === 'active' && subscription.plan
  const limit = isActivePaid ? PLAN_CAROUSEL_LIMITS[subscription!.plan as Plan] : FREE_LIFETIME_CAROUSEL_LIMIT

  let countQuery = supabase
    .from('carousels')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user!.id)
  if (isActivePaid && subscription!.current_period_start) {
    countQuery = countQuery.gte('created_at', subscription!.current_period_start)
  }
  const { count: existingCount } = await countQuery

  if ((existingCount ?? 0) >= limit) {
    // Over the plan's cap (or never subscribed) -- fall back to purchased carousel-pack credits
    // (see migration 009) before blocking. Balance is always sum(delta), never a stored counter.
    const { data: ledgerRows } = await supabase.from('credit_ledger').select('delta').eq('user_id', user!.id)
    const creditBalance = (ledgerRows ?? []).reduce((sum, row) => sum + row.delta, 0)

    if (creditBalance <= 0) {
      throw new Error(
        isActivePaid
          ? `You've used all ${limit} carousels for this billing period. It renews automatically, or buy a carousel pack in Settings.`
          : `You've used your free carousel. Upgrade or buy a carousel pack in Settings.`
      )
    }

    const { error: consumeError } = await supabase
      .from('credit_ledger')
      .insert({ user_id: user!.id, delta: -1, reason: 'consumption' })
    if (consumeError) throw new Error(`Failed to use a carousel-pack credit: ${consumeError.message}`)
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

  const generated = await generateCarousel({
    angle: input.angle,
    format: input.format,
    look: input.look,
    templateVariant: input.templateVariant,
    brief: input.brief,
    voiceDescription: brandKit?.voice_description ?? null,
    referenceImageUrls: input.referenceImageUrls,
    brandColors: input.brandColors,
    logoUrl: input.logoUrl,
    font: input.font,
  })

  // One folder per carousel (not one random folder per slide, the previous behavior) -- keeps a
  // carousel's slides grouped together in Storage, and gives partial-failure cleanup below a
  // single known prefix to target instead of no way to find what was already uploaded.
  const carouselId = crypto.randomUUID()
  const uploadedPaths: string[] = []
  const slides = []
  try {
    for (let i = 0; i < generated.slides.length; i++) {
      const slide = generated.slides[i]
      const path = `${user!.id}/${carouselId}/slide-${i + 1}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('carousel-slides')
        .upload(path, slide.png, { contentType: 'image/jpeg' })
      if (uploadError) throw new Error(`Slide ${i + 1} upload failed: ${uploadError.message}`)
      uploadedPaths.push(path)

      const { data: pub } = supabase.storage.from('carousel-slides').getPublicUrl(path)
      slides.push({ url: pub.publicUrl, template: slide.template, values: slide.values })
    }
  } catch (error) {
    // A later slide failing shouldn't leave earlier slides' real uploads orphaned in Storage with
    // no DB row ever created to reference them -- best-effort cleanup, then let the real error
    // surface (this is a resource-leak fix, not something that should mask the actual failure).
    if (uploadedPaths.length > 0) {
      await supabase.storage.from('carousel-slides').remove(uploadedPaths)
    }
    throw error
  }

  const { data, error } = await supabase
    .from('carousels')
    .insert({
      // Explicit, not the column's own default -- matches the Storage folder name above, so
      // deleteCarousel below can find and remove this carousel's images by a single known prefix
      // instead of having no way to associate a DB row with its own uploaded files.
      id: carouselId,
      user_id: user!.id,
      title: generated.title || input.brief.trim().slice(0, 60) || `${input.angle} carousel`,
      angle: input.angle,
      format: input.format,
      look: input.look,
      template_variant: input.templateVariant,
      brief: input.brief,
      slides,
      reference_images: input.referenceImageUrls.map((url) => ({ url })),
      // Snapshotted here, not read live from brand_kits at generation time --
      // see the Carousel type's brand_colors/logo_url/font comment.
      brand_colors: input.brandColors,
      logo_url: input.logoUrl,
      font: input.font,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  redirect(`/carousel/${data.id}`)
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
 * deleted carousel. */
function storagePathFromPublicUrl(url: string): string | null {
  const marker = '/carousel-slides/'
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
    .select('slides, user_id')
    .eq('id', carouselId)
    .single()
  if (fetchError || !carousel) return { type: 'error', message: 'Could not find this carousel.' }
  if (carousel.user_id !== user!.id) return { type: 'error', message: 'Not authorized to edit this carousel.' }

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

  const classification = await classifyEdit({ message, currentSlideIndex, slides })
  console.log(`[chat-edit] classification: ${JSON.stringify(classification)}`)

  if (classification.editType === 'ambiguous') {
    return {
      type: 'clarify',
      message: classification.clarifyingQuestion || 'Which slide(s) do you mean, and what should change?',
    }
  }
  if (classification.editType === 'brand_kit_redirect') {
    return { type: 'redirect', message: 'Brand colors, logo, and font live in the Brand Kit button above, not chat edits.' }
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
      const changed = await rewriteCopy({
        message,
        currentValues: slide.values,
        voiceDescription: brandKit?.voice_description ?? null,
      })
      console.log(`[chat-edit] rewriteCopy changed fields: ${JSON.stringify(changed)}`)
      Object.assign(newValues, changed)
    } else if (classification.editType === 'photo_swap') {
      const field = classification.targetField
      if (!field || !(field in slide.values)) {
        return { type: 'clarify', message: 'Which photo on this slide do you mean?' }
      }
      const brief = await generateSwapBrief({ message, currentValues: slide.values })
      const newUrl = await swapPhoto(brief)
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
      const delta = await generateMoveDelta({ message, currentPosX, currentPosY })
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
          ? await generateColorEdit({ message, currentHtml, primary: slide.values.PRIMARY, secondary: slide.values.SECONDARY })
          : await generateFontEdit({ message, currentHtml })
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

    const result = await renderAndGuard(slide.template, newValues, idx + 1, brandKit?.voice_description ?? null)

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

  const { error } = await supabase.from('carousels').delete().eq('id', id).eq('user_id', user.id)
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
