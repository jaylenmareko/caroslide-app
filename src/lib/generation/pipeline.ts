import Anthropic from '@anthropic-ai/sdk'
import type { Angle, Format, Look, TemplateVariant, Slide } from '@/lib/types'
import { templateFileFor, CTA_TEMPLATE } from './templates'
import { generateCaptions } from './captions'
import { findUsablePhoto, photosNeeded, PHOTO_FIELDS_FOR_TEMPLATE, solidColorPlaceholder } from './images'
import { renderSlide } from './render'
import { checkSlide, type GuardrailViolation } from './guardrails'
import { fontValues } from './fonts'

const anthropic = new Anthropic()

const CANVAS_H: Record<Format, number> = { Post: 1350, Square: 1080, Story: 1920 }

// Fields with a documented {{FIELD_SIZE}} override in at least one template -- shrinking this is
// a legitimate fix for an over-budget field (a real, established pattern this session used
// manually multiple times, e.g. STAT_SIZE:125px to fit "500M" instead of clipping at the 165px
// default), not just a band-aid. Maps the over-budget text field to its size placeholder.
const SIZE_OVERRIDE_FOR: Record<string, string> = {
  CAPTION_HTML: 'CAPTION_SIZE',
  HEADLINE_HTML: 'HEADLINE_SIZE',
  STORY_HTML: 'STORY_SIZE',
  STATEMENT_HTML: 'STATEMENT_SIZE',
}
const DEFAULT_SIZE_PX: Record<string, number> = {
  CAPTION_SIZE: 46,
  HEADLINE_SIZE: 56,
  STORY_SIZE: 42,
  STATEMENT_SIZE: 84,
}

async function resolvePhotos(
  photoBriefs: Record<string, string>,
  referenceImagePool: string[]
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  for (const [field, brief] of Object.entries(photoBriefs)) {
    const uploaded = referenceImagePool.shift()
    if (uploaded) {
      resolved[field] = uploaded
      continue
    }
    const photo = await findUsablePhoto(brief)
    if (photo) {
      resolved[field] = photo.url
    } else {
      // If sourcing fails entirely (real image search AND the page-scrape fallback both came up
      // empty), leave the field unset -- the solid-color placeholder fallback below covers it.
      console.warn(`[generation] photo sourcing failed for ${field} ("${brief}") -- image search + page-scrape fallback both failed`)
    }
  }
  return resolved
}

/** One deterministic repair attempt for over-budget text fields -- shrink the matching *_SIZE
 * placeholder proportionally to how far over budget the text is. Returns the same values object
 * with sizes adjusted, or the original if no repairable violations exist. */
function repairOverBudget(
  values: Record<string, string>,
  violations: GuardrailViolation[]
): Record<string, string> {
  const repaired = { ...values }
  for (const v of violations) {
    if (v.type !== 'over_budget') continue
    const sizeField = SIZE_OVERRIDE_FOR[v.field]
    if (!sizeField) continue
    const current = Number(repaired[sizeField]) || DEFAULT_SIZE_PX[sizeField]
    const shrinkRatio = Math.max(0.6, v.budget / v.length) // never shrink below 60% of original
    repaired[sizeField] = `${Math.round(current * shrinkRatio)}px`
  }
  return repaired
}

async function visionReview(png: Buffer): Promise<{ ok: boolean; note: string }> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
          {
            type: 'text',
            text: 'Is this social carousel slide visually clean -- no clipped/overlapping text, no obviously broken image, legible? Reply with exactly "OK" if it is, or a one-sentence description of the specific problem if not.',
          },
        ],
      },
    ],
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text.trim() ?? ''
  return { ok: text.toUpperCase().startsWith('OK'), note: text }
}

