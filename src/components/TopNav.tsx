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
        <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg">
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
