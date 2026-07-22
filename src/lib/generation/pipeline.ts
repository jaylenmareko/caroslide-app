import Anthropic from '@anthropic-ai/sdk'
import type { Angle, Format, Look, TemplateVariant, Slide } from '@/lib/types'
import { templateFileFor, CTA_TEMPLATE } from './templates'
import { generateCaptions } from './captions'
import { findUsablePhoto, photosNeeded, PHOTO_FIELDS_FOR_TEMPLATE, solidColorPlaceholder } from './images'
import { renderSlide } from './render'
import { checkSlide, type GuardrailViolation } from './guardrails'
import { fontValues } from './fonts'

const anthropic = new Anthropic()

// Exported (2026-07-21, chat-editing build) -- a single-slide edit re-render needs the same real
// canvas height as initial generation, keyed the same way.
export const CANVAS_H: Record<Format, number> = { Post: 1350, Square: 1080, Story: 1920 }

// Extracted into its own exported function (2026-07-21, chat-editing build) -- a single-slide edit
// re-render needs the exact same brand values (colors, logo/Caroslide-wordmark fallback, font) as
// initial generation, not a second drifted copy of this logic.
export function buildBrandValues(input: {
  brandColors: string[]
  logoUrl: string | null
  font: string
}): Record<string, string> {
  const userFontValues = fontValues(input.font)
  // Real bug fixed 2026-07-21: the Caroslide wordmark fallback rendered in whatever generic font
  // the carousel's own brand happened to use (Inter Tight/Poppins/etc.) -- not Caroslide's actual
  // brand typeface. The real app's wordmark is ALWAYS Fraunces italic weight 600 (confirmed exactly
  // in globals.css's `.brand span` rule, used consistently sidebar/landing/auth-everywhere) -- a
  // generated carousel's fallback logo should match that same real identity, not drift depending on
  // which font a given carousel's brand kit happens to use. The rendered slide is a standalone HTML
  // document (doesn't share the Next.js app's own font loading), so Fraunces needs its own real
  // Google Fonts link here, appended to (not replacing) the carousel's own brand-font link.
  const FRAUNCES_LOGO_FONT_LINK =
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&display=swap">'

  return {
    PRIMARY: input.brandColors[0] ?? '#D97757',
    SECONDARY: input.brandColors[1] ?? '#F4C95D',
    // Real product decision (Jaylen, 2026-07-21): if the user never uploads a brand logo, fall
    // back to Caroslide's OWN wordmark rather than the account's own name -- a carousel with no
    // brand logo set should read as "made with Caroslide," not silently promote whatever text
    // happens to be the account's display name. There's no up-to-date Caroslide logo IMAGE asset
    // in this repo yet (the only existing files under projects/business/caroslide/assets/ are the
    // old carosale-branded coins+legs mark, flagged stale in CONTEXT.md) -- falls back to text.
    //
    // Real bug fixed 2026-07-21 (same day): the FIRST version of this fallback used the template's
    // own `.a`/`.b` two-tone span convention (`<span class="a">Caroslide</span>`), but `.a` is
    // styled `color:{{PRIMARY}}` in every template -- meaning "Caroslide" rendered in whatever
    // brand color the CURRENT carousel's own user happened to pick, not a fixed Caroslide identity.
    // Jaylen's explicit rule: Caroslide's own logo should always be white, never inherit a brand
    // color, unless it sits on a background light enough that white is unreadable. Checked every
    // real template file (2026-07-21): all 12 hardcode a dark background (#0a0a0a or #000000,
    // photo-based slides additionally scrim the top for text legibility) -- none currently support
    // a light background at all, so "always white" is safe for the entire current template set.
    // Hardcoded here via inline style rather than the .a/.b convention specifically so it can never
    // silently start following a template's PRIMARY color again. If a light-background template
    // variant is ever added, this needs a real per-template light/dark flag, not a guess.
    LOGO_HTML: input.logoUrl
      ? `<img src="${input.logoUrl}" alt="">`
      : `<span style="font-family:'Fraunces',serif; font-style:italic; font-weight:600; color:#ffffff">Caroslide</span>`,
    ...userFontValues,
    FONT_LINK_HTML: input.logoUrl
      ? userFontValues.FONT_LINK_HTML
      : `${userFontValues.FONT_LINK_HTML}${FRAUNCES_LOGO_FONT_LINK}`,
  }
}

