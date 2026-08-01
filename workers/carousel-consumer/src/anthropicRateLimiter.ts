// Real, cross-instance rate limiter for Anthropic API calls -- see anthropicLimiter.ts's own
// comment (src/backend/lib/generation/) for why a token-bucket, not a plain semaphore, is the right
// mechanism here: Anthropic's real limit (confirmed live via the API's own rate-limit response
// headers, 2026-08-01) is a rolling PER-MINUTE budget (5,000 requests, 5M input tokens, 1M output
// tokens, 6M total tokens -- identical across every model this app calls, so treated as one shared
// org-wide pool), not a simultaneous-call cap the way Cloudflare Browser Rendering is.
//
// Budgeted at ~70% of the real measured ceiling, not the full number -- leaves real headroom for
// (1) this being an org-wide pool that other Anthropic-using products under the same account may
// also draw from (not confirmed to be Caroslide-exclusive), and (2) the estimate-then-true-up
// accounting below being approximate -- an in-flight call's real usage isn't known until it returns.
import type { DurableObjectNamespaceLike } from './renderSemaphore'

const WINDOW_MS = 60_000
const REQUEST_BUDGET = 3500
const INPUT_TOKEN_BUDGET = 3_500_000
const OUTPUT_TOKEN_BUDGET = 700_000
const TOTAL_TOKEN_BUDGET = 4_200_000

type AcquireBody = { estimatedInputTokens?: number; estimatedOutputTokens?: number }
type TrueUpBody = {
  windowStart?: number
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
  actualInputTokens?: number
  actualOutputTokens?: number
}

export class AnthropicRateLimiter {
  windowStart: number
  requests: number
  inputTokens: number
  outputTokens: number

  constructor() {
    this.windowStart = Date.now()
    this.requests = 0
    this.inputTokens = 0
    this.outputTokens = 0
  }

  private rollWindowIfNeeded() {
    const now = Date.now()
    if (now - this.windowStart >= WINDOW_MS) {
      this.windowStart = now
      this.requests = 0
      this.inputTokens = 0
      this.outputTokens = 0
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

    if (url.pathname === '/acquire') {
      const body = (await request.json().catch(() => ({}))) as AcquireBody
      this.rollWindowIfNeeded()
      const estInput = body.estimatedInputTokens ?? 0
      const estOutput = body.estimatedOutputTokens ?? 0
      const wouldExceed =
        this.requests + 1 > REQUEST_BUDGET ||
        this.inputTokens + estInput > INPUT_TOKEN_BUDGET ||
        this.outputTokens + estOutput > OUTPUT_TOKEN_BUDGET ||
        this.inputTokens + this.outputTokens + estInput + estOutput > TOTAL_TOKEN_BUDGET
      if (wouldExceed) return json({ granted: false })
      this.requests += 1
      this.inputTokens += estInput
      this.outputTokens += estOutput
      return json({ granted: true, windowStart: this.windowStart })
    }

    if (url.pathname === '/true-up') {
      const body = (await request.json().catch(() => ({}))) as TrueUpBody
      // Only correct the window this reservation was actually made against -- if the window has
      // since rolled over, that budget is already gone/reset and nobody benefits from touching it.
      if (body.windowStart === this.windowStart) {
        const estInput = body.estimatedInputTokens ?? 0
        const estOutput = body.estimatedOutputTokens ?? 0
        this.inputTokens = Math.max(0, this.inputTokens + (body.actualInputTokens ?? estInput) - estInput)
        this.outputTokens = Math.max(0, this.outputTokens + (body.actualOutputTokens ?? estOutput) - estOutput)
      }
      return json({ ok: true })
    }

    return new Response('Not found', { status: 404 })
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Builds an anthropicLimiter.ts-compatible AnthropicLimiter (structurally -- no cross-import, same
 * decoupling reasoning as renderSemaphore.ts) backed by this Durable Object -- a real global
 * per-minute token/request budget across every concurrent consumer instance AND, cross-worker, the
 * main caroslide-app Worker's own server actions (see caroslide-app's wrangler.jsonc for the
 * cross-script binding), not just an in-process guess. Poll-based acquire, same reasoning as
 * renderSemaphore.ts's lease acquire: a busy system should queue behind the real Anthropic budget,
 * not blow past it and eat 429s. */
export function createDurableObjectTokenLimiter(namespace: DurableObjectNamespaceLike) {
  const stub = namespace.get(namespace.idFromName('singleton'))

  // Generic over T (not fixed to Anthropic.Message) so this structurally satisfies
  // src/backend/lib/generation/anthropicLimiter.ts's AnthropicLimiter type at every real call
  // site (which all pass a real `anthropic.messages.create()` call, returning the SDK's actual
  // Message type) without this file needing to import that SDK type itself.
  return async function limit<T extends { usage?: { input_tokens: number; output_tokens: number } }>(
    estimate: { inputTokens: number; outputTokens: number },
    fn: () => Promise<T>
  ): Promise<T> {
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
