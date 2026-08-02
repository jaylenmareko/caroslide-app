'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Reveal from './Reveal'


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

// The World Cup / Bangladesh entries below are real Caroslide output (2026-07-29) -- generated
// directly through the same pipeline real users hit, not hand-mocked like the rest of this array --
// swapped in for the old static mockups on those exact same two topics rather than kept alongside
// them, since showing both a fake and a real cover for the same story would just be confusing.
const MARQUEE_IMAGES = [
  '/mock/caroslide-the-odyssey.jpg',
  'https://egpbdcgaydmlfthqlkvb.supabase.co/storage/v1/object/public/carousel-slides/55e27047-6a04-4e3b-95ce-d265f19da75f/14f9778d-6399-4bd6-846e-55d972086dd8/slide-1.jpg',
  '/mock/caroslide-five-star-weekend.jpg', '/mock/caroslide-tiktok-emotions-trend.jpg',
  '/mock/caroslide-glitter-freckles.jpg', '/mock/caroslide-grok-4-5-launch.jpg', '/mock/caroslide-anthropic-valuation.jpg',
  'https://egpbdcgaydmlfthqlkvb.supabase.co/storage/v1/object/public/carousel-slides/55e27047-6a04-4e3b-95ce-d265f19da75f/4ac394e3-d91e-49f9-a101-7801e5987921/slide-1.jpg',
  '/mock/caroslide-grande-man.jpg', '/mock/caroslide-hotdog-summer.jpg', '/mock/caroslide-xiaomi-powerbank.jpg', '/mock/caroslide-dai-dai.jpg',
  '/mock/caroslide-spiderman-bnd.jpg', '/mock/caroslide-2016-trend.jpg', '/mock/caroslide-apple-openai-lawsuit.jpg',
]

// How many marquee images are actually visible at first paint on a normal screen -- these are the
// ones worth telling the browser to fetch early/first; the rest scroll into view later, so there's
// no "not instantly seeable" complaint to fix for them.
const MARQUEE_EAGER_COUNT = 6

// SEO/accessibility fix (2026-08-01): all 30 marquee <img>s (15 images, doubled for the seamless
// scroll loop) had alt="" -- confirmed live via a rendered-DOM query, not assumed. Derived from the
// src itself (the /mock/caroslide-<topic>.jpg naming convention already carries the real topic)
// rather than a second hand-written array of alt strings that could drift out of sync if images are
// ever added/removed here. The two real Supabase-hosted examples don't have a topic slug in their
// URL, so they get a distinct, still-accurate fallback.
function marqueeAlt(src: string): string {
  const match = src.match(/\/mock\/caroslide-(.+)\.jpg$/)
  if (!match) return 'Real AI-generated carousel example from Caroslide'
  const topic = match[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
  return `AI-generated carousel example: ${topic}`
}

function MarqueeRow({ images }: { images: string[] }) {
  const doubled = [...images, ...images]
  return (
    <div className="lp-marquee-zone">
      {/* Real fix (2026-07-28, Jaylen: "not instantly seeable... only update the loading speed, not
          size") -- same original files, same dimensions, nothing recompressed.
          Real finding, confirmed by inspecting the actual served HTML twice (not assumed): Next.js
          auto-hoists a <link rel=preload> for every server-rendered <img> regardless of
          fetchPriority -- setting fetchPriority (even explicitly to "auto") had no effect on WHICH
          images got preloaded, only on the (irrelevant, since all got one) attribute the link
          carried. loading="lazy" is the one that actually works: a browser-standard signal that
          overrides the auto-preload for that specific image, since eagerly preloading something
          you've also told the browser to lazy-load is a direct contradiction. Verified: this cut
          the real preload count from 16 down to 7 (the 6 eager marquee images + Step 3's first
          slide) -- checked the raw served HTML again after this change, not just reasoned about it. */}
      <div className="lp-marquee-track">
        {doubled.map((src, i) =>
          i < MARQUEE_EAGER_COUNT ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={marqueeAlt(src)} fetchPriority="high" loading="eager" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={marqueeAlt(src)} loading="lazy" />
          )
        )}
      </div>
    </div>
  )
}

const STEP3_SLIDES = [
  '/mock/five-star-weekend-1.jpg',
  '/mock/five-star-weekend-2.jpg',
  '/mock/five-star-weekend-3.jpg',
  '/mock/five-star-weekend-4.jpg',
  '/mock/five-star-weekend-5.jpg',
]

