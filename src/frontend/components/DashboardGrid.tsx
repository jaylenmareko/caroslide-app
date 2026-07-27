'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Carousel } from '@/backend/lib/types'
import { timeAgo } from '@/backend/lib/types'
import { deleteCarousel } from '@/backend/lib/actions'

type DashboardCarousel = Pick<Carousel, 'id' | 'title' | 'angle' | 'format' | 'updated_at' | 'slides'>

export default function DashboardGrid({ carousels: initialCarousels }: { carousels: DashboardCarousel[] }) {
  const [carousels, setCarousels] = useState(initialCarousels)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDeleteClick(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (confirmingId !== id) {
      setConfirmingId(id)
      return
    }
    const index = carousels.findIndex((c) => c.id === id)
    const removed = carousels[index]
    setCarousels((prev) => prev.filter((c) => c.id !== id))
    setConfirmingId(null)
    setDeleteError(null)
    try {
      await deleteCarousel(id)
    } catch {
      setCarousels((prev) => [...prev.slice(0, index), removed, ...prev.slice(index)])
      setDeleteError('Couldn\'t delete that carousel — try again.')
    }
  }

  return (
    <section className="dash-section wrap">
      <div className="dash-head">
        <h1>My Carousels</h1>
      </div>
      {deleteError && <p className="dash-delete-error">{deleteError}</p>}
      <div className="dash-grid">
        <Link href="/new" className="dash-card new-card">
          <div className="thumb new-card-thumb">
            <div className="plus">+</div>
          </div>
          <div className="meta">
            <div className="k">New Carousel</div>
            <div className="t">Start from scratch</div>
          </div>
        </Link>

        {carousels.map((c, i) => (
          <div
            key={c.id}
            className="dash-card"
            onMouseLeave={() => confirmingId === c.id && setConfirmingId(null)}
          >
            <button
              className={`dash-card-delete${confirmingId === c.id ? ' confirming' : ''}`}
              aria-label={confirmingId === c.id ? 'Confirm delete' : 'Delete carousel'}
              title={confirmingId === c.id ? 'Click again to delete' : 'Delete'}
              onClick={(e) => handleDeleteClick(e, c.id)}
            >
              {confirmingId === c.id ? (
                'Delete?'
              ) : (
                <svg viewBox="0 0 24 24" width={15} height={15} fill="none">
                  <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-.8 12.1a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <Link href={`/carousel/${c.id}`} className="dash-card-link">
              <div className="thumb">
                {c.slides[0]?.url && (
                  <Image
                    src={c.slides[0].url}
                    alt=""
                    fill
                    sizes="(max-width: 700px) 45vw, 220px"
                    style={{ objectFit: 'cover' }}
                    // Real ask (2026-07-22, Jaylen): cards shouldn't visibly "load in" -- priority
                    // skips next/image's default lazy-loading (which waits for an
                    // IntersectionObserver check before even starting the fetch) and adds a
                    // <link rel="preload"> so the browser starts fetching immediately on page
                    // load. Capped to the first 8 -- roughly the first couple of rows on a normal
                    // screen -- so a long list doesn't force-eager-load everything and compete for
                    // bandwidth; cards past that still benefit from the smaller optimized size
                    // from the earlier fix, just not force-prioritized.
                    priority={i < 8}
                  />
                )}
              </div>
              <div className="meta">
                <div className="k">{c.title}</div>
                <div className="dash-card-tags">
                  <span className="dash-tag">{c.angle}</span>
                  <span className="dash-tag neutral">{c.format}</span>
                </div>
                <div className="t">{timeAgo(c.updated_at)}</div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
