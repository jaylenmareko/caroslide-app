'use client'

import { useState, useTransition } from 'react'
import type { Angle, Format, Look } from '@/lib/types'
import { ANGLE_TO_LOOK } from '@/lib/types'
import { createCarousel } from '@/lib/actions'

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

const LOOKS: { title: Look; desc: string }[] = [
  { title: 'Circles + Photo', desc: 'Real photo proof, two circle insets.' },
  { title: 'Plain Text', desc: 'One strong cover, plain slides after.' },
  { title: 'Bold Stat', desc: 'A number takes over the frame.' },
]

export default function NewCarouselWizard() {
  const [step, setStep] = useState(0)
  const [format, setFormat] = useState<Format>('Post')
  const [angle, setAngle] = useState<Angle>('Value')
  const [look, setLook] = useState<Look>(ANGLE_TO_LOOK['Value'])
  const [lookTouched, setLookTouched] = useState(false)
  const [brief, setBrief] = useState('')
  const [isPending, startTransition] = useTransition()

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

  function handleGenerate() {
    startTransition(() => {
      createCarousel({ angle, format, look: effectiveLook, brief })
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
          <button aria-label="Generate" onClick={handleGenerate} disabled={isPending}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="new-hint">
          <b>{format}</b> · <b>{angle}</b> · <b>{effectiveLook}</b> selected — the more detail here, the less back-and-forth later.
        </p>
      </div>
    </section>
  )
}
