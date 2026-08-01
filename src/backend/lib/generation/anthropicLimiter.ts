import type Anthropic from '@anthropic-ai/sdk'

/**
 * Real, cross-instance rate limiter for direct Anthropic API calls -- the Claude-call equivalent of
 * render.ts's render-concurrency Limiter (renderSemaphore.ts). A single carousel generation fires
 * 15-20+ real Claude calls across captions.ts/images.ts/edit.ts/pipeline.ts (per-slide caption
 * writing, photo-quality vision checks, guardrail repairs, vision review) with zero cross-instance
 * coordination today -- at real concurrent-user volume this bursts well past the account's actual
 * per-minute budget, the same problem the render semaphore already closed for Cloudflare Browser
 * Rendering (2026-07-31).
 *
 * Unlike Browser Rendering's simultaneous-call cap, Anthropic's real limit (confirmed live via the
 * API's own rate-limit response headers, 2026-08-01: 5,000 requests/min, 5M input tokens/min, 1M
 * output tokens/min, 6M total tokens/min -- identical across claude-haiku-4-5/claude-opus-4-8/
 * claude-sonnet-5, so treated as one shared org-wide pool, not per-model) is a rolling PER-MINUTE
 * BUDGET -- this needs token-bucket admission control, not a plain semaphore. See
 * workers/carousel-consumer/src/anthropicRateLimiter.ts for the real Durable-Object-backed
 * implementation; this file just defines the shared shape every generation/ call site wraps its own
 * `anthropic.messages.create()` call with.
 *
 * `estimate` is a rough, per-call-site guess (input tokens from that call's known prompt shape,
 * output tokens from that call's own max_tokens/typical real usage) used for up-front admission --
 * the real implementation trues this up against the response's own actual `.usage` after the call
 * completes, so a pessimistic estimate never permanently wastes budget.
 */
export type AnthropicLimiter = (
  estimate: { inputTokens: number; outputTokens: number },
  fn: () => Promise<Anthropic.Message>
) => Promise<Anthropic.Message>

export const NO_TOKEN_LIMIT: AnthropicLimiter = (_estimate, fn) => fn()

// Deliberately NOT imported from workers/carousel-consumer/src/anthropicRateLimiter.ts -- that file
// (and its own DurableObjectNamespaceLike type) belongs to a completely separate Worker build
// (plain wrangler/esbuild, no Next.js), the same reason renderSemaphore.ts defines its own local
// structural type instead of importing anything from this Next.js app. This app's Server Actions
// (actions.ts's createCarousel/editSlide) need their OWN thin client for the exact same real
// cross-script Durable Object (see caroslide-app's wrangler.jsonc binding), so the small
// acquire/true-up polling logic is intentionally duplicated here rather than reaching across that
// app/Worker boundary -- a real, established precedent in this codebase, not an oversight.
type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Builds a real AnthropicLimiter backed by the AnthropicRateLimiter Durable Object (defined and
 * owned by workers/carousel-consumer, bound cross-script here -- see wrangler.jsonc) -- for use by
 * this app's own Server Actions, which spend from the exact same account-wide Anthropic budget the
 * Queue consumer's initial-generation calls do (chat-edit classification/rewrites, editSlide's
 * photo-swap/color/font edits). Same poll-based acquire-then-true-up shape as the consumer's own
 * client (anthropicRateLimiter.ts) -- a busy system should queue behind the real Anthropic budget,
 * not blow past it and eat 429s. */
export function createDurableObjectTokenLimiter(namespace: DurableObjectNamespaceLike): AnthropicLimiter {
  const stub = namespace.get(namespace.idFromName('singleton'))

  return async function limit(estimate, fn) {
    let windowStart: number | undefined
    while (true) {
      const res = await stub.fetch('http://anthropic-limiter/acquire', {
        method: 'POST',
        body: JSON.stringify({ estimatedInputTokens: estimate.inputTokens, estimatedOutputTokens: estimate.outputTokens }),
      })
      const data = (await res.json()) as { granted: boolean; windowStart?: number }
      if (data.granted) {
        windowStart = data.windowStart
        break
      }
      await sleep(300 + Math.random() * 400)
    }
    const result = await fn()
    await stub
      .fetch('http://anthropic-limiter/true-up', {
        method: 'POST',
        body: JSON.stringify({
          windowStart,
          estimatedInputTokens: estimate.inputTokens,
          estimatedOutputTokens: estimate.outputTokens,
          actualInputTokens: result.usage?.input_tokens,
          actualOutputTokens: result.usage?.output_tokens,
        }),
      })
      .catch(() => {})
    return result
  }
}
