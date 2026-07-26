import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component -- Next disallows setting cookies mid-render, so this
            // is a no-op there. No proxy.ts exists to do it instead (removed 2026-07-26: Next 16's
            // Proxy always runs on the Node.js runtime, which Cloudflare Workers can't run yet) --
            // getUser()'s own refresh-token fallback still returns a valid user for the CURRENT
            // request either way, it just can't persist the refreshed cookie back to the browser
            // from here. Route Handlers and Server Actions CAN set cookies, so any session-refresh
            // that happens to run through one of those paths (e.g. a server action) still persists
            // normally -- only a bare Server Component render can't.
          }
        },
      },
    }
  )
}
