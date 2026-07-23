import Anthropic from '@anthropic-ai/sdk'
import type { Angle, Format, Look, TemplateVariant, Slide } from '@/lib/types'
import { templateFileFor, CTA_TEMPLATE } from './templates'
import { generateCaptions } from './captions'
import { findUsablePhoto, photosNeeded, PHOTO_FIELDS_FOR_TEMPLATE, solidColorPlaceholder } from './images'
import { renderSlide, sanitizeStrayEscapes } from './render'
import { checkSlide, budgetsFor, textLength, type GuardrailViolation } from './guardrails'
import { fontValues } from './fonts'
import { rewriteCopy } from './edit'
import { EDITABLE_FIELDS } from './editableFields'

const anthropic = new Anthropic()

// Real bug found live (2026-07-22): timing-based fixes (an i*400ms stagger on each slide's first
// render, then jitter before repair re-renders) both still 429'd -- across repeated real tests,
// even spaced-out start times weren't enough. That points at a real CONCURRENCY cap on Cloudflare's
// Browser Rendering API (a fixed number of simultaneous browser sessions), not just a requests-per-
// time-window limit -- 5 renders starting a few hundred ms apart can still all be genuinely in
// flight at once if each takes several seconds, which blowing past a concurrency cap doesn't care
// how spread out the START times were. A real semaphore -- capping how many renderSlide calls are
// actually in flight at once, queuing the rest -- addresses that directly instead of guessing at
// more timing tweaks. 2 is a conservative first real value (Cloudflare's docs describe browser
// concurrency limits in that range for this API); this is the one lever actually worth tuning if a
// 429 recurs, not another stagger/jitter number.
function createLimiter(maxConcurrent: number) {
  let active = 0
  const queue: Array<() => void> = []
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active++
    try {
      return await fn()
    } finally {
      active--
      const next = queue.shift()
      if (next) next()
    }
  }
}
type Limiter = <T>(fn: () => Promise<T>) => Promise<T>
const NO_LIMIT: Limiter = (fn) => fn()

// Real gap found live (2026-07-22, Jaylen: "what happens if many users use this at once?"): a
// limiter created fresh per generateCarousel call only bounds ONE carousel's own slides -- 10
// concurrent users each get their own independent limiter instance, so up to 10x this cap could
// still hit Cloudflare's real ACCOUNT-WIDE concurrency quota at once (the same account/API token
// is shared by every user), reproducing the exact 429 this was built to prevent, just triggered by
// multiple users instead of one carousel's own 5 slides. A single MODULE-level instance is shared
// by every request this running server process handles, so total concurrent Cloudflare renders
// across every user generating at once stays capped, not just one carousel's own slides.
// Real, worth remembering if this ever scales past one server instance/region (not the case yet --
// a single Next.js process): this only coordinates requests within ONE running process. Multiple
// instances would each get their own independent cap again, reopening this same gap at a different
// layer -- a real cross-instance fix then needs a shared EXTERNAL limiter (e.g. a Redis-backed
// semaphore), not a bigger in-process number.
const globalRenderLimit = createLimiter(2)

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

// See the real-bug comment where this is used (generateCarousel's per-slide loop) -- these two
// templates share the exact kicker+headline / story / stat 3-way pattern (confirmed via
// guardrails.ts's REQUIRED_TEXT_FIELDS), the only ones where HEADLINE_HTML and STORY_HTML are
// genuine alternatives that can visually collide if both get filled at once.
const HEADLINE_STORY_ALTERNATIVE_TEMPLATES = new Set(['11-single-circle.html', '6-minimal-magazine.html'])

// Split into a sync allocation pass + an async search pass (2026-07-22, generation-speed work) --
// previously one function did both `.shift()` off the shared reference-image pool AND the real
// (slow) findUsablePhoto search in the same sequential loop, which forced every slide's photo
// work to run one after another even though slides don't actually depend on each other. `.shift()`
// on a shared array is a genuine race if two slides' photo work ever ran concurrently, and pool
// order matters (earlier slides should get first pick of the user's own uploads) -- so allocation
// stays a single synchronous pass, run once for all slides before any parallel work starts, and
// only the real network searches (the actually slow part) move to running concurrently.
function allocateFromPool(
  photoBriefs: Record<string, string>,
  referenceImagePool: string[]
): { preAssigned: Record<string, string>; remaining: Record<string, string> } {
  const preAssigned: Record<string, string> = {}
  const remaining: Record<string, string> = {}
  for (const [field, brief] of Object.entries(photoBriefs)) {
    const uploaded = referenceImagePool.shift()
    if (uploaded) {
      preAssigned[field] = uploaded
    } else {
      remaining[field] = brief
    }
  }
  return { preAssigned, remaining }
}

