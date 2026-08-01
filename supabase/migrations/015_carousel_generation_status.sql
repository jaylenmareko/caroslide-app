-- Real bug found live (2026-07-31): a real carousel generation can legitimately take 2-3 minutes
-- (5 slides, each with its own Cloudflare Browser Rendering render + guardrail-repair retries --
-- and a 429 backoff alone can wait up to 90s per retry, see render.ts). createCarousel used to hold
-- ONE HTTP request open for the whole pipeline before ever responding -- Cloudflare's edge proxy
-- kills a request that goes quiet too long (the well-known ~100s "524" ceiling for waiting on any
-- byte of a response), so a slow-but-otherwise-healthy generation could get its connection cut
-- mid-flight. The user just saw the page bounce with no real error.
--
-- Fix (actions.ts): createCarousel now inserts a placeholder row immediately (status='generating',
-- slides=[]) and redirects to it right away; the real generation work runs after the response is
-- sent via Cloudflare's ctx.waitUntil(), writing the finished slides back in a second update once
-- done. The carousel page polls this status and shows a real "this takes 2-3 minutes" state in the
-- meantime instead of leaving the browser waiting on one giant request.
alter table public.carousels
  add column status text not null default 'ready' check (status in ('generating', 'ready', 'failed')),
  add column error_message text;
