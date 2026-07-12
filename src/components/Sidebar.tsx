'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none">
        <path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-5H4v5ZM14 4v5h6V4h-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H4a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 5.6 9.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10a1.65 1.65 0 0 0 1-1.51V4a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V10c.63.24 1.4.74 1.51 1.4.09.34 0 .69 0 1.03Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
]

export default function Sidebar({
  name,
  email,
}: {
  name: string
  email: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

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
    <>
      <header className="app-mobile-bar">
        <Link href="/dashboard" className="brand" aria-label="Caroslide home">
          <span>Caroslide</span>
        </Link>
        <button
          className="app-mobile-toggle"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width={22} height={22} fill="none">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {mobileOpen && <div className="app-sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <aside className={`app-sidebar${mobileOpen ? ' open' : ''}`}>
        <Link href="/dashboard" className="brand sidebar-brand" aria-label="Caroslide home">
          <span>Caroslide</span>
        </Link>

        <Link href="/new" className="sidebar-new-btn">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          New Carousel
        </Link>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-nav-item${active ? ' active' : ''}`}
              >
                {item.icon}
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="sidebar-bottom" ref={menuRef}>
          <button
            className="sidebar-profile"
            aria-label="Account menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <div className="avatar">{initials || 'U'}</div>
            <div className="sidebar-profile-text">
              <div className="name">{name}</div>
              <div className="email">{email}</div>
            </div>
          </button>
          <div className={`avatar-menu sidebar-menu${menuOpen ? ' show' : ''}`}>
            <Link href="/settings" className="avatar-menu-item" onClick={() => setMenuOpen(false)}>
              Settings
            </Link>
            <div className="avatar-menu-divider" />
            <button className="avatar-menu-item danger" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
