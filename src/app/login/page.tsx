'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      })
      if (error) {
        setError(error.message)
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

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" width={56} height={56}>
            <line x1="100" y1="26" x2="100" y2="17" stroke="#F1E6D2" strokeWidth="3" />
            <circle cx="100" cy="14" r="5" fill="#F1E6D2" />
            <path d="M100,26 L30,92 Q41.5,104 53,84 L100,26 Z" fill="#F1E6D2" stroke="#16130f" strokeWidth="1.5" strokeOpacity="0.35" />
            <path d="M100,26 L53,84 Q64.5,98 76,79 L100,26 Z" fill="#5B7A5E" />
            <path d="M100,26 L76,79 Q88,95 100,76 L100,26 Z" fill="#F1E6D2" stroke="#16130f" strokeWidth="1.5" strokeOpacity="0.35" />
            <path d="M100,26 L100,76 Q112,95 124,79 L100,26 Z" fill="#5B7A5E" />
            <path d="M100,26 L124,79 Q135.5,98 147,84 L100,26 Z" fill="#F1E6D2" stroke="#16130f" strokeWidth="1.5" strokeOpacity="0.35" />
            <path d="M100,26 L147,84 Q158.5,104 170,92 L100,26 Z" fill="#5B7A5E" />
          </svg>
          <span>Caroslide</span>
        </div>
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
  )
}
