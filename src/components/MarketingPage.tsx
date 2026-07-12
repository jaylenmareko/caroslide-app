'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'


function HeroWords({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="lp-word" style={{ animationDelay: `${i * 0.06}s` }}>
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

const MARQUEE_IMAGES = [
  '/mock/wagyu-founder.jpg', '/mock/swipemaxx-tinder.jpg', '/mock/ranchpad-succession.jpg',
  '/mock/wagyu-seedoil.jpg', '/mock/swipemaxx-dating.jpg', '/mock/ranchpad-lawsuit.jpg',
]

function MarqueeRow({ images }: { images: string[] }) {
  const doubled = [...images, ...images]
  return (
    <div className="lp-marquee-zone">
      <div className="lp-marquee-track">
        {doubled.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt="" />
        ))}
      </div>
    </div>
  )
}

const FAQS = [
  {
    q: 'What is Caroslide and how does it work?',
    a: 'Pick an angle (Value, Growth, or Education), a format, and a look. Tell us about your brand. Caroslide writes the copy, designs the slides, and hands you five finished images — ready to post.',
  },
  {
    q: 'Do I need to write or design anything myself?',
    a: 'No. That’s the difference between Caroslide and a template tool — you give us the topic, we give you the finished carousel, not a blank template to fill in.',
  },
  {
    q: 'What if I don’t like the first draft?',
    a: 'Tell the chat what to change — "punchier hook on slide 2," "swap the CTA" — and it edits the draft in place. No re-generating from scratch.',
  },
  {
    q: 'Which formats does Caroslide support?',
    a: 'Post (feed carousel), Square (feed or LinkedIn), and Story — pick whichever fits where you’re posting.',
  },
  {
    q: 'Can I use my own brand colors and photos?',
    a: 'Yes — attach reference photos and describe your brand colors/voice in the composer, or save them once in Settings → Brand Kit so every new carousel starts pre-filled.',
  },
  {
    q: 'How is this different from Canva or a template app?',
    a: 'Template tools give you a layout and expect you to write the copy and pick the photos yourself. Caroslide generates the whole thing — copy, layout, and photo selection — from a topic.',
  },
]

