import Anthropic from '@anthropic-ai/sdk'
import { imageSize } from 'image-size'
import type { TemplateVariant } from '@/lib/types'
import { tavilyCandidateUrls, tavilyImageSearch, pexelsSearch } from './research'

const anthropic = new Anthropic()

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

// Real bug found live 2026-07-21: og:image scraping pulled a watermarked, unlicensed Alamy stock
// photo into a real render (caught by the AI vision-review fallback, which only runs when another
// guardrail already flagged something on that slide -- a slide where every photo resolves would
// have shipped it undetected). Stock-photo marketplace "photo detail" pages almost always set
// og:image to their own watermarked preview thumbnail, not a licensable/usable image -- reject
// these page URLs outright before ever fetching them, rather than relying on vision-review to
// catch it after the fact.
const STOCK_PHOTO_DOMAINS = [
  'alamy.com',
  'shutterstock.com',
  'gettyimages.com',
  'istockphoto.com',
  'dreamstime.com',
  '123rf.com',
  'depositphotos.com',
  'stock.adobe.com',
  'canstockphoto.com',
  'bigstockphoto.com',
  // Found live 2026-07-21 testing Tavily's include_images mode against real photo briefs --
  // these weren't in the original list and would have slipped through: vecteezy.com/its CDN,
  // Adobe Stock's actual image-serving CDN (stock.adobe.com is their site, ftcdn.net is where the
  // images themselves are hosted), and Unsplash's PAID tier specifically (plain unsplash.com is
  // free/properly licensed and fine to use, plus.unsplash.com is a paid marketplace we have no
  // rights to redistribute from).
  'vecteezy.com',
  'ftcdn.net',
  'plus.unsplash.com',
]

function isStockPhotoHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return STOCK_PHOTO_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/** A flat-color 1x1 SVG data URI -- used as a clean fallback (`background-image`/`<img src>`
 * both accept it) when photo sourcing genuinely can't find a usable image, so a slide ships with
 * a plain brand-color circle/panel instead of a broken or literal-unresolved-placeholder image. */
export function solidColorPlaceholder(hexColor: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='${hexColor}'/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
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
  if (look === 'Plain Text' || look === 'Bold Hook') return 0
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

type UsablePhoto = { url: string; buffer: Buffer; width: number; height: number }

// image-size's `type` field ('jpg'/'png'/'webp'/'gif') doesn't line up 1:1 with Anthropic's
// media_type strings -- only the 'jpg'->'image/jpeg' name actually differs, everything else is
// just prefixing. Unrecognized/undetected types skip the vision check (see photoLooksUsable's
// caller) rather than guessing a media_type that would make the API call fail outright.
const MEDIA_TYPE_FOR: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** Real complaint found live (2026-07-21, Wagyu carousel slide 2): a photo can pass every
 * mechanical check here (right dimensions, real URL, not a stock marketplace) and still look bad
 * on the actual slide -- too dark, or the subject too small/cropped-off to read as the photo's
 * point. No pixel-math heuristic reliably catches that (a legitimately moody product shot and a
 * genuinely dead/empty photo can have similar average brightness); reusing the same cheap-model
 * vision-check idiom pipeline.ts's visionReview already uses for a whole rendered slide is more
 * consistent with how this codebase already handles "does this look right" judgment calls than
 * inventing a new deterministic formula. Runs once per candidate that already passed the
 * mechanical checks, not per every URL tried -- cheap tier (Haiku), same as classifyEdit. */
async function photoLooksUsable(buffer: Buffer, mediaType: string): Promise<boolean> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 60,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: buffer.toString('base64') } },
          {
            type: 'text',
            text: 'This photo is meant to be the hero image on a social carousel slide -- the main subject should be clearly visible, reasonably well-lit, and fill a good portion of the frame. Reply with exactly "OK" if it works for that, or a short reason if it does not (too dark, subject too small/cropped, mostly empty background, etc).',
          },
        ],
      },
    ],
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text.trim() ?? ''
  return text.toUpperCase().startsWith('OK')
}