async function renderAndGuard(
  templateFile: string,
  values: Record<string, string>,
  slideNumber: number
): Promise<{ png: Buffer; values: Record<string, string> }> {
  let current = values
  let { png, filledHtml } = await renderSlide(templateFile, current)
  let violations = await checkSlide(templateFile, current, filledHtml)

  // Silent until now -- no log statement anywhere surfaced these, meaning a partially-broken
  // slide (e.g. a photo slot that never resolved, left as a literal unresolved {{...IMG}}
  // placeholder) was only ever visible by eyeballing the rendered PNG. Real gap, found live
  // 2026-07-21 debugging why some circles rendered blank/broken despite real photoBriefs.
  if (violations.length > 0) {
    console.warn(`[generation] slide ${slideNumber} (${templateFile}) guardrail violations: ${JSON.stringify(violations)}`)
  }

  if (violations.length > 0) {
    current = repairOverBudget(current, violations)
    ;({ png, filledHtml } = await renderSlide(templateFile, current))
    violations = await checkSlide(templateFile, current, filledHtml)
  }

  // Vision fallback: only when a guardrail still flagged something after the deterministic
  // repair pass -- not on every slide by default. One look, at most one more repair+re-render,
  // then ship regardless (chat-edit is the safety net, per the spec -- no open-ended loop).
  if (violations.length > 0) {
    const review = await visionReview(png)
    if (!review.ok) {
      console.warn(`[generation] slide ${slideNumber} (${templateFile}) shipped with unresolved issues: ${JSON.stringify(violations)}, vision note: ${review.note}`)
      current = repairOverBudget(current, violations)
      ;({ png } = await renderSlide(templateFile, current))
    }
  }

  return { png, values: current }
}

