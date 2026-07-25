'use client'

import { useRef, useState, useTransition } from 'react'
import type { Angle, BrandKit, Look, TemplateVariant } from '@/lib/types'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_MB, BRAND_FONTS, DEFAULT_BRAND_FONT } from '@/lib/types'
import { createCarousel, saveBrandKit } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'

const RECOMMENDED_LOOK: Look = 'Circles + Photo'

const ANGLES: { title: Angle; desc: string }[] = [
  { title: 'Value', desc: 'Direct tips, no story.' },
  { title: 'Growth', desc: 'A hook that builds into a story.' },
  { title: 'Education', desc: 'A real fact, explained.' },
]


const LOOKS: { title: Look; desc: string }[] = [
  { title: 'Circles + Photo', desc: 'Real photo proof, two circle insets.' },
  { title: 'Photo Focus', desc: 'Clean photo layouts, no circles or stat.' },
  { title: 'Plain Text', desc: 'One strong cover, plain slides after.' },
  { title: 'Bold Stat', desc: 'A number takes over the frame.' },
  { title: 'Bold Hook', desc: 'No photo -- a punchy hook headline on a bold color block.' },
]

// Real rendered screenshots of the actual /carousel skill templates (real fonts,
// real proportions, generic placeholder photo) -- not hand-drawn CSS mockups, so
// what a user picks here is what the template actually looks like.
const LOOK_PREVIEW: Record<Look, string> = {
  'Circles + Photo': '/template-previews/1-circles-photo.png',
  'Photo Focus': '/template-previews/2-side-by-side.png',
  'Plain Text': '/template-previews/7-plain-text.png',
  'Bold Stat': '/template-previews/5-bold-stat.png',
  'Bold Hook': '/template-previews/12-hook-block.png',
}

function LookMockup({ look }: { look: Look }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="tpl-preview-img" src={LOOK_PREVIEW[look]} alt="" />
}

// Circles + Photo, Photo Focus, and Bold Stat each map to more than one real
// /carousel skill template -- this sub-step lets users pick exactly which one
// instead of leaving it to chat iteration after the fact (Jaylen: a bad first
// generation is a bigger turn-off than one more upfront choice). Plain Text
// maps to exactly one template (the pure-text keynote layout), so it's the
// only Look that skips this step.
//
// Side by Side / Photo Column / Editorial don't actually have circles, so they
// live under their own "Photo Focus" Look rather than Circles + Photo, which
// now means exactly what its name says (Classic + Flipped, the two that use
// circle proofs). Bold Stat reuses those same three layouts with a big-stat
// caption instead of a plain one -- that's a content-emphasis choice, not a
// naming mismatch, so it keeps its own copies.
const CIRCLES_VARIANTS: { title: TemplateVariant; desc: string; preview: string }[] = [
  { title: 'Classic', desc: 'Full photo, two circle proofs, caption below.', preview: '/template-previews/1-circles-photo.png' },
  { title: 'Flipped', desc: 'Caption on top, photo below with proof circles.', preview: '/template-previews/3-flipped.png' },
  { title: 'Spotlight', desc: 'Full-bleed photo, one circle inset in the corner, caption right on it.', preview: '/template-previews/11-single-circle.png' },
  { title: 'Spotlight Left', desc: 'Same as Spotlight, mirrored — circle inset on the left instead.', preview: '/template-previews/11-single-circle-left.png' },
]

const PHOTO_VARIANTS: { title: TemplateVariant; desc: string; preview: string }[] = [
  { title: 'Side by Side', desc: 'Two photos side by side, caption below.', preview: '/template-previews/2-side-by-side.png' },
  { title: 'Photo Column', desc: 'Photo column beside a text column.', preview: '/template-previews/4-photo-column.png' },
  { title: 'Editorial', desc: 'Full-bleed photo, caption sits right on it.', preview: '/template-previews/6-editorial.png' },
  { title: 'Photo Grid', desc: 'One large photo plus two stacked, caption above.', preview: '/template-previews/8-photo-grid.png' },
  { title: 'Split Flip', desc: 'Caption on top, two photos split below.', preview: '/template-previews/9-split-flip.png' },
  { title: 'Overlay', desc: 'Two photos split full-bleed, caption on a bottom scrim.', preview: '/template-previews/10-split-overlay.png' },
]