async function searchPhotos(photoBriefs: Record<string, string>): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  await Promise.all(
    Object.entries(photoBriefs).map(async ([field, brief]) => {
      const photo = await findUsablePhoto(brief)
      if (photo) {
        resolved[field] = photo.url
      } else {
        // If sourcing fails entirely (real image search AND the page-scrape fallback both came up
        // empty), leave the field unset -- the solid-color placeholder fallback below covers it.
        console.warn(`[generation] photo sourcing failed for ${field} ("${brief}") -- image search + page-scrape fallback both failed`)
      }
    })
  )
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

// Real bug found live (2026-07-22, direct visual review of test carousels): repairOverBudget ran
// independently PER SLIDE, so a carousel's 3 content slides could each get a DIFFERENT shrink
// ratio depending on how long THAT slide's own text happened to be -- slide 2's caption barely
// over budget shrinks a little, slide 4's caption badly over budget shrinks a lot, and the result
// is captions that visibly get smaller slide-to-slide within the same carousel. Real fix: compute
// ONE shared size per field, from the LONGEST content across all of a carousel's non-CTA slides
// (cover + 3 content slides all share the same templateFile, so the same char budgets apply),
// BEFORE any slide renders at all -- every slide gets the same font size whether its own text is
// short or long, so the carousel reads as one consistent design instead of a shrinking cascade.
// This also means the common over-budget case now resolves on the FIRST render instead of needing
// a repair-triggered re-render at all -- fewer real Cloudflare render calls per carousel, which
// directly helps the render-volume/429-risk pattern already fixed elsewhere in this file.
function computeSharedSizeOverrides(
  templateFile: string,
  slides: Array<{ values: Record<string, string | undefined> }>
): Record<string, string> {
  const budgets = budgetsFor(templateFile)
  if (!budgets) return {}
  const overrides: Record<string, string> = {}
  for (const [field, budget] of Object.entries(budgets)) {
    const sizeField = SIZE_OVERRIDE_FOR[field]
    if (!sizeField) continue
    const maxLength = Math.max(0, ...slides.map((s) => textLength(s.values[field] ?? '')))
    if (maxLength <= budget) continue // nobody's over -- every slide already uses the same default size
    const shrinkRatio = Math.max(0.6, budget / maxLength) // never shrink below 60% of original
    overrides[sizeField] = `${Math.round(DEFAULT_SIZE_PX[sizeField] * shrinkRatio)}px`
  }
  return overrides
}

/** Real repair (not just a resize) for a `missing_required_text` or `unresolved_placeholders`
 * violation -- either way a field was left completely blank (silently, or as a literal
 * `{{FIELD}}` string that survived to the render), so there's nothing to shrink; regenerate it via
 * the same rewriteCopy path chat-editing uses, given a plain instruction naming exactly what's
 * missing. Reuses rewriteCopy rather than a second, drifted "write copy" call.
 *
 * Real gap found live (2026-07-22, Bold Hook's first real generation): this previously only
 * handled `missing_required_text` -- a genuinely blank REQUIRED field (one with no `|default` in
 * the template, so it renders as a literal unresolved placeholder instead of silently empty) was
 * caught by checkUnresolvedPlaceholders and even flagged again by vision-review, but nothing ever
 * actually repaired it -- it just shipped broken every time. Handling both violation types here
 * closes that for every template, not just this one. */