// Templates where the cover slide (i===0) uses a strong, distinctive multi-photo motif that reads
// as repetitive if identical on every content slide -- reserved for the cover only. Classic's
// 2-circle "proof" device was the first real case (2026-07-21 complaint, confirmed against a real
// hand-built RanchPad carousel whose actual inner slides drop the circles entirely); Photo Grid's
// fixed asymmetric 3-photo layout is the same category of risk (a distinctive fixed shape, no
// built-in variation mechanism the way the alternating-split templates have), extended the same
// day. Inner slides use just `innerFieldOrder` (a subset of the cover's real photo fields) and
// `hiddenFields` still need a placeholder filled (even though invisible) so
// checkUnresolvedPlaceholders doesn't false-trip on them -- `coverExtraValues`/`innerExtraValues`
// are each template's own CSS-toggle placeholders (see `1-cover-circles.html`'s CIRCLES_DISPLAY /
// `8-photo-grid.html`'s GRID_MAIN_WIDTH+GRID_SIDE_DISPLAY comments).
const COVER_ONLY_MOTIF: Record<
  string,
  {
    innerFieldOrder: string[]
    hiddenFields: string[]
    coverExtraValues: Record<string, string>
    innerExtraValues: Record<string, string>
  }
> = {
  '1-cover-circles.html': {
    innerFieldOrder: ['BG_IMG'],
    hiddenFields: ['CIRCLE_L_IMG', 'CIRCLE_R_IMG'],
    coverExtraValues: { CIRCLES_DISPLAY: 'block' },
    innerExtraValues: { CIRCLES_DISPLAY: 'none' },
  },
  '8-photo-grid.html': {
    innerFieldOrder: ['IMG_MAIN'],
    hiddenFields: ['IMG_TOP', 'IMG_BOTTOM'],
    coverExtraValues: { GRID_MAIN_WIDTH: '60%', GRID_SIDE_DISPLAY: 'flex' },
    innerExtraValues: { GRID_MAIN_WIDTH: '100%', GRID_SIDE_DISPLAY: 'none' },
  },
}

// Templates with a real 2-photo-split alternation placeholder (added 2026-07-21). Both
// `2-split-cover.html`'s (and its siblings') and `4-vertical-split.html`'s own top comments
// already called for alternating which side the photo is on between slides so the carousel
// "doesn't feel static" -- but the app's pipeline never actually implemented it. Keyed by file
// (not TemplateVariant) since it's the file's own CSS mechanism; the two vertical-split-family
// templates use a differently-named placeholder (ROW_DIRECTION) than the three horizontal-split
// templates (SPLIT_DIRECTION), so this maps file -> its real placeholder name.
const ALTERNATING_DIRECTION_FIELD: Record<string, string> = {
  '2-split-cover.html': 'SPLIT_DIRECTION',
  '9-split-flip.html': 'SPLIT_DIRECTION',
  '10-split-overlay.html': 'SPLIT_DIRECTION',
  '4-vertical-split.html': 'ROW_DIRECTION',
}

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

