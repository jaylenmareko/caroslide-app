'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Angle, Format, Look, TemplateVariant } from '@/lib/types'
import { generateCarousel } from '@/lib/generation/pipeline'

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

export async function updateCarouselSlides(id: string, slides: { url: string }[]) {
  const supabase = await createClient()
  const { error } = await supabase.from('carousels').update({ slides }).eq('id', id)
  if (error) throw new Error(error.message)
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
