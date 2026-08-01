// Minimal, hand-written augmentation of `@opennextjs/cloudflare`'s ambient `CloudflareEnv`
// interface for the one binding actions.ts actually needs (see wrangler.jsonc's queues.producers).
// Deliberately NOT using `wrangler types` (which generates a full ambient override of `fetch`/
// `Response` etc. via @cloudflare/workers-types) -- that broke an unrelated file's typing
// (research.ts's `await res.json()` typed as `unknown` instead of `any`) project-wide the one time
// it was tried. A narrow structural type for just what's actually called (`.send()`) avoids that
// blast radius entirely.
export {}

declare global {
  interface CloudflareEnv {
    CAROUSEL_QUEUE: { send(message: import('./generation/runGeneration').CarouselGenerationJob): Promise<void> }
  }
}