// Exported (2026-07-21, chat-editing build) so a single-slide edit can reuse the exact same
// repair/vision-fallback discipline as initial generation instead of a second, drifted copy.
export async function renderAndGuard(
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

  const brand = buildBrandValues(input)

  // Base (cover-slide) expectations -- the template's real, measured photo count (images.ts's
  // PHOTO_COUNT) and real field names in top-to-bottom order (captions.ts's PHOTO_1/2/3 -> real
  // field mapping). Inner content slides of a COVER_ONLY_MOTIF template override both, below.
  const baseExpectedPhotoCount = photosNeeded(input.templateVariant, input.look)
  const basePhotoFieldOrder = PHOTO_FIELDS_FOR_TEMPLATE[templateFile] ?? []
  const alternatingDirectionField = ALTERNATING_DIRECTION_FIELD[templateFile]
  const coverOnlyMotif = COVER_ONLY_MOTIF[templateFile]

  const referenceImagePool = [...input.referenceImageUrls]
  const slides: Array<{ png: Buffer; template: string; values: Record<string, string> }> = []

  for (let i = 0; i < generated.slides.length; i++) {
    const slide = generated.slides[i]
    const isCta = i === generated.slides.length - 1
    const templateForSlide = isCta ? CTA_TEMPLATE : templateFile
    // Real product decision (Jaylen, 2026-07-21): a COVER_ONLY_MOTIF template's strong repeatable
    // photo motif is reserved for the cover slide -- repeating it identically on slides 2-4 read as
    // "same slide, new photo" (real complaint on Classic, confirmed against a real hand-built
    // RanchPad carousel whose actual inner slides drop the circles too; extended to Photo Grid the
    // same day on the same reasoning). Inner slides use fewer photo fields -- cheaper (fewer photo
    // searches per inner slide) and removes the extra fields' photo-sourcing risk entirely.
    const isMotifInnerSlide = !!coverOnlyMotif && !isCta && i > 0
    const photoFieldOrder = isMotifInnerSlide ? coverOnlyMotif.innerFieldOrder : basePhotoFieldOrder
    const expectedPhotoCount = isMotifInnerSlide ? coverOnlyMotif.innerFieldOrder.length : baseExpectedPhotoCount
    const needsPhotos = !isCta && expectedPhotoCount > 0

    // Sanity-check the model's own photoBriefs count against what THIS slide actually expects --
    // not a hard failure (the raw template HTML in the prompt is the real source of truth and
    // unresolved-placeholder detection catches a wrong field name after render), but worth
    // surfacing loudly if the model under/over-counts, since that's a sign something else about
    // the response may be off too.
    if (!isCta) {
      const actual = [slide.photoBriefs.PHOTO_1, slide.photoBriefs.PHOTO_2, slide.photoBriefs.PHOTO_3].filter(
        (v) => v && v.trim().length > 0
      ).length
      if (actual !== expectedPhotoCount) {
        console.warn(
          `[generation] slide ${i + 1} (${templateForSlide}) returned ${actual} photoBriefs, expected ${expectedPhotoCount}`
        )
      }
    }

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
    if (coverOnlyMotif && !isCta) {
      Object.assign(photoValues, isMotifInnerSlide ? coverOnlyMotif.innerExtraValues : coverOnlyMotif.coverExtraValues)
      // Verified live (standalone fillTemplate test, 2026-07-21, Classic; same reasoning applies
      // to any COVER_ONLY_MOTIF template): with the extra photo fields hidden via CSS, their
      // {{FIELD}} placeholders still need SOME value or checkUnresolvedPlaceholders false-
      // positives on every inner slide -- wasting a vision-review call over something nobody will
      // ever see. photoFieldOrder is just the inner set on these slides, so the "fill any missing
      // slot" loop above never touches the hidden fields -- fill them explicitly instead.
      if (isMotifInnerSlide) {
        for (const fieldName of coverOnlyMotif.hiddenFields) {
          photoValues[fieldName] = solidColorPlaceholder(brand.PRIMARY)
        }
      }
    }
    // Alternates a 2-photo-split template's own orientation placeholder per content-slide index
    // (added 2026-07-21) -- these templates' own top comments already called for this ("mirror it
    // on alternating slides" / "so the carousel doesn't feel static") but the pipeline never
    // actually implemented it before now.
    if (alternatingDirectionField && !isCta) {
      photoValues[alternatingDirectionField] = i % 2 === 0 ? 'flex-direction:row;' : 'flex-direction:row-reverse;'
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