const STAT_VARIANTS: { title: TemplateVariant; desc: string; preview: string }[] = [
  { title: 'Side by Side', desc: 'Two photos side by side, a giant stat number below.', preview: '/template-previews/2-side-by-side-stat.png' },
  { title: 'Photo Column', desc: 'Full-height photo beside a giant stat number.', preview: '/template-previews/4-photo-column-stat.png' },
  { title: 'Editorial', desc: 'Full-bleed photo, a giant stat number sits right on it.', preview: '/template-previews/6-editorial-stat.png' },
  { title: 'Photo Grid', desc: 'One large photo plus two stacked, a giant stat number above.', preview: '/template-previews/8-photo-grid-stat.png' },
  { title: 'Split Flip', desc: 'A giant stat number on top, two photos split below.', preview: '/template-previews/9-split-flip-stat.png' },
]

function variantsFor(look: Look) {
  if (look === 'Bold Stat') return STAT_VARIANTS
  if (look === 'Photo Focus') return PHOTO_VARIANTS
  return CIRCLES_VARIANTS
}

function VariantMockup({ look, variant }: { look: Look; variant: TemplateVariant }) {
  const preview = variantsFor(look).find((v) => v.title === variant)!.preview
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="tpl-preview-img" src={preview} alt="" />
}

type Attachment = { file: File; previewUrl: string }

