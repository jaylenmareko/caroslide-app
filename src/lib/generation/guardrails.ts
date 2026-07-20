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

export type GuardrailViolation =
  | { type: 'over_budget'; field: string; length: number; budget: number }
  | { type: 'unresolved_placeholders'; placeholders: string[] }
  | { type: 'duplicate_photo'; fieldA: string; fieldB: string; url: string }
  | { type: 'unreachable_image'; field: string; url: string; status?: number }

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
    ...checkUnresolvedPlaceholders(filledHtml),
    ...checkNoDuplicatePhoto(values),
    ...(await checkImagesReachable(values)),
  ]
}
