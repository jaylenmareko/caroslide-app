'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Angle, Format, Look, TemplateVariant, Slide } from '@/lib/types'
import { generateCarousel, renderAndGuard } from '@/lib/generation/pipeline'
import { classifyEdit, rewriteCopy, generateSwapBrief, swapPhoto } from '@/lib/generation/edit'

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

  // STOPGAP, not real billing: there is no credits/plan-tier system built yet (Settings' "Free --
  // 1 carousel to start" and the marketing page's "credits are only spent on new carousels" copy
  // are both promises with zero enforcement in code right now). Real generation costs real money
  // per call (Anthropic + Cloudflare), so an account with no cap at all could be called
  // repeatedly, unbounded, by a bug or a bad actor. This is a blunt safety net -- generous enough
  // not to block real usage/testing, not the actual quota system. Replace with real Stripe-tied
  // credit tracking when billing gets built; don't mistake this for that.
  const MAX_CAROUSELS_PER_ACCOUNT = Number(process.env.MAX_CAROUSELS_PER_ACCOUNT) || 20
  const { count: existingCount } = await supabase
    .from('carousels')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user!.id)
  if ((existingCount ?? 0) >= MAX_CAROUSELS_PER_ACCOUNT) {
    throw new Error(
      `You've reached the ${MAX_CAROUSELS_PER_ACCOUNT}-carousel limit for this account. Delete an old one or contact support.`
    )
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
      const path = `${user!.id}/${carouselId}/slide-${i + 1}.png`
      const { error: uploadError } = await supabase.storage
        .from('carousel-slides')
        .upload(path, slide.png, { contentType: 'image/png' })
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

export type EditSlideResult =
  | { type: 'clarify' | 'redirect' | 'unsupported' | 'error'; message: string }
  | { type: 'updated'; slides: Slide[] }

/** Pulls the real Storage path back out of a Supabase public URL (everything after the bucket
 * name) so a re-uploaded slide's old file can be cleaned up -- same no-orphaned-storage
 * discipline as createCarousel/deleteCarousel, just for a single edited slide instead of a whole
 * deleted carousel. */
function storagePathFromPublicUrl(url: string): string | null {
  const marker = '/carousel-slides/'
  const idx = url.indexOf(marker)
  return idx === -1 ? null : url.slice(idx + marker.length)
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
      Object.assign(newValues, changed)
    } else {
      // photo_swap
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
    }

    const result = await renderAndGuard(slide.template, newValues, idx + 1)

    // Fresh filename per edit, not an overwrite at the same path -- a same-path overwrite keeps
    // the exact same public URL, which risks the browser/any CDN serving a stale cached copy of
    // the OLD image even though the file itself changed. Old file cleaned up best-effort after,
    // same no-orphaned-storage discipline as createCarousel/deleteCarousel.
    const newPath = `${user!.id}/${carouselId}/slide-${idx + 1}-${Date.now()}.png`
    const { error: uploadError } = await supabase.storage
      .from('carousel-slides')
      .upload(newPath, result.png, { contentType: 'image/png' })
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
  colors: string[]
  logoUrl?: string | null
  font?: string
  voiceDescription?: string | null
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.from('brand_kits').upsert({
    user_id: user!.id,
    colors: input.colors,
    ...(input.logoUrl !== undefined ? { logo_url: input.logoUrl } : {}),
    ...(input.font !== undefined ? { font: input.font } : {}),
    ...(input.voiceDescription !== undefined ? { voice_description: input.voiceDescription } : {}),
  })
  if (error) throw new Error(error.message)
}
