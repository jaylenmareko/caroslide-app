'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Carousel, Slide } from '@/lib/types'
import { BRAND_FONTS, DEFAULT_BRAND_FONT, MAX_ATTACHMENT_MB } from '@/lib/types'
import { updateCarouselTitle, updateCarouselSlides, updateCarouselBrand, editSlide, updateSlideField } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'
import SlideCanvasEditor from '@/components/SlideCanvasEditor'

export default function Viewer({ carousel }: { carousel: Carousel }) {
  const [current, setCurrent] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [stageWidth, setStageWidth] = useState(340)
  const stageFrameRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = stageFrameRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setStageWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(carousel.title)

  const [slides, setSlides] = useState<Slide[]>(carousel.slides)
  const [past, setPast] = useState<Slide[][]>([])
  const [future, setFuture] = useState<Slide[][]>([])

  function commitSlides(next: Slide[]) {
    setPast((p) => [...p, slides])
    setFuture([])
    setSlides(next)
    updateCarouselSlides(carousel.id, next)
  }

  // Click-in-place selection (2026-07-24). The shared topbar Delete button used to always delete
  // the whole current slide -- real feedback: after adding click-to-select for objects (same
  // persistent outline text gets), clicking that same button right after selecting something now
  // reads as "delete the thing I just selected," not "delete this entire page." selectedField is
  // null whenever nothing's selected (or the selection isn't deletable, e.g. a circle/logo) --
  // SlideCanvasEditor only ever reports a name here for fields it already flags `deletable`, so
  // this component doesn't need its own copy of that rule. Cleared explicitly alongside every
  // setCurrent call below (not via a useEffect keyed on `current`) so it can never render stale
  // for even one paint -- a selection from slide 2 must never look active while slide 3 is showing.
  const [selectedField, setSelectedField] = useState<string | null>(null)
  function goToSlide(next: number | ((c: number) => number)) {
    setSelectedField(null)
    setCurrent(next)
  }

  function deleteSlide(i: number) {
    if (slides.length <= 1) return
    const next = slides.filter((_, idx) => idx !== i)
    commitSlides(next)
    goToSlide((c) => Math.min(c, next.length - 1))
  }

  async function handleDeleteClick() {
    if (selectedField) {
      const result = await updateSlideField(carousel.id, current, `${selectedField}_DISPLAY`, 'hidden')
      if (result.type === 'updated') commitSlides(result.slides)
      setSelectedField(null)
      return
    }
    deleteSlide(current)
  }

  function undo() {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [slides, ...f])
    setSlides(prev)
    updateCarouselSlides(carousel.id, prev)
    goToSlide((c) => Math.min(c, prev.length - 1))
  }

  function redo() {
    if (future.length === 0) return
    const next = future[0]
    setFuture((f) => f.slice(1))
    setPast((p) => [...p, slides])
    setSlides(next)
    updateCarouselSlides(carousel.id, next)
    goToSlide((c) => Math.min(c, next.length - 1))
  }

  // Real chat-editing build (2026-07-21) -- the box existed visually but had zero wiring behind
  // it (uncontrolled input, no onClick at all). chatReply covers every non-"silently worked" case
  // (clarifying question, redirect to Brand Kit, unsupported edit type, error) since a chat edit
  // that just silently updates the image with no confirmation reads as broken/unresponsive.
  const [chatMessage, setChatMessage] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatReply, setChatReply] = useState<string | null>(null)

  async function handleChatSend() {
    const message = chatMessage.trim()
    if (!message || chatSending) return
    setChatSending(true)
    setChatReply(null)
    try {
      const result = await editSlide(carousel.id, message, current)
      if (result.type === 'updated') {
        commitSlides(result.slides)
        setChatMessage('')
        setChatReply('Updated.')
      } else {
        // clarify / redirect / unsupported / error -- none of these touch slides, just tell the
        // user what happened instead of silently doing nothing (the original bug: the button did
        // nothing at all, with zero feedback either way).
        setChatReply(result.message)
      }
    } catch {
      setChatReply('Something went wrong making that edit -- try again.')
    } finally {
      setChatSending(false)
    }
  }

  const [brandModalOpen, setBrandModalOpen] = useState(false)
  const [brandColors, setBrandColors] = useState<string[]>(
    carousel.brand_colors ?? ['#5B7A5E', '#F1E6D2', '#16130f']
  )
  const [logoUrl, setLogoUrl] = useState<string | null>(carousel.logo_url)
  const [font, setFont] = useState(carousel.font ?? DEFAULT_BRAND_FONT)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [savingBrand, setSavingBrand] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  function handleLogoClick() {
    logoInputRef.current?.click()
  }

  async function handleLogoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setLogoError(null)

    if (!file.type.startsWith('image/')) {
      setLogoError('Logo must be an image file.')
      return
    }
    if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setLogoError(`Logo must be under ${MAX_ATTACHMENT_MB}MB.`)
      return
    }

    setUploadingLogo(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const path = `${user?.id}/logo-${crypto.randomUUID()}-${file.name}`
    const { data, error } = await supabase.storage.from('carousel-uploads').upload(path, file)
    setUploadingLogo(false)

    if (error || !data) {
      setLogoError('Upload failed — try again.')
      return
    }
    const { data: pub } = supabase.storage.from('carousel-uploads').getPublicUrl(data.path)
    setLogoUrl(pub.publicUrl)
  }

  function handleRemoveLogo() {
    setLogoUrl(null)
  }

  async function handleSaveBrand() {
    setSavingBrand(true)
    await updateCarouselBrand(carousel.id, { colors: brandColors, logoUrl, font })
    setSavingBrand(false)
    setBrandModalOpen(false)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLightboxOpen(false)
        setBrandModalOpen(false)
      }

      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      if (typing) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const [downloading, setDownloading] = useState(false)

  async function handleDownloadAll() {
    setDownloading(true)
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'carousel'
    for (let i = 0; i < slides.length; i++) {
      try {
        const res = await fetch(slides[i].url)
        const blob = await res.blob()
        const ext = blob.type.split('/')[1] || 'jpg'
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${slug}-slide-${i + 1}.${ext}`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } catch {
        // one slide failing to fetch shouldn't stop the rest from downloading
      }
      if (i < slides.length - 1) await new Promise((r) => setTimeout(r, 200))
    }
    setDownloading(false)
  }

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
            <input
              className="viewer-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <div className="viewer-title-group" onClick={() => setEditingTitle(true)}>
              <span className="viewer-title">{title}</span>
              <svg className="viewer-title-edit-icon" viewBox="0 0 24 24" width={14} height={14} fill="none">
                <path
                  d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
        </div>
        {/* Mobile-only duplicate trigger: title sits top-left, this sits top-right, same
            row -- the desktop Brand Kit chip (inside .viewer-body, below the stage) is a
            genuinely different DOM position that pure CSS reordering can't reach from here,
            so this is a second real button wired to the same modal state, shown only on
            mobile while the desktop one is hidden there. See globals.css mobile override. */}
        <button className="brand-kit-chip-topbar" onClick={() => setBrandModalOpen(true)}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
            <path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.5 9 7.5 0 2.49-2.01 3.5-3.5 3.5H15a1.5 1.5 0 0 0-1 2.6c.3.28.5.67.5 1.1A2.3 2.3 0 0 1 12 21Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
            <circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" />
            <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
          </svg>
          Brand Kit
        </button>
        <div className="viewer-actions">
          <button
            className="viewer-icon-btn"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            onClick={undo}
            disabled={past.length === 0}
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none">
              <path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="lbl">Undo</span>
          </button>
          <button
            className="viewer-icon-btn"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            onClick={redo}
            disabled={future.length === 0}
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none">
              <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="lbl">Redo</span>
          </button>
          <button
            className="viewer-icon-btn danger"
            aria-label={selectedField ? 'Delete selected object' : 'Delete this slide'}
            title={selectedField ? 'Delete selected object' : 'Delete slide'}
            onClick={handleDeleteClick}
            disabled={!selectedField && slides.length <= 1}
          >
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none">
              <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-.8 12.1a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="lbl">{selectedField ? 'Delete object' : 'Delete'}</span>
          </button>
          <button className="download-btn" onClick={handleDownloadAll} disabled={downloading}>
            {downloading ? 'Downloading…' : <>⬇ <span className="lbl">Download</span></>}
          </button>
        </div>
      </div>

      <div className="viewer-body">
        <div className="thumb-rail">
          {slides.map((s, i) => (
            <div
              key={i}
              className={`thumb-item${i === current ? ' active' : ''}`}
              onClick={() => goToSlide(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={`Slide ${i + 1}`} />
              <span className="num">{i + 1}</span>
            </div>
          ))}
        </div>

        <button className="brand-kit-chip" onClick={() => setBrandModalOpen(true)}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
            <path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.5 9 7.5 0 2.49-2.01 3.5-3.5 3.5H15a1.5 1.5 0 0 0-1 2.6c.3.28.5.67.5 1.1A2.3 2.3 0 0 1 12 21Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
            <circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" />
            <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
          </svg>
          Brand Kit
        </button>

        <div className="stage">
          <div className="stage-frame" ref={stageFrameRef}>
            <SlideCanvasEditor
              key={current}
              carouselId={carousel.id}
              slideIndex={current}
              displayWidth={stageWidth}
              previewUrl={slides[current]?.url}
              onSlidesUpdated={commitSlides}
              onSelectionChange={setSelectedField}
            />
            {/* No more edit-mode toggle (2026-07-24) -- clicking any field is always live, so a
                plain click on the stage can't also mean "zoom" anymore. Zoom moves to its own
                explicit corner button, same slot the old edit-toggle used. */}
            <button className="stage-zoom-btn" onClick={() => setLightboxOpen(true)} aria-label="Zoom slide">
              <svg viewBox="0 0 24 24" width={15} height={15} fill="none">
                <path
                  d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.35-4.35"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <button
            className="stage-arrow left"
            aria-label="Previous slide"
            onClick={() => goToSlide((c) => (c - 1 + slides.length) % slides.length)}
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="stage-arrow right"
            aria-label="Next slide"
            onClick={() => goToSlide((c) => (c + 1) % slides.length)}
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="chat-group">
          <div className="chat-box">
            <input
              type="text"
              placeholder="e.g. slide 3: punchier hook, swap the CTA…"
              value={chatMessage}
              disabled={chatSending}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleChatSend()
              }}
            />
            <button className="chat-send-btn" aria-label="Send" onClick={handleChatSend} disabled={chatSending || !chatMessage.trim()}>
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {chatReply ? (
            <p className="chat-reply">{chatReply}</p>
          ) : (
            <p className="chat-hint">
              Be specific about which slide(s) you mean (e.g. &quot;slide 2&quot;) — otherwise only the slide you&apos;re viewing gets updated.
            </p>
          )}
        </div>
      </div>

      <div className={`brand-modal-backdrop${brandModalOpen ? ' show' : ''}`} onClick={() => setBrandModalOpen(false)}>
        <div className="brand-modal" onClick={(e) => e.stopPropagation()}>
          <div className="brand-modal-head">
            <h2>Brand Kit</h2>
            <p className="sub">Colors, font & logo for this carousel only.</p>
          </div>

          <div className="brand-color-label" style={{ marginBottom: 8 }}>Logo (optional)</div>
          <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={handleLogoSelected} />
          {logoUrl ? (
            <div className="brand-logo-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Brand logo" />
              <div className="brand-logo-preview-actions">
                <button type="button" className="settings-link-btn" onClick={handleLogoClick}>
                  Replace
                </button>
                <button type="button" className="settings-link-btn danger" onClick={handleRemoveLogo}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="brand-logo-upload" onClick={handleLogoClick}>
              {uploadingLogo ? 'Uploading…' : 'Drop your logo here, or click to upload'}
            </div>
          )}
          {logoError && <p className="attach-limit-error">{logoError}</p>}

          <div className="brand-color-label" style={{ margin: '24px 0 8px' }}>Colors</div>
          <div className="brand-color-picker">
            {brandColors.map((c, i) => (
              <div key={i} className="brand-color-card">
                <label className="color-swatch-input" style={{ background: c }}>
                  <input
                    type="color"
                    value={c}
                    aria-label={`Brand color ${i + 1}`}
                    onChange={(e) => {
                      const next = [...brandColors]
                      next[i] = e.target.value
                      setBrandColors(next)
                    }}
                  />
                </label>
                <input
                  type="text"
                  className="hex-input"
                  value={c}
                  aria-label={`Brand color ${i + 1} hex code`}
                  maxLength={7}
                  placeholder="#000000"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const v = '#' + e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                    const next = [...brandColors]
                    next[i] = v
                    setBrandColors(next)
                  }}
                />
                <div className="brand-color-label">Color {i + 1}</div>
              </div>
            ))}
          </div>

          <div className="brand-color-label" style={{ margin: '24px 0 8px' }}>Font</div>
          <div className="brand-font-row">
            {BRAND_FONTS.map((f) => (
              <button
                type="button"
                key={f.name}
                className={`brand-font-chip${font === f.name ? ' selected' : ''}`}
                style={{ fontFamily: f.cssVar }}
                onClick={() => setFont(f.name)}
              >
                {f.name}
              </button>
            ))}
          </div>

          <div className="brand-modal-actions">
            <button type="button" className="settings-link-btn" onClick={() => setBrandModalOpen(false)}>
              Cancel
            </button>
            <button type="button" className="settings-save" style={{ marginTop: 0 }} onClick={handleSaveBrand} disabled={savingBrand}>
              {savingBrand ? 'Saving…' : 'Save'}
            </button>
          </div>
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
