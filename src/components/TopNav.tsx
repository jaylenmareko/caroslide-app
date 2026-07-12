'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function TopNav({
  name,
  email,
}: {
  name: string
  email: string
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="app-nav">
      <Link href="/dashboard" className="brand" aria-label="Caroslide home">
        <span>Caroslide</span>
      </Link>

      <div className="nav-right">
        <div className="avatar-wrap" ref={menuRef}>
          <button
            className="avatar-btn"
            aria-label="Account menu"
            onClick={() => setOpen((v) => !v)}
          >
            <div className="avatar">{initials || 'U'}</div>
          </button>
          <div className={`avatar-menu${open ? ' show' : ''}`}>
            <div className="avatar-menu-user">
              <div className="name">{name}</div>
              <div className="email">{email}</div>
            </div>
            <div className="avatar-menu-divider" />
            <Link href="/settings" className="avatar-menu-item" onClick={() => setOpen(false)}>
              Settings
            </Link>
            <div className="avatar-menu-divider" />
            <button className="avatar-menu-item danger" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
