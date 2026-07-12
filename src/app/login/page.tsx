'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      if (!data.session) {
        // Email confirmation is required — no session yet, nothing to redirect to.
        setConfirmSent(true)
        setLoading(false)
        return
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
    }

    router.push('/dashboard')
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
            <button className="auth-submit" type="submit" disabled={loading}>
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
