// Minimal, hand-written augmentation of `@opennextjs/cloudflare`'s ambient `CloudflareEnv`
// interface for the bindings actions.ts actually needs (see wrangler.jsonc's queues.producers +
// durable_objects.bindings). Deliberately NOT using `wrangler types` (which generates a full
// ambient override of `fetch`/`Response` etc. via @cloudflare/workers-types) -- that broke an
// unrelated file's typing (research.ts's `await res.json()` typed as `unknown` instead of `any`)
// project-wide the one time it was tried. A narrow structural type for just what's actually called
// (`.send()`, `.idFromName()`/`.get()`) avoids that blast radius entirely.
export {}

declare global {
  interface CloudflareEnv {
    CAROUSEL_QUEUE: { send(message: import('./generation/runGeneration').CarouselGenerationJob): Promise<void> }
    // Cross-script binding to workers/carousel-consumer's AnthropicRateLimiter Durable Object (see
    // wrangler.jsonc's own comment) -- same real, shared, account-wide Anthropic rate budget the
    // Queue consumer's own generation calls coordinate through.
    ANTHROPIC_LIMITER: {
      idFromName(name: string): unknown
      get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> }
    }
  }
}
