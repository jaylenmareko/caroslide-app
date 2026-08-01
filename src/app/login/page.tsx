'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/backend/lib/supabase/client'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
        }
      ) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>(
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  )
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'confirm_failed'
      ? 'That confirmation link is invalid or expired. Please sign up again.'
      : null
  )
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [turnstileReady, setTurnstileReady] = useState(false)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetId = useRef<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!turnstileReady || !turnstileContainerRef.current) return
    if (!window.turnstile || !TURNSTILE_SITE_KEY) return

    turnstileWidgetId.current = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => setCaptchaToken(token),
      'error-callback': () => setCaptchaToken(null),
      'expired-callback': () => setCaptchaToken(null),
    })

    return () => {
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current)
        turnstileWidgetId.current = null
      }
    }
    // mode is a dep (not just used inside) because switching signin<->signup remounts the
    // container via React's `key={mode}` on the wrapping div -- the old widget's DOM node is gone,
    // so it must be re-rendered into the new one, not just left pointing at a stale ref.
  }, [mode, turnstileReady])

  const topic = searchParams.get('topic')
  const postAuthDest = topic ? `/new?topic=${encodeURIComponent(topic)}` : '/dashboard'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()

    if (mode === 'signup') {
      const confirmUrl = new URL('/auth/confirm', window.location.origin)
      // Always set at least one param so the confirm-signup email template (which appends
      // &token_hash=...&type=signup to {{ .RedirectTo }}) never has to guess whether to use
      // "?" or "&" -- it always has this to safely append onto.
      confirmUrl.searchParams.set('src', 'email')
      if (topic) confirmUrl.searchParams.set('topic', topic)

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: confirmUrl.toString(),
          captchaToken: captchaToken ?? undefined,
        },
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        setCaptchaToken(null)
        if (turnstileWidgetId.current && window.turnstile) {
          window.turnstile.reset(turnstileWidgetId.current)
        }
        return
      }
      if (!data.session) {
        // Email confirmation is required — no session yet, nothing to redirect to.
        setConfirmSent(true)
        setLoading(false)
        return
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken: captchaToken ?? undefined },
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        setCaptchaToken(null)
        if (turnstileWidgetId.current && window.turnstile) {
          window.turnstile.reset(turnstileWidgetId.current)
        }
        return
      }
    }

    router.push(postAuthDest)
    router.refresh()
  }

  if (confirmSent) {
    return (
      <div className="auth-wrap">
        <Link href="/" className="auth-top-brand">
          <span>Caroslide</span>
        </Link>
        <div className="auth-card">
          <h1>Check your email</h1>
          <p className="sub">
            We sent a confirmation link to <b>{email}</b>. Click it, then come back and sign in.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setTurnstileReady(true)}
      />
      <Link href="/" className="auth-top-brand">
        <span>Caroslide</span>
      </Link>
      <div className="auth-card">
        <div key={mode} className="auth-mode-fade">
          <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="sub">
            {mode === 'signin'
              ? 'Sign in to keep making carousels.'
              : 'Get five ready-to-post slides in minutes.'}
          </p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div className="auth-field">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {/* Supabase's CAPTCHA protection gates both the signup and password sign-in
                endpoints identically (it's a single Attack Protection toggle, not per-endpoint) --
                the widget has to render for both modes, or sign-in fails server-side with
                captcha_failed even though the client never told the user anything was wrong. */}
            <div className="auth-field" ref={turnstileContainerRef} />
            <button
              className="auth-submit"
              type="submit"
              disabled={loading || !captchaToken}
            >
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          </form>

          <div className="auth-switch">
            {mode === 'signin' ? (
              <>
                New here?{' '}
                <button type="button" onClick={() => setMode('signup')}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => setMode('signin')}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
