// Real generation work, extracted out of actions.ts (2026-07-31) so both the Next.js app (the
// producer, which just enqueues a message -- see actions.ts's createCarousel) and the standalone
// Cloudflare Queue consumer (workers/carousel-consumer/, the actual real invocation of this
// function) can import the same code. A prior attempt ran this via Cloudflare's ctx.waitUntil()
// directly from the Server Action -- that only buys ~30s past the response before Cloudflare
// kills whatever's still running, nowhere near enough for a real 2-3 minute generation. A Queue
// consumer is its own real Worker invocation with the normal full time budget, not bound by that
// 30s post-response cap.
import { generateCarousel, generateSplitPhotoCarousel, type Limiter } from './pipeline'
import type { AnthropicLimiter } from './anthropicLimiter'
// Relative, not the `@/` alias -- this file (and everything else under generation/) is imported
// directly by workers/carousel-consumer/, a separate Cloudflare Worker build that wrangler bundles
// with plain esbuild, which doesn't know about Next.js's tsconfig path aliases. Every cross-file
// import inside generation/ itself is already relative for the same reason; this is the one file
// that needs to reach outside that folder, so it's the one that has to stay alias-free.
import { createServiceClient } from '../supabase/service'
import type { Angle, Format, Look, TemplateVariant } from '../types'

export type CarouselGenerationJob = {
  carouselId: string
  userId: string
  angle: Angle
  format: Format
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  voiceDescription: string | null
  referenceImageUrls: string[]
  brandColors: string[]
  font: string
  suppressLogoFallback: boolean
}

export async function runCarouselGeneration(
  input: CarouselGenerationJob,
  renderLimiter?: Limiter,
  anthropicLimiter?: AnthropicLimiter
) {
  console.log(`[generation] background task starting for carousel ${input.carouselId}`)
  const uploadedPaths: string[] = []
  const supabase = createServiceClient()
  try {
    // Photo Continuous (2026-08-02) routes to a deliberately separate, much simpler generation
    // path -- no captions.ts call, no photo-sourcing, no guardrail/repair loop, and (2026-08-03)
    // no CTA/branding slide at all (see generateSplitPhotoCarousel's own comment in
    // pipeline.ts). The `as [string, string, string, string, string]` cast is safe only because
    // this Look's wizard step guarantees exactly 5 URLs land here -- one distinct photo per
    // slide, per the frame-collage rebuild. `templateVariant!` is non-null for this Look
    // specifically -- unlike Plain Text/Bold Hook, which pass `null` -- Photo Continuous always
    // has a variant.
    const generated =
      input.look === 'Photo Continuous'
        ? await generateSplitPhotoCarousel({
            format: input.format,
            templateVariant: input.templateVariant!,
            photoUrls: input.referenceImageUrls as [string, string, string, string, string],
            renderLimiter,
          })
        : await generateCarousel({
            angle: input.angle,
            format: input.format,
            look: input.look,
            templateVariant: input.templateVariant,
            brief: input.brief,
            voiceDescription: input.voiceDescription,
            referenceImageUrls: input.referenceImageUrls,
            brandColors: input.brandColors,
            logoUrl: null,
            font: input.font,
            suppressLogoFallback: input.suppressLogoFallback,
            renderLimiter,
            anthropicLimiter,
          })
    console.log(`[generation] carousel ${input.carouselId} captions+slides generated, uploading ${generated.slides.length} slides`)

    const slides = []
    for (let i = 0; i < generated.slides.length; i++) {
      const slide = generated.slides[i]
      const path = `${input.userId}/${input.carouselId}/slide-${i + 1}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('carousel-slides')
        .upload(path, slide.png, { contentType: 'image/jpeg' })
      if (uploadError) throw new Error(`Slide ${i + 1} upload failed: ${uploadError.message}`)
      uploadedPaths.push(path)

      const { data: pub } = supabase.storage.from('carousel-slides').getPublicUrl(path)
      slides.push({ url: pub.publicUrl, template: slide.template, values: slide.values })
    }

    const { error } = await supabase
      .from('carousels')
      .update({
        title: generated.title || input.brief.trim().slice(0, 60) || `${input.angle} carousel`,
        slides,
        status: 'ready',
      })
      .eq('id', input.carouselId)
    if (error) throw new Error(error.message)
    console.log(`[generation] carousel ${input.carouselId} marked ready`)
  } catch (err) {
    // A later slide failing shouldn't leave earlier slides' real uploads orphaned in Storage with
    // no way to find them again -- best-effort cleanup, same as the old inline try/catch.
    if (uploadedPaths.length > 0) {
      await supabase.storage.from('carousel-slides').remove(uploadedPaths)
    }
    console.error(`[generation] carousel ${input.carouselId} failed`, err)
    await supabase
      .from('carousels')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Something went wrong generating this carousel.',
      })
      .eq('id', input.carouselId)
  }
}
