import { unresolvedPlaceholders } from './render'

// Measured empirically 2026-07-20 -- real boundary-case renders (15/20/25/30-word captions,
// screenshot-verified), not guessed. See initial-generation-behavior.md's guardrail table for the
// full writeup, including the 2 real template bugs this testing found and fixed (Photo Grid's
// logo collision, Editorial/Spotlight's kicker collision -- both now structurally fixed at the
// template level, these budgets are a writing-quality ceiling for those two, not a safety one).
// Overlay's budget is still a real safety constraint -- that template's brand-badge collision is
// NOT fixed at the template level, so this is the only thing preventing a broken render.
// Keyed by template FILE (not TemplateVariant label) + the actual placeholder name, since one
// TemplateVariant label (e.g. "Side by Side") maps to the same file in both Photo Focus and Bold
// Stat Looks -- the file is the real unit that has a measured box size, not the label.
const CHAR_BUDGETS: Record<string, Record<string, number>> = {
  '1-cover-circles.html': { CAPTION_HTML: 165 },
  '3-flip.html': { CAPTION_HTML: 165 },
  '11-single-circle.html': { HEADLINE_HTML: 165, STORY_HTML: 250 },
  // Re-measured 2026-07-22 after real accumulated evidence, per this entry's own note to revisit
  // once the template had actually shipped a few carousels: the original 110/200 guess triggered a
  // guardrail violation on STORY_HTML in nearly every one of ~8 independent real slide generations
  // that night (consistently 250-310 chars, never once under 200), plus one real HEADLINE_HTML
  // overage (132 chars). Checked against the template's own real layout, not just the observed
  // range: `.stage` is top-anchored and grows downward with ~1070px of real available height before
  // the bottom padding (no photo sharing the canvas, unlike most other templates this budget table
  // covers) -- STORY_HTML's 32px/1.45-line-height text has real room for well over double the
  // original 200-char budget even after a multi-line headline. Every guardrail violation triggers a
  // real repair-and-re-render (extra Opus + Cloudflare cost, and more render volume = more 429
  // risk under concurrent load) -- a budget this consistently missed on the FIRST render wasn't
  // protecting quality, it was just manufacturing avoidable repairs. 320/145 comfortably covers the
  // real observed range with margin; still a real ceiling, not removed.
  '12-hook-block.html': { HEADLINE_HTML: 145, STORY_HTML: 320 },
  '2-split-cover.html': { CAPTION_HTML: 165, STAT_LABEL: 40 },
  '4-vertical-split.html': { CAPTION_HTML: 165, STAT_LABEL: 40 },
  '6-minimal-magazine.html': { HEADLINE_HTML: 165, STORY_HTML: 250, STAT_LABEL: 40 },
  '8-photo-grid.html': { CAPTION_HTML: 165, STAT_LABEL: 40 },
  '9-split-flip.html': { CAPTION_HTML: 195, STAT_LABEL: 40 },
  // Not fixed at the template level -- collides with the brand badge past ~15-18 words at the
  // default BRAND_LINE_BOTTOM. This budget is the real, load-bearing safety net for that bug.
  '10-split-overlay.html': { CAPTION_HTML: 60 },
  '7-keynote.html': { STATEMENT_HTML: 70 },
  // Tested clean with plenty of margin (headline <=9 words, subhead <=12 words, button <=4
  // words) -- this was previously missing entirely from this table, meaning the CTA slide
  // (every carousel's slide 5, always) had zero length enforcement. Real gap, closed 2026-07-20.
  'cta.html': { HEADLINE_HTML: 70, SUBHEAD: 85, CTA_TEXT: 30 },
}

// Real bug found live (2026-07-21, Photo Grid): these 6 templates support a dual mode (a plain
// caption/story pair vs. a STAT_NUMBER+STAT_LABEL takeover, per each template's own top comment).
// CHAR_BUDGETS only checks LENGTH when a field is present -- it silently skips an EMPTY field
// (see checkCharBudgets' `if (!value) continue`), so a slide that left CAPTION_HTML/STORY_HTML
// completely unset while also not using stat mode shipped with just a one-line
// tagline/kicker/headline and otherwise-empty body, no violation ever raised. At least one of the
// listed fields must be non-empty whenever STAT_NUMBER is unset. 6-minimal-magazine.html and
// 11-single-circle.html list BOTH HEADLINE_HTML and STORY_HTML because those two are genuine
// alternatives (a cover/resolution slide uses headline only, a narrative slide uses story only) --
// requiring only one of the two, not both, matches that template's own real 3-way mode split.
const REQUIRED_TEXT_FIELDS: Record<string, string[]> = {
  '8-photo-grid.html': ['CAPTION_HTML'],
  '2-split-cover.html': ['CAPTION_HTML'],
  '4-vertical-split.html': ['CAPTION_HTML'],
  '9-split-flip.html': ['CAPTION_HTML'],
  '6-minimal-magazine.html': ['HEADLINE_HTML', 'STORY_HTML'],
  '11-single-circle.html': ['HEADLINE_HTML', 'STORY_HTML'],
}

