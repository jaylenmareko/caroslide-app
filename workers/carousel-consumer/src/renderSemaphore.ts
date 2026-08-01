// Real, cross-instance concurrency cap for Cloudflare Browser Rendering calls. The old limiter
// (pipeline.ts's globalRenderLimit, a plain in-process semaphore) only ever coordinated renders
// within ONE running Worker instance -- Cloudflare Queues can and does spin up many consumer
// instances in parallel under real load (Jaylen, 2026-07-31: "make sure the site is ready for 1
// user or 10k users at once"), each getting its own independent copy of that limiter, so total
// concurrent Browser Rendering calls across every user generating at once could still blow past
// Cloudflare's real account-wide concurrency cap for that API -- the likely actual source of this
// session's repeated 429s, not just heavy same-day testing. A Durable Object is a single,
// globally-consistent point every consumer instance can coordinate through: only one instance of a
// given DO ID ever runs at a time, so its in-memory lease count is a real global count, not a
// per-instance one.
//
// Poll-based acquire, not a blocking call -- callers POST /acquire and get {granted:false} if no
// slot is free, then retry after a short jittered delay. Every granted lease has a real expiry
// (LEASE_DURATION_MS) so a caller that crashes or never releases (the whole Worker instance gets
// killed mid-render) can't permanently leak a slot -- worst case that slot just sits unusable until
// its lease naturally expires, not forever.
// Minimal local shape for the one Durable Object binding this file needs -- deliberately not
// importing @cloudflare/workers-types (its ambient ~global overrides broke an unrelated file's
// typing project-wide the one time this repo tried that, see actions.ts's cloudflare-env.d.ts
// comment); this file only ever calls .idFromName()/.get()/.fetch(), so a narrow structural type
// for just those is enough.
export type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> }
}

// Real measured ceiling for this account (pulled live from Cloudflare's own docs, 2026-08-01,
// Workers Paid plan): 120 concurrent Browser Rendering sessions, 600 REST API requests/min (10/s).
// The original value of 2 here was a guess ("Cloudflare's docs describe browser concurrency limits
// in that range") made before that real number was confirmed -- it left ~98% of the account's real
// capacity unused, which is the actual reason 1000 concurrent users would have queued for hours
// instead of minutes. 20 leaves 6x headroom under the real 120-concurrent ceiling (room for
// Jaylen's own manual testing/other traffic on the same account) and keeps sustained throughput
// well under the 10 req/s REST cap even with retries factored in.
const MAX_CONCURRENT = 20
// Generous on purpose -- covers a render's own retry/backoff cascade (render.ts retries up to 4
// times, a single 429 backoff alone can wait up to 90s) plus the render itself, with real headroom.
const LEASE_DURATION_MS = 8 * 60 * 1000

export class RenderSemaphore {
  leases: Map<string, number> // leaseId -> expiresAt (ms epoch)

  constructor() {
    this.leases = new Map()
  }

  private pruneExpired() {
    const now = Date.now()
    for (const [id, expiresAt] of this.leases) {
      if (expiresAt <= now) this.leases.delete(id)
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const body = (await request.json().catch(() => ({}))) as { leaseId?: string }
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

    if (url.pathname === '/acquire') {
      this.pruneExpired()
      if (this.leases.size >= MAX_CONCURRENT) return json({ granted: false })
      if (!body.leaseId) return json({ granted: false })
      this.leases.set(body.leaseId, Date.now() + LEASE_DURATION_MS)
      return json({ granted: true })
    }

    if (url.pathname === '/release') {
      if (body.leaseId) this.leases.delete(body.leaseId)
      return json({ ok: true })
    }

    return new Response('Not found', { status: 404 })
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Builds a pipeline.ts-compatible Limiter backed by the RenderSemaphore Durable Object -- a real
 * global cap across every concurrent consumer instance, not just this one. Polls /acquire with
 * jittered backoff until a slot frees up (correct under real load: a busy system should queue
 * renders behind the real Cloudflare concurrency cap, not blow past it and eat 429s), always
 * releases in a finally so a thrown render error can't leak the slot. */
export function createDurableObjectLimiter(namespace: DurableObjectNamespaceLike) {
  const stub = namespace.get(namespace.idFromName('singleton'))

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    const leaseId = crypto.randomUUID()
    while (true) {
      const res = await stub.fetch('http://render-semaphore/acquire', {
        method: 'POST',
        body: JSON.stringify({ leaseId }),
      })
      const { granted } = (await res.json()) as { granted: boolean }
      if (granted) break
      await sleep(500 + Math.random() * 500)
    }
    try {
      return await fn()
    } finally {
      await stub
        .fetch('http://render-semaphore/release', { method: 'POST', body: JSON.stringify({ leaseId }) })
        .catch(() => {})
    }
  }
}