export default function NewCarouselWizard({
  existingBrandKit,
  initialBrief,
}: {
  existingBrandKit: BrandKit | null
  initialBrief?: string
}) {
  const [step, setStep] = useState(0)
  const [angle, setAngle] = useState<Angle>('Value')
  const [angleTouched, setAngleTouched] = useState(false)
  const [look, setLook] = useState<Look>(RECOMMENDED_LOOK)
  const [lookTouched, setLookTouched] = useState(false)
  const [variantTouched, setVariantTouched] = useState(false)
  // Split into title (primary) + context (optional, secondary) 2026-07-25 -- real user feedback:
  // a tester who picked an Angle card by look alone said in chat she just wanted to type a title
  // and have it made. The old single textarea's placeholder ("Give us as much context as
  // possible: brand colors, photos, links, tone...") oversold the effort actually needed --
  // generateCarousel already does its own research on a thin/empty brief (see
  // initial-generation-behavior.md), nothing here ever required more than a title. No backend
  // change needed, just matching the UI's ask to what the pipeline already handles: title is
  // real input, context is genuinely optional and visually secondary, not a demand.
  const [title, setTitle] = useState(initialBrief ?? '')
  const [context, setContext] = useState('')
  const brief = context.trim() ? `${title.trim()}\n\nAdditional context: ${context.trim()}` : title.trim()
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Pre-filled from the account's saved default (if any) so returning users see
  // their real brand immediately -- this step shows on every carousel, not just
  // the first, so a multi-brand user can still change any of it just for this
  // one project without a detour to Settings. See Carousel.brand_colors's comment
  // in types.ts for why this gets snapshotted onto the carousel itself too.
  const [brandColors, setBrandColors] = useState<string[]>(existingBrandKit?.colors ?? ['#5B7A5E', '#F1E6D2', '#16130f'])
  const [logoUrl, setLogoUrl] = useState<string | null>(existingBrandKit?.logo_url ?? null)
  const [font, setFont] = useState(existingBrandKit?.font ?? DEFAULT_BRAND_FONT)
  // Real bug fixed 2026-07-25: brandColors/font above always hold SOME value -- either a real
  // saved default or a placeholder fallback -- with nothing distinguishing "the user's actual
  // choice" from "never touched." handleContinueFromBrand used to save whatever was in state
  // unconditionally, which meant leaving colors alone and only picking a font silently wrote the
  // hardcoded placeholder green/cream/black into the account's real brand_kits row as if it had
  // been chosen. logoUrl doesn't need this -- its untouched default (null) IS the correct "no
  // logo" state, not a fake stand-in value.
  const [colorsTouched, setColorsTouched] = useState(false)
  const [fontTouched, setFontTouched] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [savingBrand, setSavingBrand] = useState(false)
  const [templateVariant, setTemplateVariant] = useState<TemplateVariant>('Classic')

  const effectiveLook = lookTouched ? look : RECOMMENDED_LOOK
  const hasVariantStep = effectiveLook !== 'Plain Text' && effectiveLook !== 'Bold Hook'
  const brandColorStep = hasVariantStep ? 3 : 2
  const composerStep = 2 + (hasVariantStep ? 1 : 0) + 1

  const stepTitle =
    step === 0 ? 'Choose an Angle'
    : step === 1 ? 'Choose a Look'
    : hasVariantStep && step === 2 ? 'Choose a Style for Your Selected Look'
    : step === composerStep ? 'What\'s This About?'
    : 'Add Your Brand Kit'

  function pickAngle(a: Angle) {
    setAngle(a)
    setAngleTouched(true)
    setStep(1)
  }
  function pickLook(l: Look) {
    setLook(l)
    setLookTouched(true)
    setStep(2)
  }
  function pickVariant(v: TemplateVariant) {
    setTemplateVariant(v)
    setVariantTouched(true)
    setStep(brandColorStep)
  }

  async function handleContinueFromBrand() {
    setSavingBrand(true)
    // Only persist a field the user actually touched -- an untouched field is either a real saved
    // default (skip is a no-op, the DB already matches) or this step's placeholder fallback (skip
    // is required, or the placeholder gets saved as if it were a real choice). logoUrl is always
    // safe to send: its untouched default (null) is a genuine "no logo," not a stand-in value.
    await saveBrandKit({
      ...(colorsTouched ? { colors: brandColors } : {}),
      logoUrl,
      ...(fontTouched ? { font } : {}),
    })
    setSavingBrand(false)
    setStep(composerStep)
  }

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
    setGenerateError(null)
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
      try {
        await createCarousel({
          angle,
          format: 'Post',
          look: effectiveLook,
          templateVariant: hasVariantStep ? templateVariant : null,
          brief,
          referenceImageUrls: urls,
          // Whatever's currently set here -- prefilled default, edited for just
          // this one, or brand new -- is what this carousel uses, independent of
          // whether it also got saved as the account's new default below.
          brandColors,
          logoUrl,
          font,
        })
      } catch (err) {
        // createCarousel redirects on success, which Next.js implements by throwing
        // an internal NEXT_REDIRECT error -- let that one propagate, don't swallow it.
        if (err && typeof err === 'object' && 'digest' in err && typeof err.digest === 'string' && err.digest.startsWith('NEXT_REDIRECT')) {
          throw err
        }
        setGenerateError("Something went wrong creating your carousel — try again.")
      }
    })
  }

  return (
    <section className="new-section wrap">
      <button
        className="wizard-back"
        style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
        onClick={() => setStep((s) => Math.max(0, s - 1))}
      >
        ‹ Back
      </button>

      <div className="wizard-header-row">
        <h1>{stepTitle}</h1>
        <div className="wizard-progress">
          {Array.from({ length: composerStep }).map((_, i) => (
            <span key={i} className={`wp-dot${step === i ? ' active' : ''}${step > i ? ' done' : ''}`} />
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 0 ? ' active' : ''}`}>
        <div className="pick-row">
          {ANGLES.map((a) => (
            <div
              key={a.title}
              className={`pick-card pick-card-angle${angleTouched && angle === a.title ? ' selected' : ''}`}
              onClick={() => pickAngle(a.title)}
            >
              {/* Example caption removed entirely (2026-07-25, Jaylen) -- title/desc are the
                  card's only content now. .pick-card-angle only restores the card's original
                  height/padding (it looked too thin without the mockup box filling it out) --
                  text stays the same plain left-aligned size/position as every other step, no
                  centering or font-size changes this time. */}
              <div className="title">{a.title}</div>
              <div className="desc">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 1 ? ' active' : ''}`}>
        <div className="pick-row pick-row-2col">
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
        <div className={`wiz-step${step === 2 ? ' active' : ''}`}>
          <div className="variant-look-context">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="variant-look-context-thumb" src={LOOK_PREVIEW[effectiveLook]} alt="" />
            <div>
              <div className="variant-look-context-label">Your Look</div>
              <div className="variant-look-context-name">{effectiveLook}</div>
            </div>
          </div>
          <div className="pick-row pick-row-2col">
            {variantsFor(effectiveLook).map((v) => (
              <div
                key={v.title}
                className={`pick-card${variantTouched && templateVariant === v.title ? ' selected' : ''}`}
                onClick={() => pickVariant(v.title)}
              >
                <div className="pick-card-preview">
                  <VariantMockup look={effectiveLook} variant={v.title} />
                </div>
                <div className="title">{v.title}</div>
                <div className="desc">{v.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`wiz-step${step === brandColorStep ? ' active' : ''}`}>
        <p className="wiz-step-hint">
          Your default brand kit. Edit it here just for this carousel, or update it anytime in Settings → Brand Kit.
        </p>

        <div className="brandkit-grid">
          <div className="brandkit-card">
            <div className="brandkit-card-label">Logo<span className="brandkit-optional">optional</span></div>
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
              <div className="brand-logo-upload" onClick={handleLogoClick} style={{ marginBottom: 0 }}>
                {uploadingLogo ? 'Uploading…' : 'Drop your logo here, or click to upload'}
              </div>
            )}
            {logoError && <p className="attach-limit-error">{logoError}</p>}
          </div>

          <div className="brandkit-card">
            <div className="brandkit-card-label">Colors</div>
            <div className="brand-color-picker">
              {brandColors.map((c, i) => (
                <div key={i} className="brand-color-card">
                  <div className="brand-color-label">Color {i + 1}</div>
                  <label className="color-swatch-input" style={{ background: c }}>
                    <input
                      type="color"
                      value={c}
                      aria-label={`Brand color ${i + 1}`}
                      onChange={(e) => {
                        const next = [...brandColors]
                        next[i] = e.target.value
                        setBrandColors(next)
                        setColorsTouched(true)
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
                      setColorsTouched(true)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="brandkit-card">
            <div className="brandkit-card-label">Font</div>
            <div className="brand-font-row" style={{ marginBottom: 0 }}>
              {BRAND_FONTS.map((f) => (
                <button
                  type="button"
                  key={f.name}
                  className={`brand-font-chip${font === f.name ? ' selected' : ''}`}
                  style={{ fontFamily: f.cssVar }}
                  onClick={() => {
                    setFont(f.name)
                    setFontTouched(true)
                  }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="wiz-step-actions" style={{ marginTop: 24 }}>
          <button type="button" className="wizard-skip-btn" onClick={() => setStep(composerStep)}>
            Skip for now
          </button>
          <button type="button" className="wizard-continue-btn" onClick={handleContinueFromBrand} disabled={savingBrand}>
            {savingBrand ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>

      <div className={`wizard-composer${step >= composerStep ? ' show' : ''}`}>
        <div className="new-composer-box">
          <div className="composer-field">
            <label className="composer-field-label" htmlFor="wizard-title">Carousel Title</label>
            <input
              id="wizard-title"
              type="text"
              className="composer-title-input"
              placeholder="e.g. 5 things nobody tells you about pricing your first product"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="composer-field composer-field-context">
            <label className="composer-field-label" htmlFor="wizard-context">
              Additional Context <span className="composer-field-optional">(optional)</span>
            </label>
            <textarea
              id="wizard-context"
              rows={2}
              className="composer-context-input"
              placeholder="Any notes — e.g. 'keep tone light', 'focus on actionable tips', 'target audience is startup founders'"
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>

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
              className={`composer-send-btn${isPending || uploading ? ' pending' : ''}`}
              aria-label="Generate"
              onClick={handleGenerate}
              disabled={isPending || uploading}
            >
              {isPending || uploading ? (
                <span className="composer-spinner" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
          {attachError && <p className="attach-limit-error">{attachError}</p>}
          {generateError && <p className="attach-limit-error">{generateError}</p>}
          {isPending && !uploading && (
            <p className="wiz-step-hint" style={{ margin: '10px 0 0' }}>
              Writing and rendering your carousel — this takes a bit longer than a normal message,
              hang tight…
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
