// Cloudflare Queue consumer -- the real carousel generation work. See wrangler.jsonc's own
// top-of-file comment for why this lives in a separate Worker instead of the main caroslide-app
// Worker's ctx.waitUntil().
//
// Reuses caroslide-app's own generation code directly (relative import reaching into the main
// app's src tree, not a copy) -- everything under src/backend/lib/generation/ only ever imports
// from itself via relative paths or real npm packages (never the Next.js `@/` alias), so it
// bundles cleanly here via wrangler's own esbuild exactly like it does inside the Next.js app.
import { runCarouselGeneration, type CarouselGenerationJob } from '../../../src/backend/lib/generation/runGeneration'
import { RenderSemaphore, createDurableObjectLimiter, type DurableObjectNamespaceLike } from './renderSemaphore'
import { AnthropicRateLimiter, createDurableObjectTokenLimiter } from './anthropicRateLimiter'

// Durable Object classes must be exported from the Worker's main module for wrangler to find them
// (see wrangler.jsonc's durable_objects binding + migration).
export { RenderSemaphore, AnthropicRateLimiter }

type Env = {
  ANTHROPIC_API_KEY: string
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_API_TOKEN: string
  TAVILY_API_KEY: string
  PEXELS_API_KEY: string
  NEXT_PUBLIC_SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  RENDER_SEMAPHORE: DurableObjectNamespaceLike
  ANTHROPIC_LIMITER: DurableObjectNamespaceLike
}

// The shared generation code (render.ts, captions.ts, images.ts, runGeneration.ts's own
// createServiceClient) reads its config via plain `process.env.X` -- written that way since it's
// normally run inside the Next.js app, where OpenNext/Wrangler already populate `process.env` from
// the Worker's bindings. This Worker has no such wiring by default, so each invocation copies the
// real bindings onto `process.env` itself before calling into any shared code.
function hydrateProcessEnv(env: Env) {
  process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
  process.env.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID
  process.env.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN
  process.env.TAVILY_API_KEY = env.TAVILY_API_KEY
  process.env.PEXELS_API_KEY = env.PEXELS_API_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
  process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY
}

export default {
  async queue(batch: { messages: { body: CarouselGenerationJob }[] }, env: Env): Promise<void> {
    hydrateProcessEnv(env)
    // Real, cross-instance render concurrency cap (2026-07-31, Jaylen: "make sure the site is
    // ready for 1 user or 10k users at once") -- see renderSemaphore.ts's own comment for why the
    // old in-process limiter wasn't enough once generation started running as a Queue consumer
    // (many parallel instances under load, each with its own independent copy of that limiter).
    const renderLimiter = createDurableObjectLimiter(env.RENDER_SEMAPHORE)
    // Real, cross-instance Anthropic token-bucket limiter (2026-08-01) -- same reasoning as
    // renderLimiter above, applied to the 15-20+ real Claude calls a single generation fires (see
    // anthropicRateLimiter.ts's own comment). Also shared with caroslide-app's own Server Actions
    // (chat-edit calls) via that app's cross-script binding to this same Durable Object class.
    const anthropicLimiter = createDurableObjectTokenLimiter(env.ANTHROPIC_LIMITER)
    for (const message of batch.messages) {
      // runCarouselGeneration never rethrows (it catches internally and marks the carousel row
      // 'failed' with a real error message) -- a genuinely unexpected crash outside that try/catch
      // is the only thing that would trigger this queue's own retry (max_retries: 2).
      await runCarouselGeneration(message.body, renderLimiter, anthropicLimiter)
    }
  },
}
