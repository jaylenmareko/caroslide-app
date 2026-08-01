'use client'

import { useState, useTransition } from 'react'
import type { Look, TemplateVariant } from '@/backend/lib/types'
import { createCarousel } from '@/backend/lib/actions'

const RECOMMENDED_LOOK: Look = 'Circles + Photo'

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

export default function NewCarouselWizard({
  initialBrief,
}: {
  initialBrief?: string
}) {
  const [step, setStep] = useState(0)
  const [look, setLook] = useState<Look>(RECOMMENDED_LOOK)
  const [lookTouched, setLookTouched] = useState(false)
  const [variantTouched, setVariantTouched] = useState(false)
  // Single field (2026-08-02) -- matches the landing page's own hero input exactly, one pill-shaped
  // box + a send button, no separate optional-context field. generateCarousel already does its own
  // research on a thin/empty brief (see initial-generation-behavior.md), so a bare topic is enough.
  const [title, setTitle] = useState(initialBrief ?? '')
  const brief = title.trim()
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [templateVariant, setTemplateVariant] = useState<TemplateVariant>('Classic')

  const effectiveLook = lookTouched ? look : RECOMMENDED_LOOK
  const hasVariantStep = effectiveLook !== 'Plain Text' && effectiveLook !== 'Bold Hook'
  // Brand Kit step removed for v1 (2026-08-01, Jaylen's direction) -- colors are now inferred
  // from the brief (classifyColors, actions.ts), font always defaults, and logo is either the
  // Caroslide wordmark (free) or blank (paid), decided server-side by plan status. Composer
  // follows Look (+ Variant, if this Look has one) directly.
  const composerStep = hasVariantStep ? 2 : 1

  const stepTitle =
    step === 0 ? 'Choose a Look'
    : hasVariantStep && step === 1 ? 'Choose a Style for Your Selected Look'
    : 'What Do You Want?'

  function pickLook(l: Look) {
    setLook(l)
    setLookTouched(true)
    setStep(1)
  }
  function pickVariant(v: TemplateVariant) {
    setTemplateVariant(v)
    setVariantTouched(true)
    setStep(composerStep)
  }

  function handleGenerate() {
    setGenerateError(null)
    startTransition(async () => {
      try {
        await createCarousel({
          format: 'Post',
          look: effectiveLook,
          templateVariant: hasVariantStep ? templateVariant : null,
          brief,
          // Attach-photos removed for v1 (2026-08-01) -- always empty now; generateCarousel
          // already sources its own photos when none are given (see initial-generation-behavior.md).
          referenceImageUrls: [],
        })
      } catch (err) {
        // createCarousel redirects on success, which Next.js implements by throwing
        // an internal NEXT_REDIRECT error -- let that one propagate, don't swallow it.
        if (err && typeof err === 'object' && 'digest' in err && typeof err.digest === 'string' && err.digest.startsWith('NEXT_REDIRECT')) {
          throw err
        }
        // createCarousel throws specific, actionable messages (e.g. the free/plan limit
        // reached) that the user needs to actually see -- only fall back to the generic
        // message for genuinely unexpected error shapes.
        setGenerateError(err instanceof Error ? err.message : "Something went wrong creating your carousel — try again.")
      }
    })
  }

  return (
    <section className="new-section wrap">
      <div className="wizard-header-row">
        <h1>{stepTitle}</h1>
        <div className="wizard-progress">
          {Array.from({ length: composerStep }).map((_, i) => (
            <span key={i} className={`wp-dot${step === i ? ' active' : ''}${step > i ? ' done' : ''}`} />
          ))}
        </div>
      </div>

      <div className={`wiz-step${step === 0 ? ' active' : ''}`}>
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
            </div>
          ))}
        </div>
      </div>

      {hasVariantStep && (
        <div className={`wiz-step${step === 1 ? ' active' : ''}`}>
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
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`wizard-composer${step >= composerStep ? ' show' : ''}`}>
        <form
          className="wizard-hero-form"
          onSubmit={(e) => {
            e.preventDefault()
            handleGenerate()
          }}
        >
          <input
            type="text"
            placeholder="What do you want?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="submit"
            className={`composer-send-btn${isPending ? ' pending' : ''}`}
            aria-label="Generate"
            disabled={isPending}
          >
            {isPending ? (
              <span className="composer-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </form>
        {generateError && <p className="attach-limit-error">{generateError}</p>}
        {isPending && (
          <p className="wiz-step-hint" style={{ margin: '10px 0 0' }}>
            Setting up your carousel…
          </p>
        )}
      </div>

      <button
        className="wizard-back"
        style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
        onClick={() => setStep((s) => Math.max(0, s - 1))}
      >
        ‹ Back
      </button>
    </section>
  )
}
