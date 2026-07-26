'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Carousel, Slide } from '@/lib/types'
import { updateCarouselTitle, updateCarouselSlides, editSlide, updateSlideField } from '@/lib/actions'
import SlideCanvasEditor from '@/components/SlideCanvasEditor'

// Guards against an accidental giant paste (a whole doc/paragraph) turning into a real, costly
// editSlide() -> Claude call -- the box itself no longer stops you once it scrolls past 120px
// (2026-07-24). 500 comfortably covers even a multi-part request ("slide 2: X, also slide 3: Y").
const CHAT_MESSAGE_MAX_LENGTH = 500

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
  // reads as "delete the thing I just selected," not "delete this entire page."
  //
  // Real bug found live 2026-07-26 ("still having the same issue" after the first fix): this used
  // to track only a deletable field's name, collapsing "a circle/logo is selected" into the exact
  // same null signal as "nothing is selected" -- so selecting a circle and hitting Delete still
  // silently fell back to deleting the whole slide. Now tracks the actual selection (any field,
  // deletable or not) plus whether THIS field has a delete action at all -- slide-delete is the
  // fallback ONLY when truly nothing is selected; a selected-but-not-deletable object (no delete
  // concept exists yet for circles/logo -- deleting one would break the template layout) is a
  // no-op instead, never the whole page. Cleared explicitly alongside every setCurrent call below
  // (not via a useEffect keyed on `current`) so it can never render stale for even one paint -- a
  // selection from slide 2 must never look active while slide 3 is showing.
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [selectedDeletable, setSelectedDeletable] = useState(false)
  // Real bug found live 2026-07-26 (video evidence: clicking into a caption then hitting the
  // topbar Delete button wiped the whole slide, not just the text): text fields never called
  // selectThis() at all (they go straight to contenteditable), so selectedField stayed null from
  // this component's point of view the entire time a caption was being edited -- handleDeleteClick
  // saw "nothing selected" and fell through to its deliberate slide-delete fallback. mode tracks
  // HOW to delete once selectedField is real: 'text' clears the field's own value to '' (the same
  // path the hover-X button already uses -- no `_DISPLAY` placeholder exists for text), 'display'
  // toggles the move-only field's `_DISPLAY` placeholder (divider/logo).
  const [selectedMode, setSelectedMode] = useState<'text' | 'display' | null>(null)
  // Real bug found live 2026-07-26: an inline function here (a fresh reference every render,
  // unlike setSelectedField alone, which React guarantees is stable) cascades into a re-render
  // loop -- SlideCanvasEditor's `load` useCallback lists `onSelectionChange` as a dependency, so a
  // new reference here gives `load` a new reference too, which re-triggers the effect that calls
  // `load()`, which resets selection to null at its very start (see that file's own comment).
  // Console-traced the actual sequence to confirm before guessing: select -> immediately reset to
  // null, every time, which is why the topbar button never reflected a real selection at all
  // despite the correct field/deletable data actually arriving. useCallback with an empty
  // dependency array restores the same stability setSelectedField always had on its own.
  const handleSelectionChange = useCallback((field: string | null, deletable: boolean, mode?: 'text' | 'display') => {
    setSelectedField(field)
    setSelectedDeletable(deletable)
    setSelectedMode(mode ?? null)
  }, [])
  function goToSlide(next: number | ((c: number) => number)) {
    setSelectedField(null)
    setSelectedDeletable(false)
    setSelectedMode(null)
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
      if (!selectedDeletable) return
      const result =
        selectedMode === 'text'
          ? await updateSlideField(carousel.id, current, selectedField, '')
          : await updateSlideField(carousel.id, current, `${selectedField}_DISPLAY`, 'hidden')
      if (result.type === 'updated') commitSlides(result.slides)
      setSelectedField(null)
      setSelectedDeletable(false)
      setSelectedMode(null)
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
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow (2026-07-24) -- most edits are one short line, so a permanently tall box would sit
  // mostly empty; growing with content (capped, then scrolling internally -- see globals.css'
  // max-height) matches the box to what's actually being typed instead. Resetting height to 'auto'
  // before reading scrollHeight is required every time -- scrollHeight only shrinks correctly if
  // the element's own height isn't still holding it open from a longer previous value.
  useEffect(() => {
    const el = chatInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [chatMessage])

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLightboxOpen(false)
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedField) {
        // Covers focus being on the outer page when Delete/Backspace is pressed -- the more
        // common case (focus still inside the iframe right after selecting something there) is
        // handled by SlideCanvasEditor's own keydown listener, since keystrokes while focus is
        // inside an iframe never reach this outer document's listener at all. Deliberately does
        // NOT fall back to deleteSlide() when nothing's selected -- Jaylen: "the object should
        // delete, not the page" -- Backspace is pressed constantly by accident; only ever
        // deleting a specific selected object (never the whole slide) from a bare keypress is the
        // safe default. Whole-slide delete stays a deliberate click on the topbar button.
        e.preventDefault()
        handleDeleteClick()
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
            aria-label={selectedField ? (selectedDeletable ? 'Delete selected object' : 'Nothing to delete for this selection') : 'Delete this slide'}
            title={selectedField ? (selectedDeletable ? 'Delete selected object' : 'Nothing to delete for this selection') : 'Delete slide'}
            // Real bug found live 2026-07-26, second round (video evidence + traced event order):
            // clicking this button while a caption was mid-edit shifted focus away from the iframe's
            // contenteditable, firing its blur handler -- which posts field:null -- BEFORE this
            // button's own onClick runs (blur-on-focus-shift fires ahead of click, standard browser
            // event order). That raced selectedField back to null right before handleDeleteClick
            // read it, so it fell through to whole-slide delete despite the mode:'text' fix already
            // in place. preventDefault on mousedown stops the browser's default focus-shift-to-this-
            // button behavior entirely, so the contenteditable never blurs and selectedField survives
            // intact -- same technique rich-text-editor toolbars use to act on a focused field without
            // stealing its focus first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleDeleteClick}
            disabled={selectedField ? !selectedDeletable : slides.length <= 1}
          >
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none">
              <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-.8 12.1a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="lbl">{selectedField && selectedDeletable ? 'Delete object' : 'Delete'}</span>
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

        <div className="stage">
          <div className="stage-frame" ref={stageFrameRef}>
            <SlideCanvasEditor
              key={current}
              carouselId={carousel.id}
              slideIndex={current}
              displayWidth={stageWidth}
              previewUrl={slides[current]?.url}
              onSlidesUpdated={commitSlides}
              onSelectionChange={handleSelectionChange}
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
            <textarea
              ref={chatInputRef}
              rows={1}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              placeholder="e.g. slide 3: punchier hook, swap the CTA…"
              value={chatMessage}
              disabled={chatSending}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleChatSend()
                }
              }}
            />
            <button className="chat-send-btn" aria-label="Send" onClick={handleChatSend} disabled={chatSending || !chatMessage.trim()}>
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {/* Silent at typical message lengths -- only surfaces once someone's actually
              approaching the cap, so it reads as a helpful heads-up, not a running counter no one
              asked for. */}
          {chatMessage.length > CHAT_MESSAGE_MAX_LENGTH - 60 && (
            <p className="chat-char-count">
              {chatMessage.length}/{CHAT_MESSAGE_MAX_LENGTH}
            </p>
          )}
          {chatReply ? (
            <p className="chat-reply">{chatReply}</p>
          ) : (
            <p className="chat-hint">
              Be specific about which slide(s) you mean (e.g. &quot;slide 2&quot;) — otherwise only the slide you&apos;re viewing gets updated.
            </p>
          )}
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