export default function MarketingPage() {
  const [topic, setTopic] = useState('')
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="lp">
      <div className={`lp-nav-wrap${scrolled ? ' scrolled' : ''}`}>
        <nav className="lp-nav">
          <Link href="/" className="brand">
            <span>Caroslide</span>
          </Link>
          <div className="lp-nav-links">
            <Link href="/#pricing">Pricing</Link>
            <Link href="/#faq">FAQ</Link>
          </div>
          <div className="lp-nav-actions">
            <Link href="/login" className="lp-btn-ghost">Sign In</Link>
            <Link href="/login" className="lp-btn-solid">Get Started</Link>
          </div>
        </nav>
      </div>

      <section className="lp-hero">
        <h1>
          <HeroWords text="The AI that makes your posts for you." />
        </h1>
        <p className="lp-hero-sub">
          Caroslide turns a topic into a finished carousel — real slides, in your brand, not a template you fill in yourself.
        </p>
        <div className="lp-hero-cta">
          <span className="pill-label">Drop your topic or brand & watch what happens.</span>
          <form
            className="lp-hero-form"
            onSubmit={(e) => {
              e.preventDefault()
              window.location.href = `/login?topic=${encodeURIComponent(topic)}`
            }}
          >
            <input
              type="text"
              placeholder="e.g. wagyuwellnessco.com, or paste a topic…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <button type="submit" aria-label="Get started">
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
          <p className="lp-hero-microcopy">
            No brand yet? <Link href="/login">Just tell us about it</Link>
          </p>
        </div>

        <MarqueeRow images={MARQUEE_IMAGES} />
      </section>

      <section className="lp-steps" id="how-it-works">
        <div className="lp-steps-head">
          <h2>
            Real carousels, <span className="accent">not templates.</span>
          </h2>
          <p>Caroslide handles the writing, the design, and the format — you just pick the angle.</p>
        </div>

        <div className="lp-step-row">
          <div className="lp-step-rail">
            <div className="lp-step-dot" />
            <div className="lp-step-line" />
          </div>
          <div className="lp-step-text">
            <span className="lp-step-badge">Step 1</span>
            <h3>Pick your angle</h3>
            <p>Value, Growth, or Education — plus the format and look that fits what you&apos;re posting.</p>
          </div>
          <div className="lp-step-visual">
            <div className="pick-row" style={{ marginBottom: 0 }}>
              <div className="pick-card selected"><div className="title">Value</div><div className="desc">Direct tips, no story.</div></div>
              <div className="pick-card"><div className="title">Growth</div><div className="desc">A hook that builds into a story.</div></div>
              <div className="pick-card"><div className="title">Education</div><div className="desc">A real fact, explained.</div></div>
            </div>
          </div>
        </div>

        <div className="lp-step-row">
          <div className="lp-step-rail">
            <div className="lp-step-dot" />
            <div className="lp-step-line" />
          </div>
          <div className="lp-step-text">
            <span className="lp-step-badge">Step 2</span>
            <h3>Tell us everything</h3>
            <p>Brand colors, photos, links, tone — the more you give us, the less back-and-forth later.</p>
          </div>
          <div className="lp-step-visual">
            <div className="new-composer-box" style={{ marginBottom: 0 }}>
              <textarea rows={3} readOnly value="Cream + forest-green earth tones. Minimal, confident, a little playful — never corporate-stiff." />
              <div className="composer-bottom-row">
                <button type="button" className="composer-attach-btn" disabled>
                  <svg viewBox="0 0 24 24" fill="none"><path d="M21 12.5V7a4 4 0 0 0-4-4h-1M3 11.5V17a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-1M9 3H8a4 4 0 0 0-4 4v5M8 13l2.5-2.5a2 2 0 0 1 2.8 0L17 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /></svg>
                  Attach photos
                </button>
                <button className="composer-send-btn" disabled aria-label="Generate">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="lp-step-row">
          <div className="lp-step-rail">
            <div className="lp-step-dot" />
            <div className="lp-step-line" />
          </div>
          <div className="lp-step-text">
            <span className="lp-step-badge">Step 3</span>
            <h3>Get 5 slides, ready to post</h3>
            <p>No template to fill in — real, finished slides in your brand, in about a minute.</p>
          </div>
          <div className="lp-step-visual" style={{ display: 'flex', justifyContent: 'center' }}>
            <div className="stage" style={{ width: 200 }}>
              <div className="stage-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/mock/wagyuvalue-1.jpg" alt="Example carousel slide" />
              </div>
            </div>
          </div>
        </div>

        <div className="lp-step-row">
          <div className="lp-step-rail">
            <div className="lp-step-dot" />
          </div>
          <div className="lp-step-text">
            <span className="lp-step-badge">Step 4</span>
            <h3>Iterate until it&apos;s right</h3>
            <p>Chat to fix a hook, swap a CTA, or reorder a slide — no re-generating from scratch.</p>
          </div>
          <div className="lp-step-visual">
            <div className="chat-box" style={{ margin: 0, maxWidth: 'none' }}>
              <input type="text" readOnly placeholder="e.g. slide 3: punchier hook, swap the CTA…" />
              <button aria-label="Send" disabled>
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="lp-cta-bar-wrap">
        <Link href="/login" className="lp-cta-bar">Get Started For Free</Link>
      </div>

      <section className="lp-pricing" id="pricing">
        <h2>Simple pricing.</h2>
        <p className="lp-pricing-sub">Start free. Upgrade when you&apos;re posting enough that it&apos;s worth it.</p>
        <div className="lp-pricing-row">
          <div className="lp-pricing-card">
            <span className="plan-badge">Free</span>
            <div className="lp-pricing-amount">$0</div>
            <p className="lp-pricing-desc">3 carousels a month — every angle, format, and look.</p>
            <Link href="/login" className="lp-btn-ghost" style={{ display: 'block', textAlign: 'center' }}>Get Started</Link>
          </div>
          <div className="lp-pricing-card featured">
            <span className="plan-badge">Pro</span>
            <div className="lp-pricing-amount">Coming soon</div>
            <p className="lp-pricing-desc">Unlimited carousels, priority generation, and a saved Brand Kit.</p>
            <Link href="/login" className="lp-btn-solid" style={{ display: 'block', textAlign: 'center' }}>Get Notified</Link>
          </div>
        </div>
      </section>

      <section className="lp-position">
        <span className="kicker">Why Caroslide</span>
        <h2>Everyone else gives you a template. We give you a carousel.</h2>
        <p>
          We looked at the other carousel tools out there. Every one of them hands you a template and expects
          you to write the copy, pick the photos, and design the layout yourself. Caroslide does all of that —
          you just pick the angle.
        </p>
        <blockquote>
          &ldquo;They all have the same concept. They give a template and you do the rest. None have incorporated AI yet.&rdquo;
          <cite>— a real user, after trying three competitor carousel tools</cite>
        </blockquote>
      </section>

      <section className="lp-faq" id="faq">
        <h2>Frequently Asked Questions</h2>
        {FAQS.map((f, i) => (
          <div key={i} className={`lp-faq-item${openFaq === i ? ' open' : ''}`}>
            <div className="lp-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
              {f.q}
              <span className="plus">+</span>
            </div>
            <div className="lp-faq-a">{f.a}</div>
          </div>
        ))}
      </section>

      <footer className="lp-footer">
        <Link href="/" className="brand">
          <span>Caroslide</span>
        </Link>
        <div className="lp-footer-links">
          <Link href="/login">Sign In</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#faq">FAQ</Link>
        </div>
        <p className="copy">© {new Date().getFullYear()} Caroslide. All rights reserved.</p>
      </footer>
    </div>
  )
}
