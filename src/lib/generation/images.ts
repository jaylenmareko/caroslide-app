import { imageSize } from 'image-size'
import type { TemplateVariant } from '@/lib/types'
import { tavilyCandidateUrls } from './research'

const MIN_DIMENSION = 400 // reject tiny icons/thumbnails masquerading as og:image

// Both fetches in this file are server-side and their target isn't literally user-typed (page
// URLs come from Claude's web_search results), but nothing upstream guarantees that stays true
// forever -- reject anything that isn't a plain http(s) URL before ever calling fetch() on it,
// so a malformed/unexpected value (file://, an internal-looking scheme, etc.) fails closed
// instead of being handed to the server's fetch implementation.
function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// How many real photo slots the mapped template needs -- one per {{...IMG}} placeholder in the
// real .claude/skills/carousel/templates/*.html file. Measured directly off the templates
// (grepped every {{BG_IMG}}/{{CIRCLE_IMG}}/etc.), not guessed -- see
// initial-generation-behavior.md's "Images" section for the source table this mirrors.
export const PHOTO_COUNT: Record<TemplateVariant, number> = {
  Classic: 3,
  Flipped: 3,
  Spotlight: 2,
  'Spotlight Left': 2,
  'Side by Side': 2,
  'Split Flip': 2,
  Overlay: 2,
  'Photo Grid': 3,
  'Photo Column': 1,
  Editorial: 1,
}

export function photosNeeded(variant: TemplateVariant | null, look: string): number {
  if (look === 'Plain Text') return 0
  return variant ? PHOTO_COUNT[variant] : 0
}

// Real field names, in the same top-to-bottom order the model sees them in the template's own
// HTML, per template FILE (mirrors CHAR_BUDGETS's file-keyed convention in guardrails.ts, for the
// same reason -- one TemplateVariant label maps to the same file across two different Looks).
// Used to map the model's generic PHOTO_1/PHOTO_2/PHOTO_3 slots (captions.ts) back onto the real
// placeholder names this specific template needs -- see captions.ts's 2026-07-21 comment for why
// the schema uses fixed generic slots instead of per-template-named or record fields.
export const PHOTO_FIELDS_FOR_TEMPLATE: Record<string, string[]> = {
  '1-cover-circles.html': ['BG_IMG', 'CIRCLE_L_IMG', 'CIRCLE_R_IMG'],
  '3-flip.html': ['BG_IMG', 'CIRCLE_L_IMG', 'CIRCLE_R_IMG'],
  '11-single-circle.html': ['BG_IMG', 'CIRCLE_IMG'],
  '2-split-cover.html': ['IMG_LEFT', 'IMG_RIGHT'],
  '4-vertical-split.html': ['BG_IMG'],
  '6-minimal-magazine.html': ['BG_IMG'],
  '8-photo-grid.html': ['IMG_MAIN', 'IMG_TOP', 'IMG_BOTTOM'],
  '9-split-flip.html': ['IMG_LEFT', 'IMG_RIGHT'],
  '10-split-overlay.html': ['IMG_LEFT', 'IMG_RIGHT'],
}

/**
 * Direct port of .claude/skills/carousel/scripts/fetch_og_image.py -- pulls a page's og:image
 * meta tag (no API key needed, works because most photo/content pages set it server-side for
 * link-preview crawlers). Returns null on any failure so the caller can just try the next
 * candidate URL, matching the skill's own "first one that succeeds, don't chase perfection" rule.
 */
export async function fetchOgImage(
  pageUrl: string
): Promise<{ url: string; buffer: Buffer; width: number; height: number } | null> {
  if (!isSafeHttpUrl(pageUrl)) return null

  let html: string
  try {
    const pageRes = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!pageRes.ok) return null
    html = await pageRes.text()
  } catch {
    return null
  }

  const match =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (!match) return null
  const imgUrl = match[1]
  if (!isSafeHttpUrl(imgUrl)) return null

  let buffer: Buffer
  try {
    const imgRes = await fetch(imgUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!imgRes.ok) return null
    buffer = Buffer.from(await imgRes.arrayBuffer())
  } catch {
    return null
  }

  try {
    const { width, height } = imageSize(buffer)
    if (!width || !height || width < MIN_DIMENSION || height < MIN_DIMENSION) return null
    // Return the ORIGINAL image URL, not a re-hosted copy -- the render step (Cloudflare's
    // browser) fetches it live at screenshot time same as any real browser would, no need to
    // download-then-reupload through our own Storage first. `buffer`/dimensions are only needed
    // transiently for this guardrail check.
    return { url: imgUrl, buffer, width, height }
  } catch {
    return null // downloaded file isn't a valid/decodable image
  }
}

/** Tries each candidate URL in order, returns the first usable photo. Caps at candidates.length tries. */
export async function firstUsablePhoto(
  candidateUrls: string[]
): Promise<{ url: string; buffer: Buffer; width: number; height: number } | null> {
  for (const url of candidateUrls) {
    const result = await fetchOgImage(url)
    if (result) return result
  }
  return null
}

/**
 * Finds 2-3 real candidate page URLs for a photo brief (e.g. "man applying sunscreen outdoors
 * photo") via Tavily's search API -- plain HTTP, not an Anthropic tool call (avoids the same
 * refusal issue found in captions.ts, see session log 2026-07-20). Mirrors image-sourcing.md's
 * own guidance: specific, scene-level queries return better candidate pages than abstract topic
 * words.
 */
export async function searchCandidatePhotoUrls(photoBrief: string): Promise<string[]> {
  return tavilyCandidateUrls(`${photoBrief} photo`)
}
