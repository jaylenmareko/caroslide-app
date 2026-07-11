'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Carousel } from '@/lib/types'
import { updateCarouselTitle } from '@/lib/actions'

export default function Viewer({ carousel }: { carousel: Carousel }) {
  const [current, setCurrent] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(carousel.title)
  const [hasEditedTitle, setHasEditedTitle] = useState(false)

  const slides = carousel.slides

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function commitTitle() {
    setEditingTitle(false)
    const trimmed = title.trim()
    if (trimmed && trimmed !== carousel.title) {
      updateCarouselTitle(carousel.id, trimmed)
    } else {
      setTitle(carousel.title)
    }
  }

  return (
    <section className="viewer-section wrap">
      <div className="viewer-topbar">
        <Link href="/dashboard" className="viewer-back">
          ‹ <span className="lbl">My Carousels</span>
        </Link>
        <div className="viewer-title-wrap">
          {editingTitle ? (
            <div className="viewer-title">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </div>
          ) : (
            <div
              className="viewer-title"
              onClick={() => {
                setEditingTitle(true)
                setHasEditedTitle(true)
              }}
            >
              {title}
            </div>
          )}
          {!hasEditedTitle && <div className="viewer-title-hint">Tap to change name</div>}
          <div className="viewer-count">
            Slide {current + 1} of {slides.length}
          </div>
        </div>
        <button className="download-btn">⬇ Download</button>
      </div>

      <div className="viewer-body">
        <div className="thumb-rail">
          {slides.map((s, i) => (
            <div
              key={i}
              className={`thumb-item${i === current ? ' active' : ''}`}
              onClick={() => setCurrent(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={`Slide ${i + 1}`} />
              <span className="num">{i + 1}</span>
            </div>
          ))}
        </div>

        <div className="canvas-col">
          <div className="canvas-mat">
            <div className="stage">
              <button className="stage-frame" onClick={() => setLightboxOpen(true)} aria-label="Zoom slide">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slides[current]?.url} alt="Carousel slide" />
              </button>
              <button
                className="stage-arrow stage-prev"
                aria-label="Previous"
                onClick={() => setCurrent((c) => (c - 1 + slides.length) % slides.length)}
              >
                ‹
              </button>
              <button
                className="stage-arrow stage-next"
                aria-label="Next"
                onClick={() => setCurrent((c) => (c + 1) % slides.length)}
              >
                ›
              </button>
            </div>
          </div>

          <div className="chat-box">
            <input type="text" placeholder="e.g. slide 3: punchier hook, swap the CTA…" />
            <button aria-label="Send">
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <p className="chat-hint">
            Say which slide(s) you mean (e.g. &quot;slide 2&quot; or &quot;the last two&quot;) — this edits the draft in place, it won&apos;t start a new project.
          </p>
        </div>
      </div>

      <div className={`lightbox${lightboxOpen ? ' show' : ''}`} onClick={() => setLightboxOpen(false)}>
        <button className="lightbox-close" aria-label="Close" onClick={() => setLightboxOpen(false)}>
          ×
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slides[current]?.url} alt="Carousel slide, enlarged" />
      </div>
    </section>
  )
}
