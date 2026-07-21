// Replaces Anthropic's server-side web_search tool for this app. That tool was causing Opus to
// invoke an ungranted code_execution tool (triggering a safety-classifier refusal) when attached
// to the caption-writing call -- see session log 2026-07-20. Tavily is called directly via a
// plain HTTP request, outside of Anthropic's tool-use mechanism entirely, so the model that
// writes captions gets zero tools and can't misuse one.

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

/** Just the candidate page URLs, for the photo-sourcing use case (see images.ts). */
export async function tavilyCandidateUrls(query: string, maxResults = 3): Promise<string[]> {
  const result = await tavilySearch(query, maxResults)
  return result?.sources.map((s) => s.url) ?? []
}
