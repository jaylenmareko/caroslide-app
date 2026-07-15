'use client'

import { useRef, useState, useTransition } from 'react'
import type { Angle, Format, Look, TemplateVariant } from '@/lib/types'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_MB } from '@/lib/types'

const RECOMMENDED_LOOK: Look = 'Circles + Photo'
import { createCarousel, saveBrandKit } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'

const FORMATS: { title: Format; desc: string }[] = [
  { title: 'Post', desc: 'Feed carousel — needs a real hook.' },
  { title: 'Square', desc: 'Feed or LinkedIn, same idea.' },
  { title: 'Story', desc: 'Warm audience — hook optional.' },
]

// Real canvas dimensions from the /carousel skill's templates -- width is always
// 1080, only height differs (1350 / 1080 / 1920). Using an SVG viewBox (not CSS
// aspect-ratio + max-width) because that combo doesn't reliably shrink both
// dimensions together -- SVG's native viewBox scaling does, like object-fit:contain.
const FORMAT_CANVAS: Record<Format, [number, number]> = {
  Post: [1080, 1350],
  Square: [1080, 1080],
  Story: [1080, 1920],
}
const FORMAT_LABEL: Record<Format, string> = {
  Post: '4:5',
  Square: '1:1',
  Story: '9:16',
}

function FormatMockup({ format }: { format: Format }) {
  const [w, h] = FORMAT_CANVAS[format]
  return (
    <div className="format-mock">
      <svg className="format-mock-frame" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <rect x="14" y="14" width={w - 28} height={h - 28} rx="24" fill="none" stroke="var(--line-strong)" strokeWidth="14" strokeDasharray="26 20" />
        <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="middle" fontSize="72" fontWeight="700" fill="var(--ink-faint)">
          {FORMAT_LABEL[format]}
        </text>
      </svg>
    </div>
  )
}

const ANGLES: { title: Angle; desc: string }[] = [
  { title: 'Value', desc: 'Direct tips, no story.' },
  { title: 'Growth', desc: 'A hook that builds into a story.' },
  { title: 'Education', desc: 'A real fact, explained.' },
]

const ANGLE_MOCK_COPY: Record<Angle, { text: React.ReactNode; size: 'lg' | 'md' | 'sm' }> = {
  Value: {
    text: <>Your lotion has <span className="angle-mock-accent">more seed oil</span> than your salad dressing.</>,
    size: 'lg',
  },
  Growth: {
    text: <>I told my client his <span className="angle-mock-accent">dating apps</span> were the problem.</>,
    size: 'md',
  },
  Education: {
    text: (
      <>
        The class action covered every rancher who sold cattle between 2014 and 2019 — alleging the{' '}
        <span className="angle-mock-accent">Big 4 packers</span> deliberately limited purchases to suppress the price
        ranchers were paid.
      </>
    ),
    size: 'sm',
  },
}

function AngleMockup({ angle }: { angle: Angle }) {
  const { text, size } = ANGLE_MOCK_COPY[angle]
  return (
    <div className="angle-mock">
      <div className={`angle-mock-caption angle-mock-caption-${size}`}>{text}</div>
    </div>
  )
}

const LOOKS: { title: Look; desc: string }[] = [
  { title: 'Circles + Photo', desc: 'Real photo proof, two circle insets.' },
  { title: 'Plain Text', desc: 'One strong cover, plain slides after.' },
  { title: 'Bold Stat', desc: 'A number takes over the frame.' },
]

// Real rendered screenshots of the actual /carousel skill templates (real fonts,
// real proportions, generic placeholder photo) -- not hand-drawn CSS mockups, so
// what a user picks here is what the template actually looks like.
const LOOK_PREVIEW: Record<Look, string> = {
  'Circles + Photo': '/template-previews/1-circles-photo.png',
  'Plain Text': '/template-previews/7-plain-text.png',
  'Bold Stat': '/template-previews/5-bold-stat.png',
}

function LookMockup({ look }: { look: Look }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="tpl-preview-img" src={LOOK_PREVIEW[look]} alt="" />
}

// Only "Circles + Photo" maps to more than one real /carousel skill template --
// this sub-step lets users pick exactly which one instead of leaving it to
// chat iteration after the fact (Jaylen: a bad first generation is a bigger
// turn-off than one more upfront choice).
const VARIANTS: { title: TemplateVariant; desc: string; preview: string }[] = [
  { title: 'Classic', desc: 'Full photo, two circle proofs, caption below.', preview: '/template-previews/1-circles-photo.png' },
  { title: 'Side by Side', desc: 'Two photos side by side, caption below.', preview: '/template-previews/2-side-by-side.png' },
  { title: 'Flipped', desc: 'Caption on top, photo below with proof circles.', preview: '/template-previews/3-flipped.png' },
  { title: 'Photo Column', desc: 'Photo column beside a text column.', preview: '/template-previews/4-photo-column.png' },
  { title: 'Editorial', desc: 'Full-bleed photo, caption sits right on it.', preview: '/template-previews/6-editorial.png' },
]

function VariantMockup({ variant }: { variant: TemplateVariant }) {
  const preview = VARIANTS.find((v) => v.title === variant)!.preview
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="tpl-preview-img" src={preview} alt="" />
}

type Attachment = { file: File; previewUrl: string }