/** Fetches and validates a single image URL directly (dimension check + stock-domain check +
 * a vision quality check) -- shared by both the direct image-search path and the og:image-scrape
 * fallback below, so the same safety checks apply regardless of which path found the URL. */
async function fetchAndValidateImage(imgUrl: string): Promise<UsablePhoto | null> {
  if (!isSafeHttpUrl(imgUrl)) return null
  if (isStockPhotoHost(imgUrl)) return null

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
    const { width, height, type } = imageSize(buffer)
    if (!width || !height || width < MIN_DIMENSION || height < MIN_DIMENSION) return null

    // Skip the vision check if the format isn't one we can safely hand to the API -- a mechanical
    // dimension pass without a visual-quality pass beats rejecting a perfectly usable photo over
    // an unrecognized format string.
    const mediaType = type ? MEDIA_TYPE_FOR[type] : undefined
    if (mediaType) {
      const usable = await photoLooksUsable(buffer, mediaType).catch(() => true) // fail open -- an API hiccup shouldn't sink an otherwise-valid photo
      if (!usable) return null
    }

    // Return the ORIGINAL image URL, not a re-hosted copy -- the render step (Cloudflare's
    // browser) fetches it live at screenshot time same as any real browser would, no need to
    // download-then-reupload through our own Storage first. `buffer`/dimensions are only needed
    // transiently for this guardrail check.
    return { url: imgUrl, buffer, width, height }
  } catch {
    return null // downloaded file isn't a valid/decodable image
  }
}

/**
 * Direct port of .claude/skills/carousel/scripts/fetch_og_image.py -- pulls a page's og:image
 * meta tag (no API key needed, works because most photo/content pages set it server-side for
 * link-preview crawlers). Returns null on any failure so the caller can just try the next
 * candidate URL, matching the skill's own "first one that succeeds, don't chase perfection" rule.
 * Kept as a fallback tier (2026-07-21) -- `findUsablePhoto` below tries real image search first.
 */
export async function fetchOgImage(pageUrl: string): Promise<UsablePhoto | null> {
  if (!isSafeHttpUrl(pageUrl)) return null
  if (isStockPhotoHost(pageUrl)) return null

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
  return fetchAndValidateImage(match[1])
}

/** Tries each candidate page URL in order, returns the first usable photo. */
async function firstUsablePhotoFromPages(candidateUrls: string[]): Promise<UsablePhoto | null> {
  for (const url of candidateUrls) {
    const result = await fetchOgImage(url)
    if (result) return result
  }
  return null
}

/**
 * Primary photo-sourcing entrypoint, three tiers in priority order (2026-07-21):
 *
 * 1. Pexels -- a curated free-to-use photo library, tried FIRST. Real data found live: Tavily's
 *    own image search returns mostly stock-photo-marketplace previews (already blocklisted) for
 *    generic aesthetic briefs like "raw wagyu steak marbling close-up photo" -- exactly what
 *    captions.ts generates most often. Pexels is built for this exact query shape and requires no
 *    attribution, so it's the highest-hit-rate, cleanest-licensed source for the common case.
 * 2. Tavily image search -- real data found live: for LITERAL/branded/retail queries (e.g.
 *    "grocery store ground beef package photo") this actually outperforms Pexels, returning real
 *    photos from the retailer's/brand's own site (Kroger, Meijer, a real ranch's Shopify CDN) --
 *    kept as tier 2 for exactly that case, not discarded.
 * 3. Tavily page-search + og:image scrape -- the original approach, ~50% hit rate alone but still
 *    a real working fallback when both of the above come up empty.
 *
 * All three share the same dimension + stock-domain validation via fetchAndValidateImage.
 */
export async function findUsablePhoto(photoBrief: string): Promise<UsablePhoto | null> {
  const query = `${photoBrief} photo`

  const pexelsUrls = await pexelsSearch(query)
  for (const url of pexelsUrls) {
    const result = await fetchAndValidateImage(url)
    if (result) return result
  }

  const images = await tavilyImageSearch(query)
  for (const image of images) {
    const result = await fetchAndValidateImage(image.url)
    if (result) return result
  }

  const candidatePages = await tavilyCandidateUrls(query)
  return firstUsablePhotoFromPages(candidatePages)
}
