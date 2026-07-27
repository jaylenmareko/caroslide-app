// Tavily replaces Anthropic's server-side web_search tool for this app. That tool was causing
// Opus to invoke an ungranted code_execution tool (triggering a safety-classifier refusal) when
// attached to the caption-writing call -- see session log 2026-07-20. Tavily is called directly
// via a plain HTTP request, outside of Anthropic's tool-use mechanism entirely, so the model that
// writes captions gets zero tools and can't misuse one. Pexels (below) is a separate, later
// addition (2026-07-21) -- the actual photo source, not research.

export type TavilyResult = {
  answer: string | null
  sources: { url: string; title: string; content: string }[]
}

/**
 * Real web research via Tavily's REST API (no SDK needed, one POST request). Returns a
 * synthesized answer plus the top source snippets, or null on any failure -- callers should
 * proceed without research rather than fail the whole generation over a research-step outage.
 */
export async function tavilySearch(query: string, maxResults = 5): Promise<TavilyResult | null> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null

    const data = await res.json()
    return {
      answer: typeof data.answer === 'string' ? data.answer : null,
      sources: Array.isArray(data.results)
        ? data.results.map((r: { url: string; title: string; content: string }) => ({
            url: r.url,
            title: r.title,
            content: r.content,
          }))
        : [],
    }
  } catch {
    return null
  }
}

/** Just the candidate page URLs, for the photo-sourcing use case (see images.ts). Kept as a
 * fallback tier -- `tavilyImageSearch` below is the primary photo source now (2026-07-21). */
export async function tavilyCandidateUrls(query: string, maxResults = 3): Promise<string[]> {
  const result = await tavilySearch(query, maxResults)
  return result?.sources.map((s) => s.url) ?? []
}

export type TavilyImage = { url: string; description: string | null }

/**
 * Real image search via Tavily's `include_images` mode (confirmed against Tavily's own API docs
 * 2026-07-21, not guessed) -- returns actual image URLs matched to the query directly, distinct
 * from `tavilySearch`'s page results. Replaces the old approach of finding candidate PAGES and
 * hoping one happens to have a decent `og:image` (a generic webpage-search feature repurposed for
 * photo-finding, measured at ~50% hit rate) with an image-search-specific API call.
 */
export async function tavilyImageSearch(query: string, maxResults = 5): Promise<TavilyImage[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        include_answer: false,
        include_images: true,
        include_image_descriptions: true,
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []

    const data = await res.json()
    return Array.isArray(data.images)
      ? data.images.map((img: { url: string; description?: string }) => ({
          url: img.url,
          description: img.description ?? null,
        }))
      : []
  } catch {
    return []
  }
}

/**
 * Real photo source via Pexels' search API (confirmed against Pexels' own API/license docs
 * 2026-07-21, not guessed) -- a curated free-to-use photo library, not a general web/image search.
 * Added after finding Tavily's own image search returns mostly stock-photo-marketplace previews
 * (Shutterstock/Dreamstime/123rf/etc., all already blocklisted) for generic aesthetic photo
 * briefs -- exactly the kind of query captions.ts generates most often. Pexels' actual content
 * license requires NO attribution (confirmed on pexels.com/license, not just assumed from the API
 * docs' separate "link to Pexels" developer note), so a sourced photo can be used directly in a
 * client's carousel with no visible credit -- important since these are professional client-facing
 * assets, not a hobby blog post.
 */
export async function pexelsSearch(query: string, perPage = 5): Promise<string[]> {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`,
      {
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(15000),
      }
    )
    if (!res.ok) return []

    const data = await res.json()
    return Array.isArray(data.photos)
      ? data.photos
          .map((p: { src?: { large2x?: string } }) => p.src?.large2x)
          .filter((url: string | undefined): url is string => Boolean(url))
      : []
  } catch {
    return []
  }
}