export default function NewCarouselWizard({ hasBrandKit }: { hasBrandKit: boolean }) {
  const [step, setStep] = useState(0)
  const [format, setFormat] = useState<Format>('Post')
  const [formatTouched, setFormatTouched] = useState(false)
  const [angle, setAngle] = useState<Angle>('Value')
  const [angleTouched, setAngleTouched] = useState(false)
  const [look, setLook] = useState<Look>(RECOMMENDED_LOOK)
  const [lookTouched, setLookTouched] = useState(false)
  const [variantTouched, setVariantTouched] = useState(false)
  const [brief, setBrief] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [brandColors, setBrandColors] = useState<string[]>(['#5B7A5E', '#F1E6D2', '#16130f'])
  const [savingBrand, setSavingBrand] = useState(false)
  const [templateVariant, setTemplateVariant] = useState<TemplateVariant>('Classic')

  const effectiveLook = lookTouched ? look : RECOMMENDED_LOOK
  const hasVariantStep = effectiveLook === 'Circles + Photo'
  const brandColorStep = hasVariantStep ? 4 : 3
  const composerStep = 3 + (hasVariantStep ? 1 : 0) + (hasBrandKit ? 0 : 1)

  const stepTitle =
    step === 0 ? 'Choose a Format'
    : step === 1 ? 'Choose an Angle'
    : step === 2 ? 'Choose a Look'
    : hasVariantStep && step === 3 ? 'Choose a Style for Your Selected Look'
    : step === composerStep ? 'Tell Us Everything'
    : 'Add Your Brand Colors'

  function pickFormat(f: Format) {
    setFormat(f)
    setFormatTouched(true)
    setStep(1)
  }
  function pickAngle(a: Angle) {
    setAngle(a)
    setAngleTouched(true)
    setStep(2)
  }
  function pickLook(l: Look) {
    setLook(l)
    setLookTouched(true)
    setStep(3)
  }
  function pickVariant(v: TemplateVariant) {
    setTemplateVariant(v)
    setVariantTouched(true)
    setStep(hasBrandKit ? composerStep : brandColorStep)
  }

  async function handleContinueFromBrand() {
    setSavingBrand(true)
    await saveBrandKit({ colors: brandColors, voiceDescription: '' })
    setSavingBrand(false)
    setStep(composerStep)
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
      await createCarousel({
        angle,
        format,
        look: effectiveLook,
        templateVariant: hasVariantStep ? templateVariant : null,
        brief,
        referenceImageUrls: urls,
      })
    })
  }

  return (
    <section className="new-section wrap">
      <h1>{stepTitle}</h1>

      <div className="wizard-header-row">
        <button
          className="wizard-back"
          style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          ‹ Back
        </button>
        <div className="wizard-progress">
          {Array.from({ length: composerStep }).map((_, i) => (
            <span key={i} className={`wp-dot${step === i ? ' active' : ''}${step > i ? ' done' : ''}`} />
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 0 ? ' active' : ''}`}>
        <div className="pick-row">
          {FORMATS.map((f) => (
            <div
              key={f.title}
              className={`pick-card${formatTouched && format === f.title ? ' selected' : ''}`}
              onClick={() => pickFormat(f.title)}
            >
              <div className="pick-card-preview">
                <FormatMockup format={f.title} />
              </div>
              <div className="title">{f.title}</div>
              <div className="desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 1 ? ' active' : ''}`}>
        <div className="pick-row">
          {ANGLES.map((a) => (
            <div
              key={a.title}
              className={`pick-card${angleTouched && angle === a.title ? ' selected' : ''}`}
              onClick={() => pickAngle(a.title)}
            >
              <div className="pick-card-preview">
                <AngleMockup angle={a.title} />
              </div>
              <div className="title">{a.title}</div>
              <div className="desc">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 2 ? ' active' : ''}`}>
        <div className="pick-row">
          {LOOKS.map((l) => (
            <div
              key={l.title}
              className={`pick-card${lookTouched && look === l.title ? ' selected' : ''}`}
              onClick={() => pickLook(l.title)}
            >
              <div className="pick-card-preview">
                <LookMockup look={l.title} />
              </div>
              <div className="title">
                {l.title}
                {l.title === RECOMMENDED_LOOK && (
                  <span className="rec-badge show">Recommended</span>
                )}
              </div>
              <div className="desc">{l.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {hasVariantStep && (
        <div className={`wiz-step${step === 3 ? ' active' : ''}`}>
          <div className="pick-row">
            {VARIANTS.map((v) => (
              <div
                key={v.title}
                className={`pick-card${variantTouched && templateVariant === v.title ? ' selected' : ''}`}
                onClick={() => pickVariant(v.title)}
              >
                <div className="pick-card-preview">
                  <VariantMockup variant={v.title} />
                </div>
                <div className="title">{v.title}</div>
                <div className="desc">{v.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasBrandKit && (
        <div className={`wiz-step${step === brandColorStep ? ' active' : ''}`}>
          <p className="wiz-step-hint">
            Every carousel after this one will use these automatically — you can always change them later in Settings → Brand Kit.
          </p>
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
          <div className="wiz-step-actions">
            <button type="button" className="wizard-skip-btn" onClick={() => setStep(composerStep)}>
              Skip for now
            </button>
            <button type="button" className="wizard-continue-btn" onClick={handleContinueFromBrand} disabled={savingBrand}>
              {savingBrand ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      <div className={`wizard-composer${step >= composerStep ? ' show' : ''}`}>
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