function Step3Carousel({ images }: { images: string[] }) {
  const [current, setCurrent] = useState(0)
  return (
    <div className="lp-carousel">
      <div className="lp-carousel-frame">
        {/* Same fix as MarqueeRow above -- original file, original dimensions, just fetched
            earlier/prioritized (no manual <link> needed here -- only ever one <img> mounted at a
            time, since it's keyed on `current`, so there's no sibling-image accidental-preload risk
            the marquee had; Next.js already auto-preloads this single eager <img> on its own). */}
        {current === 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[current]} alt={`Example carousel slide ${current + 1}`} fetchPriority="high" loading="eager" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[current]} alt={`Example carousel slide ${current + 1}`} />
        )}
        <button
          className="lp-carousel-arrow left"
          onClick={() => setCurrent((c) => (c - 1 + images.length) % images.length)}
          aria-label="Previous slide"
        >
          <svg viewBox="0 0 24 24" width={22} height={22} fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="lp-carousel-arrow right"
          onClick={() => setCurrent((c) => (c + 1) % images.length)}
          aria-label="Next slide"
        >
          <svg viewBox="0 0 24 24" width={22} height={22} fill="none">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="lp-carousel-dots">
        {images.map((_, i) => (
          <button
            key={i}
            className={`lp-carousel-dot${i === current ? ' active' : ''}`}
            onClick={() => setCurrent(i)}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  )
}

const FAQS = [
  {
    q: 'What is Caroslide and how does it work?',
    a: 'Pick a look, tell us what you want to post about — a topic, an idea, or a brand if you have one — and Caroslide writes the copy, designs the slides, and hands you five finished images, ready to post.',
  },
  {
    q: 'Do I need to write or design anything myself?',
    a: 'No — Caroslide handles the writing and design. But you still make the calls that matter: the look, and any change you want in chat afterward. You’re not filling in blanks, and you’re not stuck with the first draft either.',
  },
  {
    q: 'What if I don’t like the first draft?',
    a: 'Tell the chat what to change — "punchier hook on slide 2," "swap the CTA" — and it edits the draft in place. No re-generating from scratch.',
  },
  {
    q: 'Can I use my own brand colors?',
    a: 'Not manually yet — Caroslide picks colors that fit the mood of what you\'re posting about, and falls back to its own palette if there\'s no clear signal. Manual brand controls are on the roadmap.',
  },
  {
    q: 'How is this different from Canva or a template app?',
    a: 'Template tools hand you a blank layout. Full-auto tools hand you a finished post and hope it sounds like you. Caroslide sits in between — it writes, designs, and picks the photos, then lets you redirect anything in plain chat until it actually sounds like your brand.',
  },
]

// SEO audit fix (2026-08-01): the site had zero structured data anywhere (confirmed live via a
// rendered-DOM check, not just curl -- curl can miss client-injected schema, but this is genuinely
// absent either way). Built from FAQS itself, not a second hand-written copy, so the schema can
// never drift from what's actually visible on the page below. Pricing matches plans.ts exactly
// (Starter $15/mo, Pro $25/mo) -- no aggregateRating included since there's no real review data to
// back one; fabricating one would violate Google's structured-data guidelines.
const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

const SOFTWARE_APP_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Caroslide',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://caroslide.com',
  description: 'AI carousel generator for Instagram and social media -- writes the copy, designs the slides, and picks the photos from a topic or brief.',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Starter', price: '15', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro', price: '25', priceCurrency: 'USD' },
  ],
}

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APP_SCHEMA) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }} />
      <div className={`lp-nav-wrap${scrolled ? ' scrolled' : ''}`}>
        <nav className="lp-nav">
          <Link href="/" className="brand">
            <span>Caroslide</span>
          </Link>
          <div className="lp-nav-links">
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-nav-actions">
            <Link href="/login" className="lp-btn-ghost">Login</Link>
            <Link href="/login?mode=signup" className="lp-btn-solid">Sign Up</Link>
          </div>
        </nav>
      </div>

      <section className="lp-hero">
        <h1>
          <HeroWords text="The AI that makes your carousels for you." />
        </h1>
        <div className="lp-hero-cta">
          <span className="pill-label">Type anything you want to post about & watch what happens.</span>
          <form
            className="lp-hero-form"
            onSubmit={(e) => {
              e.preventDefault()
              window.location.href = `/login?mode=signup&topic=${encodeURIComponent(topic)}`
            }}
          >
            <input
              type="text"
              placeholder="What do you want?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <button type="submit" aria-label="Get started">
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
          <p className="lp-hero-microcopy">1 free carousel on signup — no credit card required.</p>
        </div>

        <MarqueeRow images={MARQUEE_IMAGES} />
      </section>

      <section className="lp-steps" id="how-it-works">
        <Reveal className="lp-steps-head">
          <h2>
            Real carousels, <span className="accent">not templates.</span>
          </h2>
          <p>Caroslide handles the writing, the design, and the format — you just pick the look.</p>
        </Reveal>

        <Reveal className="lp-step-row">
          <div className="lp-step-rail">
            <div className="lp-step-dot" />
            <div className="lp-step-line" />
          </div>
          <div className="lp-step-text">
            <span className="lp-step-badge">Step 1</span>
            <h3>Pick a look</h3>
          </div>
          <div className="lp-step-visual">
            <div className="lp-look-covers">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lp-look-cover-img" src="/template-previews/8-photo-grid.png" alt="Photo Focus, Photo Grid style" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lp-look-cover-img" src="/template-previews/6-editorial.png" alt="Photo Focus, Editorial style" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lp-look-cover-img" src="/template-previews/11-single-circle-left.png" alt="Circles + Photo, Spotlight Left style" />
            </div>
          </div>
        </Reveal>

        <Reveal className="lp-step-row">
          <div className="lp-step-rail">
            <div className="lp-step-dot" />
            <div className="lp-step-line" />
          </div>
          <div className="lp-step-text">
            <span className="lp-step-badge">Step 2</span>
            <h3>Tell us what you want</h3>
          </div>
          <div className="lp-step-visual">
            <div className="new-composer-box" style={{ marginBottom: 0 }}>
              <textarea rows={3} readOnly value="5 things nobody tells you about pricing your first product" />
              <div className="composer-bottom-row" style={{ justifyContent: 'flex-end' }}>
                <button className="composer-send-btn" disabled aria-label="Generate">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="lp-step-row">
          <div className="lp-step-rail">
            <div className="lp-step-dot" />
          </div>
          <div className="lp-step-text">
            <span className="lp-step-badge">Step 3</span>
            <h3>Get 5 slides, ready to post</h3>
          </div>
          <div className="lp-step-visual" style={{ display: 'flex', justifyContent: 'center' }}>
            <Step3Carousel images={STEP3_SLIDES} />
          </div>
        </Reveal>
      </section>

      <div className="lp-cta-bar-wrap">
        <Link href="/login?mode=signup" className="lp-cta-bar">Get Started For Free</Link>
      </div>

      <section className="lp-pricing" id="pricing">
        <Reveal>
          <h2>Simple pricing.</h2>
          <p className="lp-pricing-sub">1 carousel free when you sign up. Then pick the plan that fits how often you post.</p>
        </Reveal>
        <div className="lp-pricing-row">
          <Reveal className="lp-pricing-card">
            <span className="plan-badge">Starter</span>
            <div className="lp-pricing-amount">$15<span className="lp-pricing-period">/mo</span></div>
            <p className="lp-pricing-desc">10 carousels a month — every angle, format, and look.</p>
            <Link href="/login?mode=signup" className="lp-btn-ghost" style={{ display: 'block', textAlign: 'center' }}>Get Started</Link>
          </Reveal>
          <Reveal className="lp-pricing-card featured" delay={100}>
            <span className="plan-badge">Pro</span>
            <div className="lp-pricing-amount">$25<span className="lp-pricing-period">/mo</span></div>
            <p className="lp-pricing-desc">20 carousels a month — every angle, format, and look.</p>
            <Link href="/login?mode=signup" className="lp-btn-solid" style={{ display: 'block', textAlign: 'center' }}>Get Started</Link>
          </Reveal>
        </div>
        <p className="lp-pricing-footnote">Chat edits and iterations are always free — credits are only spent on new carousels. Need more in a given month? Buy a carousel pack any time, no upgrade required.</p>
      </section>

      <section className="lp-position">
        <Reveal>
          <span className="kicker">Why Caroslide</span>
          <h2>Everyone else gives you a template. We give you a carousel.</h2>
          <p>
            We looked at the other carousel tools out there. Every one of them hands you a template and expects
            you to write the copy, pick the photos, and design the layout yourself. Caroslide does all of that —
            you just pick the look.
          </p>
          <blockquote>
            &ldquo;They all have the same concept. They give a template and you do the rest. None have incorporated AI yet.&rdquo;
            <cite>— a real user, after trying three competitor carousel tools</cite>
          </blockquote>
        </Reveal>
      </section>

      <section className="lp-faq" id="faq">
        <Reveal>
          <h2>Frequently Asked Questions</h2>
        </Reveal>
        {FAQS.map((f, i) => (
          <Reveal key={i} delay={i * 60} className={`lp-faq-item${openFaq === i ? ' open' : ''}`}>
            <div className="lp-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
              {f.q}
              <span className="plus">+</span>
            </div>
            <div className="lp-faq-a">{f.a}</div>
          </Reveal>
        ))}
      </section>

      <footer className="lp-footer">
        <Link href="/" className="brand">
          <span>Caroslide</span>
        </Link>
        <div className="lp-footer-links">
          <Link href="/login">Sign In</Link>
          <a href="#how-it-works">How it works</a>
          <a href="#faq">FAQ</a>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="mailto:support@caroslide.com">Support</a>
        </div>
        <p className="copy">© {new Date().getFullYear()} Caroslide. All rights reserved.</p>
      </footer>
    </div>
  )
}