async function repairMissingText(
  values: Record<string, string>,
  violations: GuardrailViolation[],
  voiceDescription: string | null
): Promise<Record<string, string>> {
  const missing = violations.find((v): v is Extract<GuardrailViolation, { type: 'missing_required_text' }> => v.type === 'missing_required_text')
  const unresolved = violations.find((v): v is Extract<GuardrailViolation, { type: 'unresolved_placeholders' }> => v.type === 'unresolved_placeholders')

  // Real bug found live (2026-07-22, Overlay's real generation): repairOverBudget only shrinks the
  // font, capped at a 60% floor (below that, text becomes illegibly small) -- but the model can
  // overshoot a genuinely tight budget by 3-4x (239 chars against Overlay's real 60-char ceiling,
  // the load-bearing safety net for its known, unfixed brand-badge collision), and shrinking alone
  // can never close a gap that large. Confirmed live: the slide still shipped with the badge visibly
  // overlapping the caption even after the existing repair + one vision-triggered repair. Threshold
  // widened 0.6 -> 0.75 the same night, still live-testing Overlay: a 97-char/60-budget case (ratio
  // 0.62, just above the original 0.6 cutoff) got ONLY shrunk, not rewritten, and vision-review
  // still confirmed the badge overlapping the text -- a "just barely shrinkable" case is still a
  // real collision risk on this specific template, not a safe edge case. When the shrink ratio a
  // field would need is below 75%, escalate to a REAL rewrite asking for genuinely short text
  // instead of shipping shrunk-but-still-too-long text.
  const severelyOverBudget = violations.filter(
    (v): v is Extract<GuardrailViolation, { type: 'over_budget' }> => v.type === 'over_budget' && v.budget / v.length < 0.75
  )
  if (!missing && !unresolved && severelyOverBudget.length === 0) return values

  const fields = [...(missing?.fields ?? []), ...(unresolved?.placeholders.map((p) => p.replace(/[{}]/g, '')) ?? [])]
  const messages: string[] = []
  if (fields.length > 0) {
    messages.push(
      `This slide was left with ${fields.join(', ')} completely blank -- that's not a valid shortcut, every field this template's current mode uses must have real content. Write real text for ${fields.join(' and ')} now, fitting the rest of this slide's content.`
    )
  }
  for (const v of severelyOverBudget) {
    messages.push(
      `${v.field} is way too long for this template (${v.length} characters against a real ${v.budget}-character ceiling) -- shrinking the font can't fix an overage this large without becoming illegible. Rewrite ${v.field} from scratch as a genuinely short version, at or under ${v.budget} characters, keeping the same core point.`
    )
  }
  const changed = await rewriteCopy({
    message: messages.join(' '),
    currentValues: values,
    voiceDescription,
  })
  return { ...values, ...changed }
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
// repair/vision-fallback discipline as initial generation instead of a second, drifted copy. A
// single chat-edit re-render is never concurrent with anything else, so `limit` defaults to a
// pass-through (see NO_LIMIT above) -- only generateCarousel's real 5-way burst needs a real cap.
export async function renderAndGuard(
  templateFile: string,
  values: Record<string, string>,
  slideNumber: number,
  voiceDescription: string | null = null,
  limit: Limiter = NO_LIMIT
): Promise<{ png: Buffer; values: Record<string, string> }> {
  let current = values
  let { png, filledHtml } = await limit(() => renderSlide(templateFile, current))
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
    current = await repairMissingText(current, violations, voiceDescription)
    ;({ png, filledHtml } = await limit(() => renderSlide(templateFile, current)))
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
      current = await repairMissingText(current, violations, voiceDescription)
      ;({ png } = await limit(() => renderSlide(templateFile, current)))
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

  // Computed ONCE from every non-CTA slide's real text (cover + 3 content slides all share
  // templateFile, so the same char budgets apply to all of them) -- see computeSharedSizeOverrides'
  // own comment for why this replaced independent per-slide shrinking.
  const sharedSizeOverrides = computeSharedSizeOverrides(templateFile, generated.slides.slice(0, -1))

  // Base (cover-slide) expectations -- the template's real, measured photo count (images.ts's
  // PHOTO_COUNT) and real field names in top-to-bottom order (captions.ts's PHOTO_1/2/3 -> real
  // field mapping). Inner content slides of a COVER_ONLY_MOTIF template override both, below.
  const baseExpectedPhotoCount = photosNeeded(input.templateVariant, input.look)
  const basePhotoFieldOrder = PHOTO_FIELDS_FOR_TEMPLATE[templateFile] ?? []
  const alternatingDirectionField = ALTERNATING_DIRECTION_FIELD[templateFile]
  const coverOnlyMotif = COVER_ONLY_MOTIF[templateFile]

  const referenceImagePool = [...input.referenceImageUrls]

  // Speed work (2026-07-22, Jaylen: "are we able to speed up generation too?"): slides don't
  // actually depend on each other's photo search or render/guardrail work -- the only real
  // cross-slide dependency is the reference-image pool (earlier slides should get first pick of
  // the user's own uploads, and `.shift()` on a shared array would race if run concurrently).
  // Splitting into a synchronous planning pass (below, decides pool allocation in slide order)
  // followed by a `Promise.all` execution pass turns what was ~5 slides' worth of sequential
  // network calls (photo search + Cloudflare render + guardrail retries) into one wall-clock
  // wait for the slowest slide instead of the sum of all of them.
  const plans = generated.slides.map((slide, i) => {
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
    const { preAssigned, remaining } = needsPhotos
      ? allocateFromPool(mappedPhotoBriefs, referenceImagePool)
      : { preAssigned: {}, remaining: {} }

    return { slide, isCta, templateForSlide, isMotifInnerSlide, photoFieldOrder, needsPhotos, preAssigned, remaining }
  })

  // Real semaphore (createLimiter above), not a timing guess -- see its own comment for why the
  // i*400ms stagger this replaced wasn't enough (repeated live 429s even with staggered starts and
  // jittered repair-retries point at a real Cloudflare concurrency cap, not a time-window one).
  // Uses the module-level globalRenderLimit (see its own comment) rather than a fresh instance per
  // call -- real gap found live the same night: a per-call limiter only bounds THIS carousel's own
  // slides, not the real account-wide cap shared across every concurrent user's carousel.
  const renderLimit = globalRenderLimit

  const slides = await Promise.all(
    plans.map(async ({ slide, isCta, templateForSlide, isMotifInnerSlide, photoFieldOrder, needsPhotos, preAssigned, remaining }, i) => {
      const searched = needsPhotos ? await searchPhotos(remaining) : {}
      const photoValues: Record<string, string> = { ...preAssigned, ...searched }
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
        Object.entries(slide.values)
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
          .map(([k, v]) => [k, sanitizeStrayEscapes(v)])
      )

      // Real bug found live (2026-07-22, Photo Column/4-vertical-split.html under Photo Focus): the
      // model filled BOTH the plain-mode fields (TAGLINE/CAPTION_HTML) AND the stat-mode fields
      // (STAT_NUMBER/STAT_LABEL) on the same slide, despite the prose modeInstruction saying only
      // one mode applies -- the model also sees this template's own raw HTML/comments describing
      // "cover slide: use .stat + .statlbl," which apparently competes with the modeInstruction
      // instead of being overridden by it. A prose fix isn't reliable here (same lesson as the
      // required-field bug earlier tonight) -- `input.look` already tells us with certainty which
      // mode is correct, so force-blank whichever mode's fields don't apply, regardless of what the
      // model wrote. Deliberately NOT simply omitting the wrong-mode keys from the schema instead:
      // `{{STAT_NUMBER}}`/`{{STAT_LABEL}}` have no `|default` in the dual-mode templates, so an
      // absent key would render as a literal broken placeholder -- an explicit empty string is what
      // actually keeps the unused mode's markup invisible.
      if (!isCta) {
        const isStatMode = input.look === 'Bold Stat'
        const templateTextFields = (EDITABLE_FIELDS[templateForSlide] ?? [])
          .filter((f) => f.kind === 'text')
          .map((f) => f.field)
        for (const field of templateTextFields) {
          const isStatField = field === 'STAT_NUMBER' || field === 'STAT_LABEL'
          if (isStatField !== isStatMode) definedSlideValues[field] = ''
        }

        // Real bug found live (2026-07-22, direct visual review, Spotlight/11-single-circle.html):
        // the model filled BOTH a real kicker+headline pair AND a full STORY_HTML paragraph on the
        // same slide -- these two are genuine alternatives on this template (and
        // 6-minimal-magazine.html, the only other one sharing this exact 3-way pattern), not a
        // both-at-once option, but unlike the stat/plain split above there's no external input
        // (like `input.look`) that tells us which one the model intended -- it's the model's own
        // creative choice of "bookend kicker+headline" vs "narrative paragraph" per slide. Since
        // `.cover-block` (kicker+headline) and `.story` are both absolute-positioned with only
        // ~20px of separation, having both non-empty doesn't just waste text, it visually piles the
        // two blocks on top of each other into illegible overlapping text. Prefer the kicker+
        // headline pair when both are present -- shorter, and matches this template's own top
        // comment framing kicker+headline as the cover/resolution (bookend) convention, the more
        // common real case for this to fire on.
        if (HEADLINE_STORY_ALTERNATIVE_TEMPLATES.has(templateForSlide) && definedSlideValues.HEADLINE_HTML && definedSlideValues.STORY_HTML) {
          definedSlideValues.STORY_HTML = ''
        }
      }
      const values: Record<string, string> = {
        ...definedSlideValues,
        ...photoValues,
        ...(isCta ? {} : sharedSizeOverrides),
        ...brand,
        CANVAS_H: String(canvasH),
      }
      if (input.templateVariant === 'Spotlight Left') values.CIRCLE_SIDE = 'left'

      // Real bug found live (2026-07-22, right after this parallelization work shipped): 5 slides
      // now reach renderAndGuard at roughly the same instant instead of one at a time, bursting
      // Cloudflare with near-simultaneous screenshot requests and hitting a 429 that exhausted
      // every retry. renderLimit (a real concurrency cap, not a timing guess -- see its own
      // comment) is what actually bounds how many of these are in flight on Cloudflare at once;
      // the SLOW parts above (photo search, guardrail/repair loop) still run fully in parallel.
      const result = await renderAndGuard(templateForSlide, values, i + 1, input.voiceDescription, renderLimit)
      return { png: result.png, template: templateForSlide, values: result.values }
    })
  )

  return { title: sanitizeStrayEscapes(generated.title), slides }
}

export type { Slide }
