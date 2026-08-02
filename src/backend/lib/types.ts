export type Angle = 'Value' | 'Growth' | 'Education'
// Square and Story were removed 2026-07-23 (Jaylen: focus strictly on Post) -- never had real
// live usage (every test all build used Post), and Square/Story's character budgets were only
// ever a stopgap qualitative guess, never separately measured. 'Post' kept as a named type
// (not inlined everywhere) since Carousel.format still exists as a real column.
export type Format = 'Post'
export type Look = 'Circles + Photo' | 'Plain Text' | 'Bold Stat' | 'Photo Focus' | 'Bold Hook' | 'Photo Continuous'

// Circles + Photo, Bold Stat, and Photo Focus each map to more than one real
// /carousel skill template (see NewCarouselWizard.tsx's variantsFor()) -- Plain
// Text maps to exactly one (the pure-text keynote layout), so it's the only
// Look that skips this sub-choice.
export type TemplateVariant = 'Classic' | 'Side by Side' | 'Flipped' | 'Spotlight' | 'Spotlight Left' | 'Photo Column' | 'Editorial' | 'Photo Grid' | 'Split Flip' | 'Overlay' | 'Split Two' | 'Split Three' | 'Split Four'

// template/values are only set on AI-generated slides (what actually filled the template to
// produce `url`) -- absent on user-uploaded reference photos, which reuse this same type in
// Carousel.reference_images but were never rendered from a template at all. Optional, not
// required, so a raw upload doesn't need to fake them and old rows pre-dating this field don't
// need a migration/backfill -- see chat-editing-execution.md for why generated slides need this
// to make editing possible at all.
export type Slide = {
  url: string
  template?: string                // e.g. "1-cover-circles.html" -- which skill template rendered this
  values?: Record<string, string>  // the exact fill values used, so an edit has something to rewrite
}

export type Carousel = {
  id: string
  user_id: string
  title: string
  angle: Angle
  format: Format
  look: Look
  template_variant: TemplateVariant | null
  brief: string | null
  slides: Slide[]
  reference_images: Slide[]
  // Snapshotted from the wizard at creation time, not read live off brand_kits --
  // a user managing multiple brands needs THIS carousel's look to stick even if
  // their account default changes later, or if they overrode it just this once.
  brand_colors: string[] | null
  logo_url: string | null
  font: string | null
  // 2026-07-31 -- real generation runs in the background (ctx.waitUntil, see actions.ts's
  // createCarousel) so the initial request can redirect here almost instantly instead of holding
  // one HTTP request open for the full 2-3 minute pipeline (which Cloudflare's edge proxy can and
  // did kill mid-flight). 'generating' until the background write lands, then 'ready'/'failed'.
  status: 'generating' | 'ready' | 'failed'
  error_message: string | null
  created_at: string
  updated_at: string
}

export const MAX_ATTACHMENTS = 20
export const MAX_ATTACHMENT_MB = 5

export type BrandKit = {
  user_id: string
  colors: string[]
  logo_url: string | null
  voice_description: string | null
  font: string
  updated_at: string
}

export const DEFAULT_BRAND_FONT = 'Inter Tight'

// Curated Google Fonts for carousel headlines -- next/font/google needs static,
// build-time imports (see layout.tsx), so this list must match what's loaded there.
export const BRAND_FONTS: { name: string; cssVar: string }[] = [
  { name: 'Inter Tight', cssVar: 'var(--font-inter-tight)' },
  { name: 'Poppins', cssVar: 'var(--font-poppins)' },
  { name: 'Montserrat', cssVar: 'var(--font-montserrat)' },
  { name: 'Archivo Black', cssVar: 'var(--font-archivo-black)' },
  { name: 'DM Sans', cssVar: 'var(--font-dm-sans)' },
]

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} minutes ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`
  const weeks = Math.floor(days / 7)
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
}
