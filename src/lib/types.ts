export type Angle = 'Value' | 'Growth' | 'Education'
export type Format = 'Post' | 'Square' | 'Story'
export type Look = 'Circles + Photo' | 'Plain Text' | 'Bold Stat' | 'Photo Focus'

// Circles + Photo, Bold Stat, and Photo Focus each map to more than one real
// /carousel skill template (see NewCarouselWizard.tsx's variantsFor()) -- Plain
// Text maps to exactly one (the pure-text keynote layout), so it's the only
// Look that skips this sub-choice.
export type TemplateVariant = 'Classic' | 'Side by Side' | 'Flipped' | 'Photo Column' | 'Editorial' | 'Photo Grid' | 'Split Flip' | 'Overlay'

export type Slide = {
  url: string
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