export async function generateCarousel(input: {
  angle: Angle
  format: Format
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  voiceDescription: string | null
  referenceImageUrls: string[]
  brandColors: string[]
  logoUrl: string | null
  font: string
}): Promise<{ title: string; slides: Array<{ png: Buffer; template: string; values: Record<string, string> }> }> {
  const templateFile = templateFileFor(input.look, input.templateVariant)
  const canvasH = CANVAS_H[input.format]

  const generated = await generateCaptions({
    angle: input.angle,
    format: input.format,
    look: input.look,
    templateVariant: input.templateVariant,
    brief: input.brief,
    voiceDescription: input.voiceDescription,
    hasReferenceImages: input.referenceImageUrls.length > 0,
  })

  const brand = {
    PRIMARY: input.brandColors[0] ?? '#D97757',
    SECONDARY: input.brandColors[1] ?? '#F4C95D',
    // Real product decision (Jaylen, 2026-07-21): if the user never uploads a brand logo, fall
    // back to Caroslide's OWN wordmark rather than the account's own name -- a carousel with no
    // brand logo set should read as "made with Caroslide," not silently promote whatever text
    // happens to be the account's display name. There's no up-to-date Caroslide logo IMAGE asset
    // in this repo yet (the only existing files under projects/business/caroslide/assets/ are the
    // old carosale-branded coins+legs mark, flagged stale in CONTEXT.md) -- falls back to a text
    // wordmark using the same .a/.b two-tone span convention every template already expects,
    // matching how any other brand's text-only fallback renders. Swap in a real logo `<img>` once
    // an actual Caroslide brand-mark image exists.
    LOGO_HTML: input.logoUrl
      ? `<img src="${input.logoUrl}" alt="">`
      : `<span class="a">Caroslide</span><span class="b"></span>`,
    ...fontValues(input.font),
  }

  // Sanity-check the model's own photoBriefs count against the template's real, measured photo
  // count (images.ts's PHOTO_COUNT) -- not a hard failure (the raw template HTML in the prompt is
  // the real source of truth and unresolved-placeholder detection catches a wrong field name
  // after render), but worth surfacing loudly if the model under/over-counts, since that's a sign
  // something else about the response may be off too.
  const expectedPhotoCount = photosNeeded(input.templateVariant, input.look)
  // Real field names for this template, in the same top-to-bottom order the model was told to
  // fill PHOTO_1/2/3 in (captions.ts) -- maps the model's generic slots back onto what fillTemplate
  // actually needs (e.g. BG_IMG, CIRCLE_L_IMG, CIRCLE_R_IMG for 1-cover-circles.html).
  const photoFieldOrder = PHOTO_FIELDS_FOR_TEMPLATE[templateFile] ?? []
  generated.slides.slice(0, -1).forEach((slide, i) => {
    const actual = [slide.photoBriefs.PHOTO_1, slide.photoBriefs.PHOTO_2, slide.photoBriefs.PHOTO_3].filter(
      (v) => v && v.trim().length > 0
    ).length
    if (actual !== expectedPhotoCount) {
      console.warn(
        `[generation] slide ${i + 1} (${templateFile}) returned ${actual} photoBriefs, expected ${expectedPhotoCount}`
      )
    }
  })

  const referenceImagePool = [...input.referenceImageUrls]
  const slides: Array<{ png: Buffer; template: string; values: Record<string, string> }> = []

  for (let i = 0; i < generated.slides.length; i++) {
    const slide = generated.slides[i]
    const isCta = i === generated.slides.length - 1
    const templateForSlide = isCta ? CTA_TEMPLATE : templateFile
    const needsPhotos = !isCta && expectedPhotoCount > 0
    // Remap the model's generic PHOTO_1/2/3 slots (captions.ts) onto this template's real field
    // names, positionally, dropping any slot the template doesn't use or the model left unset.
    const genericBriefs = [slide.photoBriefs.PHOTO_1, slide.photoBriefs.PHOTO_2, slide.photoBriefs.PHOTO_3]
    const mappedPhotoBriefs: Record<string, string> = {}
    photoFieldOrder.forEach((fieldName, idx) => {
      const brief = genericBriefs[idx]
      if (brief && brief.trim().length > 0) mappedPhotoBriefs[fieldName] = brief
    })
    const photoValues = needsPhotos ? await resolvePhotos(mappedPhotoBriefs, referenceImagePool) : {}
    // Real gap found live 2026-07-21: when sourcing genuinely fails for a slot (~50% hit rate
    // observed), the field was left unset entirely -- fillTemplate leaves the literal
    // `{{FIELD}}` placeholder in the rendered HTML, shipping a visibly broken circle/panel.
    // Fill any still-missing slot with a flat brand-color placeholder instead -- a clean, honest
    // "no photo" panel beats a broken image, and it's what `checkUnresolvedPlaceholders` was
    // actually meant to prevent from ever reaching a render.
    if (needsPhotos) {
      for (const fieldName of photoFieldOrder) {
        if (!photoValues[fieldName]) {
          photoValues[fieldName] = solidColorPlaceholder(brand.PRIMARY)
        }
      }
    }

    // Order matters: brand/format fields and resolved photo URLs go LAST so nothing the model
    // returned in `slide.values` can override them. The model sees the raw template HTML
    // (including PRIMARY/SECONDARY/LOGO_HTML/CANVAS_H placeholders) as context, so it's fully
    // capable of echoing one of those keys back in `values` even though it was told not to --
    // the ordering here is what actually prevents that from mattering, not just the instruction.
    // `slide.values`' fields are all individually optional now (captions.ts) -- filter out any
    // unset ones defensively before spreading, so fillTemplate's `key in values` check (which
    // treats a present-but-undefined key as "resolved") can never render the literal word
    // "undefined" for a field the model legitimately left blank.
    const definedSlideValues = Object.fromEntries(
      Object.entries(slide.values).filter(([, v]) => v !== undefined)
    )
    const values: Record<string, string> = {
      ...definedSlideValues,
      ...photoValues,
      ...brand,
      CANVAS_H: String(canvasH),
    }
    if (input.templateVariant === 'Spotlight Left') values.CIRCLE_SIDE = 'left'

    const result = await renderAndGuard(templateForSlide, values, i + 1)
    slides.push({ png: result.png, template: templateForSlide, values: result.values })
  }

  return { title: generated.title, slides }
}

export type { Slide }
