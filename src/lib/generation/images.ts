import { imageSize } from 'image-size'
import Anthropic from '@anthropic-ai/sdk'
import type { TemplateVariant } from '@/lib/types'

const anthropic = new Anthropic()

const MIN_DIMENSION = 400 // reject tiny icons/thumbnails masquerading as og:image

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

/**
 * Direct port of .claude/skills/carousel/scripts/fetch_og_image.py -- pulls a page's og:image
 * meta tag (no API key needed, works because most photo/content pages set it server-side for
 * link-preview crawlers). Returns null on any failure so the caller can just try the next
 * candidate URL, matching the skill's own "first one that succeeds, don't chase perfection" rule.
 */
export async function fetchOgImage(
  pageUrl: string
): Promise<{ url: string; buffer: Buffer; width: number; height: number } | null> {
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
 * photo") via Claude's server-side web_search tool -- a cheap model, capped search count, per
 * initial-generation-behavior.md's cost-bounded pipeline (this is a "find and verify a match"
 * task, not brand-voice judgment, so it doesn't need Opus). Mirrors image-sourcing.md's own
 * guidance: specific, scene-level queries return better candidate pages than abstract topic words.
 */
export async function searchCandidatePhotoUrls(photoBrief: string): Promise<string[]> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    messages: [
      {
        role: 'user',
        content: `Find 2-3 real, direct webpage URLs (stock photo sites, editorial photography, news photo pages -- not random blogs) showing: ${photoBrief}\n\nReply with ONLY the URLs, one per line, nothing else.`,
      },
    ],
  })

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

  return Array.from(text.matchAll(/https?:\/\/\S+/g), (m) => m[0].replace(/[.,)>\]]+$/, ''))
}
