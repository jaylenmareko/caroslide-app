'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import JSZip from 'jszip'
import type { Carousel, Slide } from '@/backend/lib/types'
import { updateCarouselTitle, updateCarouselSlides, updateSlideField, editSlide } from '@/backend/lib/actions'
import SlideCanvasEditor, { type SlideCanvasEditorHandle } from '@/frontend/components/SlideCanvasEditor'

// Reference-equality diff between two Slide[] snapshots -- safe because every local edit
// (handleFieldsChanged) and every undo/redo step builds its array via immutable spread, so an
// unchanged slide always keeps its exact old object reference and a changed one always gets a
// brand new one. Used to figure out which slide indices an undo/redo step just touched, so they
// can be marked dirty again (Save re-covers them) without needing a separate value-by-value diff.
function changedIndices(a: Slide[], b: Slide[]): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push(i)
  }
  return out
}

// Guards against an accidental giant paste (a whole doc/paragraph) turning into a real, costly
// editSlide() -> Claude call -- the box itself no longer stops you once it scrolls past 120px
// (2026-07-24). 500 comfortably covers even a multi-part request ("slide 2: X, also slide 3: Y").
const CHAT_MESSAGE_MAX_LENGTH = 500

export default function Viewer({ carousel }: { carousel: Carousel }) {
  const [current, setCurrent] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [stageWidth, setStageWidth] = useState(340)
  const stageFrameRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<SlideCanvasEditorHandle>(null)

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
  // Read after an await instead of the `slides` closed over before it -- a function that awaits
  // ensureSaved()/saveAll() before touching `slides` needs the LATEST state, which a variable
  // captured pre-await can't give it (React doesn't retroactively update already-destructured
  // closures). Synced via an effect, not a direct render-time assignment -- react-hooks/refs flags
  // mutating a ref's .current while rendering, even for this keep-it-in-sync pattern.
  const slidesRef = useRef(slides)
  useEffect(() => {
    slidesRef.current = slides
  }, [slides])

  // Explicit-Save build (2026-07-28, Jaylen: "remove instant updating... makes it feel like a lag
  // when there isn't"). Real, avoidable inefficiency found while investigating: every single field
  // edit used to trigger TWO separate network round trips -- SlideCanvasEditor's own save() called
  // updateSlideField (the real cost: a Cloudflare render + Storage upload), then handed the result
  // to this commitSlides(), which ALWAYS called updateCarouselSlides() again right after -- a fully
  // redundant second DB write of the exact same result. Click-in-place field edits (text, color,
  // font, drag-move/resize, delete) no longer touch the network at all until the user
  // hits the new topbar Save button -- see SlideCanvasEditor.tsx's own top-of-file comment for the
  // client side of this. dirtySlideIndices tracks which slides have unsaved local edits since the
  // last successful save, so Save only re-renders the ones that actually changed, not every slide.
  const [dirtySlideIndices, setDirtySlideIndices] = useState<Set<number>>(new Set())
  const [savingAll, setSavingAll] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Real bug found live testing this exact refactor: undo()/redo() correctly revert `slides` state
  // (confirmed -- dirty/past/future all update right), but SlideCanvasEditor's live iframe DOM,
  // already showing whatever's being undone, never gets told to reload and reflect the reverted
  // values, since neither of them ever touches previewUrl (they're local-only, by design). Undo
  // silently looked like it did nothing. Bumped ONLY inside undo()/redo(), never on a regular field
  // edit -- SlideCanvasEditor's load-effect depends on this alongside previewUrl.
  const [reloadKey, setReloadKey] = useState(0)

  // Chat-editing and whole-slide deletion still persist immediately (Jaylen: keep those auto-
  // saving -- both are already deliberate, single, already-slow actions, not the rapid-fire
  // clicking/dragging this whole change is about). commitSlides is now ONLY used by those two
  // paths, always after ensureSaved() has flushed any pending local edits first -- see both call
  // sites below for why: editSlide/deleteSlide re-fetch or restructure from a server-side view
  // that has no idea about unsaved local edits, so skipping the flush first would silently
  // overwrite whatever hadn't been saved yet.
  function commitSlides(next: Slide[]) {
    setPast((p) => [...p, slidesRef.current])
    setFuture([])
    setSlides(next)
    updateCarouselSlides(carousel.id, next)
  }

  // Local-only commit for click-in-place field edits -- merges the changed field(s) into the
  // CURRENT slide's values, pushes undo history, marks that slide dirty. No network call at all;
  // Save (below) is what actually persists.
  const handleFieldsChanged = useCallback(
    (fields: Record<string, string>) => {
      setPast((p) => [...p, slidesRef.current])
      setFuture([])
      setSlides((prev) => {
        const next = [...prev]
        next[current] = { ...next[current], values: { ...next[current].values, ...fields } }
        return next
      })
      setDirtySlideIndices((prev) => new Set(prev).add(current))
    },
    [current]
  )

  // Renders + uploads exactly one fresh PNG per dirty slide (unavoidable -- each one genuinely
  // changed), then exactly ONE final DB write for the whole carousel, replacing what used to be a
  // separate render+upload+DB-write round trip PER EDIT. Returns false (and leaves whatever's still
  // unsaved marked dirty, for a retry) on any failure -- callers that need to guarantee a clean
  // slate first (chat-editing, slide deletion) check this before proceeding.
  async function saveAll(): Promise<boolean> {
    if (dirtySlideIndices.size === 0) return true
    setSavingAll(true)
    setSaveError(null)
    try {
      let working = slidesRef.current
      const remaining = new Set(dirtySlideIndices)
      for (const idx of dirtySlideIndices) {
        const values = working[idx]?.values
        // Only ever reached if editing this slide is what marked it dirty in the first place
        // (handleFieldsChanged/undo/redo), which requires .values to already exist -- this guard
        // is for TypeScript, not a real runtime case, but fails safely rather than crashing if it
        // somehow were.
        if (!values) {
          setSaveError(`Slide ${idx + 1} can't be saved -- try a new carousel.`)
          setDirtySlideIndices(remaining)
          return false
        }
        const result = await updateSlideField(carousel.id, idx, values)
        if (result.type !== 'updated') {
          setSaveError(result.message)
          setDirtySlideIndices(remaining)
          return false
        }
        working = working.map((s, i) => (i === idx ? result.slides[idx] : s))
        remaining.delete(idx)
      }
      await updateCarouselSlides(carousel.id, working)
      setSlides(working)
      setDirtySlideIndices(new Set())
      return true
    } catch {
      setSaveError('Something went wrong saving -- try again.')
      return false
    } finally {
      setSavingAll(false)
    }
  }

  // Chat-editing and slide-deletion both read/restructure from a view that has no idea about
  // unsaved local field edits (editSlide re-fetches straight from the DB; deleteSlide's own commit
  // would otherwise persist a slides array whose dirty slides still have their OLD, pre-edit PNG
  // despite already-changed values) -- flushing first keeps both paths correct.
  async function ensureSaved(): Promise<boolean> {
    if (dirtySlideIndices.size === 0) return true
    return saveAll()
  }

  useEffect(() => {
    if (dirtySlideIndices.size === 0) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtySlideIndices])

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

  // Async now (2026-07-28) -- flushes any pending local field edits first, since removing a slide
  // restructures the whole array from the CURRENT client-side state (unlike editSlide, this one
  // doesn't re-fetch from the DB), but a still-dirty slide's `.values` and `.url` would be out of
  // sync (values reflect the local edit, url is still the old PNG) if persisted as-is.
  async function deleteSlide(i: number) {
    const ok = await ensureSaved()
    if (!ok) return
    const latest = slidesRef.current
    if (latest.length <= 1) return
    const next = latest.filter((_, idx) => idx !== i)
    commitSlides(next)
    goToSlide((c) => Math.min(c, next.length - 1))
  }

  function handleDeleteClick() {
    if (selectedField) {
      if (!selectedDeletable) return
      // Real latency bug found live 2026-07-26: this used to call updateSlideField directly and
      // commit the result itself, bypassing SlideCanvasEditor's own save() entirely -- which meant
      // it paid the full Cloudflare render round-trip AND a forced iframe reload afterward, unlike
      // every other edit action (typing, dragging, the hover-X button), which only pay the first
      // cost. Routing through the same setField() the hover-X button uses gets this action the
      // identical skip-reload + optimistic-local-update treatment, so it feels exactly as fast.
      // As of the explicit-Save build, setField() no longer triggers ANY network call at all --
      // this is now a purely local edit like every other field-level action, deferred to Save.
      editorRef.current?.setField(selectedMode === 'text' ? selectedField : `${selectedField}_DISPLAY`, selectedMode === 'text' ? '' : 'hidden')
      setSelectedField(null)
      setSelectedDeletable(false)
      setSelectedMode(null)
      return
    }
    deleteSlide(current)
  }

  // Local-only now (2026-07-28) -- undoing/redoing a NOT-yet-saved edit used to still trigger a
  // real updateCarouselSlides() write, which would have reintroduced exactly the per-action network
  // lag this whole change removes. Just walks the past/future stacks and marks whichever slides the
  // step actually touched dirty again (via reference-equality diffing, see changedIndices above) --
  // Save is what persists it, same as every other local edit.
  function undo() {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    const before = slidesRef.current
    const touched = changedIndices(before, prev)
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [before, ...f])
    setSlides(prev)
    setDirtySlideIndices((prevSet) => {
      const next = new Set(prevSet)
      touched.forEach((idx) => next.add(idx))
      return next
    })
    setReloadKey((k) => k + 1)
    goToSlide((c) => Math.min(c, prev.length - 1))
  }

  function redo() {
    if (future.length === 0) return
    const next = future[0]
    const before = slidesRef.current
    const touched = changedIndices(before, next)
    setFuture((f) => f.slice(1))
    setPast((p) => [...p, before])
    setSlides(next)
    setDirtySlideIndices((prevSet) => {
      const nextSet = new Set(prevSet)
      touched.forEach((idx) => nextSet.add(idx))
      return nextSet
    })
    setReloadKey((k) => k + 1)
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

  // Fast-path for obvious undo/redo phrasing (2026-07-28) -- checked BEFORE ensureSaved() runs,
  // deliberately skipping the server entirely for these. The normal path below flushes pending
  // local edits first (editSlide needs a fresh DB view), but for an undo/redo request that flush
  // would force-save the exact change the user is asking to undo, defeating the whole point.
  // Covers the common, unambiguous phrasings with zero server round-trip; anything less obvious
  // still reaches the real classification (which does flush first) -- a minor, harmless
  // inefficiency for those rarer phrasings (one save that a follow-up undo then reverts locally
  // anyway), not a correctness bug, just not worth the complexity of avoiding entirely.
  const UNDO_REDO_PATTERN = /^(please\s+)?(undo|redo)(\s+(that|it|this|the last (change|edit|thing)))?\.?$/i

  async function handleChatSend() {
    const message = chatMessage.trim()
    if (!message || chatSending) return
    const quickMatch = UNDO_REDO_PATTERN.exec(message)
    if (quickMatch) {
      setChatMessage('')
      setChatReply(null)
      if (quickMatch[2].toLowerCase() === 'redo') {
        if (future.length === 0) setChatReply('Nothing to redo.')
        else {
          redo()
          setChatReply('Redone.')
        }
      } else {
        if (past.length === 0) setChatReply('Nothing to undo yet.')
        else {
          undo()
          setChatReply('Undone.')
        }
      }
      return
    }
    setChatSending(true)
    setChatReply(null)
    try {
      // Flush any pending local field edits first -- editSlide re-fetches slide.values straight
      // from the DB, which has no idea about anything edited locally since the last Save. Skipping
      // this would let a chat-edit's own result silently overwrite unsaved click-in-place edits
      // the moment its result gets committed below.
      const flushed = await ensureSaved()
      if (!flushed) {
        setChatReply('Could not save your pending edits first -- try Save, then send this again.')
        return
      }
      const result = await editSlide(carousel.id, message, current)
      if (result.type === 'updated') {
        commitSlides(result.slides)
        setChatMessage('')
        setChatReply('Updated.')
      } else if (result.type === 'client_undo') {
        // Never touched the server at all -- there's no server-side undo history to act on (see
        // EditSlideResult's own comment). Just call the exact same local undo() the topbar
        // button/Ctrl+Z already use, entirely client-side.
        setChatMessage('')
        if (past.length === 0) {
          setChatReply('Nothing to undo yet.')
        } else {
          undo()
          setChatReply('Undone.')
        }
      } else if (result.type === 'client_redo') {
        setChatMessage('')
        if (future.length === 0) {
          setChatReply('Nothing to redo.')
        } else {
          redo()
          setChatReply('Redone.')
        }
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
  const [downloadingAll, setDownloadingAll] = useState(false)

  function slugify() {
    return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'carousel'
  }

  async function downloadOne(url: string, filename: string) {
    const res = await fetch(url)
    const blob = await res.blob()
    const ext = blob.type.split('/')[1] || 'jpg'
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = `${filename}.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  }

  // Real ask (2026-08-01, Jaylen: individual download stays the default like today, bulk is an
  // optional extra) -- the main Download button now downloads just the slide currently being
  // viewed, not all 5 at once. handleDownloadAll (below) is the same all-5 logic this button used
  // to run, now reachable from its own separate control instead of being the only option.
  async function handleDownloadCurrent() {
    setDownloading(true)
    try {
      await downloadOne(slides[current].url, `${slugify()}-slide-${current + 1}`)
    } catch {
      // a failed fetch shouldn't leave the button stuck disabled
    }
    setDownloading(false)
  }

  // Real bug found live testing this exact feature (2026-08-01): the original version of this
  // triggered 5 separate `a.click()` downloads in a loop -- Chrome (and other browsers) block/
  // throttle multiple automatic downloads fired in quick succession without a fresh user gesture
  // per file, so only the first slide ever actually landed on disk, silently. Bundling all 5 into
  // one real ZIP (client-side, via jszip) and triggering a single download sidesteps that browser
  // restriction entirely instead of fighting it, and is arguably better UX for "download all"
  // anyway -- one file, not five loose ones in the Downloads folder.
  async function handleDownloadAll() {
    setDownloadingAll(true)
    try {
      const slug = slugify()
      const zip = new JSZip()
      for (let i = 0; i < slides.length; i++) {
        const res = await fetch(slides[i].url)
        const blob = await res.blob()
        const ext = blob.type.split('/')[1] || 'jpg'
        zip.file(`${slug}-slide-${i + 1}.${ext}`, blob)
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const objectUrl = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${slug}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      // a failed fetch shouldn't leave the button stuck disabled
    }
    setDownloadingAll(false)
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
            disabled={past.length === 0 || savingAll}
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
            disabled={future.length === 0 || savingAll}
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none">
              <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="lbl">Redo</span>
          </button>
          <button
            className={`save-btn${dirtySlideIndices.size > 0 ? ' dirty' : ''}`}
            aria-label="Save changes"
            title="Save changes"
            onClick={() => void saveAll()}
            disabled={dirtySlideIndices.size === 0 || savingAll}
          >
            <span className="lbl">{savingAll ? 'Saving…' : dirtySlideIndices.size > 0 ? 'Save' : 'Saved'}</span>
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
          <button
            className="viewer-icon-btn download-all-btn"
            aria-label="Download all 5 slides"
            title="Download all 5 slides"
            onClick={handleDownloadAll}
            disabled={downloadingAll}
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
              <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
              <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
              <rect x="4" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
              <rect x="13" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            <span className="lbl">{downloadingAll ? 'Downloading…' : 'Download All'}</span>
          </button>
          <button className="download-btn" onClick={handleDownloadCurrent} disabled={downloading}>
            {downloading ? 'Downloading…' : <>⬇ <span className="lbl">Download</span></>}
          </button>
        </div>
      </div>
      {saveError && <p className="save-error">{saveError}</p>}

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
              ref={editorRef}
              carouselId={carousel.id}
              slideIndex={current}
              displayWidth={stageWidth}
              previewUrl={slides[current]?.url}
              currentValues={slides[current]?.values ?? {}}
              forceReloadKey={reloadKey}
              onFieldsChanged={handleFieldsChanged}
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
          {chatSending ? (
            // Real edit takes a real Anthropic call + a Cloudflare render round-trip -- 30-90+
            // seconds isn't unusual. Before this, chatReply was reset to null right as sending
            // started (see handleChatSend), so this exact window showed the same static .chat-hint
            // a first-time user sees before ever sending anything -- nothing on screen changed for
            // up to a minute and a half, which reads as broken/unresponsive, not "working."
            <p className="chat-reply chat-reply-pending">Thinking…</p>
          ) : chatReply ? (
            <p className="chat-reply">{chatReply}</p>
          ) : (
            <p className="chat-hint">
              Be specific about which slide(s)
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