export type GuardrailViolation =
  | { type: 'over_budget'; field: string; length: number; budget: number }
  | { type: 'unresolved_placeholders'; placeholders: string[] }
  | { type: 'duplicate_photo'; fieldA: string; fieldB: string; url: string }
  | { type: 'unreachable_image'; field: string; url: string; status?: number }
  | { type: 'missing_required_text'; fields: string[] }

/** Strips markup before counting -- budgets are measured against visible text length, not HTML. */
function textLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').length
}

export function checkCharBudgets(
  templateFile: string,
  values: Record<string, string>
): GuardrailViolation[] {
  const budgets = CHAR_BUDGETS[templateFile]
  if (!budgets) return []
  const violations: GuardrailViolation[] = []
  for (const [field, budget] of Object.entries(budgets)) {
    const value = values[field]
    if (!value) continue
    const length = textLength(value)
    if (length > budget) {
      violations.push({ type: 'over_budget', field, length, budget })
    }
  }
  return violations
}

export function checkRequiredText(templateFile: string, values: Record<string, string>): GuardrailViolation[] {
  const requiredFields = REQUIRED_TEXT_FIELDS[templateFile]
  if (!requiredFields) return []
  if (values.STAT_NUMBER) return [] // stat-takeover mode legitimately leaves all of these unset
  const hasAny = requiredFields.some((field) => textLength(values[field] ?? '') > 0)
  return hasAny ? [] : [{ type: 'missing_required_text', fields: requiredFields }]
}

export function checkUnresolvedPlaceholders(filledHtml: string): GuardrailViolation[] {
  const remaining = unresolvedPlaceholders(filledHtml)
  return remaining.length ? [{ type: 'unresolved_placeholders', placeholders: remaining }] : []
}

// Spotlight/Spotlight Left specifically -- the whole point of a background-plus-circle-inset
// layout is pairing the main subject with a DIFFERENT related photo, not a duplicate crop of the
// same one (a real mistake caught and fixed once already this session on a manual render).
export function checkNoDuplicatePhoto(values: Record<string, string>): GuardrailViolation[] {
  if (values.BG_IMG && values.CIRCLE_IMG && values.BG_IMG === values.CIRCLE_IMG) {
    return [{ type: 'duplicate_photo', fieldA: 'BG_IMG', fieldB: 'CIRCLE_IMG', url: values.BG_IMG }]
  }
  return []
}

const IMAGE_FIELDS = [
  'BG_IMG',
  'CIRCLE_IMG',
  'CIRCLE_L_IMG',
  'CIRCLE_R_IMG',
  'IMG_LEFT',
  'IMG_RIGHT',
  'IMG_MAIN',
  'IMG_TOP',
  'IMG_BOTTOM',
]

export async function checkImagesReachable(
  values: Record<string, string>
): Promise<GuardrailViolation[]> {
  const violations: GuardrailViolation[] = []
  for (const field of IMAGE_FIELDS) {
    const url = values[field]
    if (!url || url.startsWith('data:')) continue // generic placeholder SVGs never fail
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (!res.ok) violations.push({ type: 'unreachable_image', field, url, status: res.status })
    } catch {
      violations.push({ type: 'unreachable_image', field, url })
    }
  }
  return violations
}

export async function checkSlide(
  templateFile: string,
  values: Record<string, string>,
  filledHtml: string
): Promise<GuardrailViolation[]> {
  return [
    ...checkCharBudgets(templateFile, values),
    ...checkRequiredText(templateFile, values),
    ...checkUnresolvedPlaceholders(filledHtml),
    ...checkNoDuplicatePhoto(values),
    ...(await checkImagesReachable(values)),
  ]
}
