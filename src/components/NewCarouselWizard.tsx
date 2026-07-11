'use client'

import { useRef, useState, useTransition } from 'react'
import type { Angle, Format, Look } from '@/lib/types'
import { ANGLE_TO_LOOK, MAX_ATTACHMENTS, MAX_ATTACHMENT_MB } from '@/lib/types'
import { createCarousel } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'

const FORMATS: { title: Format; desc: string }[] = [
  { title: 'Post', desc: 'Feed carousel — needs a real hook.' },
  { title: 'Square', desc: 'Feed or LinkedIn, same idea.' },
  { title: 'Story', desc: 'Warm audience — hook optional.' },
]

const ANGLES: { title: Angle; desc: string }[] = [
  { title: 'Value', desc: 'Direct tips, no story.' },
  { title: 'Growth', desc: 'A hook that builds into a story.' },
  { title: 'Education', desc: 'A real fact, explained.' },
]

const LOOKS: { title: Look; desc: string; preview: string }[] = [
  { title: 'Circles + Photo', desc: 'Real photo proof, two circle insets.', preview: '/mock/education-1.jpg' },
  { title: 'Plain Text', desc: 'One strong cover, plain slides after.', preview: '/mock/growth-2.jpg' },
  { title: 'Bold Stat', desc: 'A number takes over the frame.', preview: '/mock/value-1.jpg' },
]

type Attachment = { file: File; previewUrl: string }

export default function NewCarouselWizard() {
  const [step, setStep] = useState(0)
  const [format, setFormat] = useState<Format>('Post')
  const [angle, setAngle] = useState<Angle>('Value')
  const [look, setLook] = useState<Look>(ANGLE_TO_LOOK['Value'])
  const [lookTouched, setLookTouched] = useState(false)
  const [brief, setBrief] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const recommendedLook = ANGLE_TO_LOOK[angle]
  const effectiveLook = lookTouched ? look : recommendedLook

  function pickFormat(f: Format) {
    setFormat(f)
    setStep(1)
  }
  function pickAngle(a: Angle) {
    setAngle(a)
    setLookTouched(false)
    setStep(2)
  }
  function pickLook(l: Look) {
    setLook(l)
    setLookTouched(true)
    setStep(3)
  }

  function handleAttachClick() {
    fileInputRef.current?.click()
  }

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file later
    if (files.length === 0) return

    setAttachError(null)

    const oversized = files.filter((f) => f.size > MAX_ATTACHMENT_MB * 1024 * 1024)
    const validNewFiles = files.filter((f) => f.size <= MAX_ATTACHMENT_MB * 1024 * 1024)

    let combined = [...attachments]
    let overflowed = false
    for (const f of validNewFiles) {
      if (combined.length >= MAX_ATTACHMENTS) {
        overflowed = true
        break
      }
      combined = [...combined, { file: f, previewUrl: URL.createObjectURL(f) }]
    }
    setAttachments(combined)

    if (oversized.length > 0) {
      setAttachError(`${oversized.length} file(s) skipped — over ${MAX_ATTACHMENT_MB}MB each.`)
    } else if (overflowed) {
      setAttachError(`Only the first ${MAX_ATTACHMENTS} images were added — that's the limit per carousel.`)
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  function handleGenerate() {
    startTransition(async () => {
      setUploading(true)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const urls: string[] = []

      for (const { file } of attachments) {
        const path = `${user?.id}/${crypto.randomUUID()}-${file.name}`
        const { data, error } = await supabase.storage
          .from('carousel-uploads')
          .upload(path, file)
        if (!error && data) {
          const { data: pub } = supabase.storage.from('carousel-uploads').getPublicUrl(data.path)
          urls.push(pub.publicUrl)
        }
      }

      setUploading(false)
      await createCarousel({ angle, format, look: effectiveLook, brief, referenceImageUrls: urls })
    })
  }

  return (
    <section className="new-section wrap">
      <h1>New Carousel</h1>
      <p className="lede">Pick a format, an angle, and a look — one step at a time — then drop in a topic.</p>

      <div className="wizard-progress">
        <span className={`wp-dot${step === 0 ? ' active' : ''}${step > 0 ? ' done' : ''}`} />
        <span className={`wp-dot${step === 1 ? ' active' : ''}${step > 1 ? ' done' : ''}`} />
        <span className={`wp-dot${step === 2 ? ' active' : ''}${step > 2 ? ' done' : ''}`} />
      </div>
      <button
        className="wizard-back"
        style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
        onClick={() => setStep((s) => Math.max(0, s - 1))}
      >
        ‹ Back
      </button>

      <div className={`wiz-step${step === 0 ? ' active' : ''}`}>
        <p className="pick-label">Choose a format</p>
        <div className="pick-row">
          {FORMATS.map((f) => (
            <div
              key={f.title}
              className={`pick-card${format === f.title ? ' selected' : ''}`}
              onClick={() => pickFormat(f.title)}
            >
              <div className="title">{f.title}</div>
              <div className="desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 1 ? ' active' : ''}`}>
        <p className="pick-label">Choose an angle</p>
        <div className="pick-row">
          {ANGLES.map((a) => (
            <div
              key={a.title}
              className={`pick-card${angle === a.title ? ' selected' : ''}`}
              onClick={() => pickAngle(a.title)}
            >
              <div className="title">{a.title}</div>
              <div className="desc">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 2 ? ' active' : ''}`}>
        <p className="pick-label">Choose a look</p>
        <div className="pick-row">
          {LOOKS.map((l) => (
            <div
              key={l.title}
              className={`pick-card${effectiveLook === l.title ? ' selected' : ''}`}
              onClick={() => pickLook(l.title)}
            >
              <div className="pick-card-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.preview} alt={`${l.title} example`} />
              </div>
              <div className="title">
                {l.title}
                {l.title === recommendedLook && (
                  <span className="rec-badge show">Recommended</span>
                )}
              </div>
              <div className="desc">{l.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`wizard-composer${step >= 3 ? ' show' : ''}`}>
        <p className="pick-label">Tell us everything</p>
        <div className="new-composer-box">
          <textarea
            rows={3}
            placeholder="Give us as much context as possible: brand colors, photos, links, tone, what you want the carousel to say…"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />

          {attachments.length > 0 && (
            <div className="attach-strip">
              {attachments.map((a, i) => (
                <div key={a.previewUrl} className="attach-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.previewUrl} alt="" />
                  <button className="remove" aria-label="Remove image" onClick={() => removeAttachment(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-bottom-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={handleFilesSelected}
            />
            <button type="button" className="composer-attach-btn" onClick={handleAttachClick}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 12.5V7a4 4 0 0 0-4-4h-1M3 11.5V17a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-1M9 3H8a4 4 0 0 0-4 4v5M8 13l2.5-2.5a2 2 0 0 1 2.8 0L17 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              </svg>
              Attach photos {attachments.length > 0 && `(${attachments.length}/${MAX_ATTACHMENTS})`}
            </button>
            <button
              className="composer-send-btn"
              aria-label="Generate"
              onClick={handleGenerate}
              disabled={isPending || uploading}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {attachError && <p className="attach-limit-error">{attachError}</p>}
        </div>
        <p className="new-hint">
          <b>{format}</b> · <b>{angle}</b> · <b>{effectiveLook}</b> selected — the more detail here, the less back-and-forth later.
        </p>
      </div>
    </section>
  )
}
