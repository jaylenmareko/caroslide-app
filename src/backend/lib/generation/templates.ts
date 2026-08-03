import type { Look, TemplateVariant } from '@/backend/lib/types'

// Mirrors NewCarouselWizard.tsx's variantsFor()/CIRCLES_VARIANTS/PHOTO_VARIANTS/STAT_VARIANTS
// exactly -- the wizard's Look+TemplateVariant pick already resolves which real
// .claude/skills/carousel/templates/*.html file a carousel uses (see
// initial-generation-behavior.md's "what's already decided" table). Don't re-derive this from
// the brief; it's a fixed lookup.
export function templateFileFor(look: Look, variant: TemplateVariant | null): string {
  if (look === 'Plain Text') return '7-keynote.html'
  // Bold Hook (added 2026-07-22) is a single-file Look, same as Plain Text -- no sub-variant to
  // pick, see NewCarouselWizard.tsx's hasVariantStep.
  if (look === 'Bold Hook') return '12-hook-block.html'
  // Photo Continuous deliberately has no branch here (2026-08-03 rebuild) -- it never reaches this
  // function at all. It routes through generateSplitPhotoCarousel (pipeline.ts), which resolves
  // its own per-slide file via photoContinuousTemplateFor below, not this Look-wide lookup. The old
  // single-file "Split Two/Three/Four" branch that used to live here was deleted once both
  // pipeline.ts (Task 4) and NewCarouselWizard.tsx (Task 6) stopped routing through it -- see that
  // plan's Task 6 for the deletion trigger.

  const map: Record<string, string> = {
    Classic: '1-cover-circles.html',
    Flipped: '3-flip.html',
    Spotlight: '11-single-circle.html',
    'Spotlight Left': '11-single-circle.html',
    'Side by Side': '2-split-cover.html',
    'Photo Column': '4-vertical-split.html',
    Editorial: '6-minimal-magazine.html',
    'Photo Grid': '8-photo-grid.html',
    'Split Flip': '9-split-flip.html',
    Overlay: '10-split-overlay.html',
  }
  const file = variant ? map[variant] : undefined
  if (!file) throw new Error(`No template mapped for Look=${look} TemplateVariant=${variant}`)
  return file
}

export const CTA_TEMPLATE = 'cta.html'

// Photo Continuous only (2026-08-03 rebuild): returns the one specific template file for a
// given (layout pattern, slide index) pair -- unlike every other Look, this one needs a
// different file per slide, not one file for the whole carousel. slideIndex is 0-based (0..4).
const LAYOUT_KEY: Record<string, string> = {
  'Edge Peek': 'edge',
  'Corner Peek': 'corner',
  'Big Overlap': 'big',
  Scatter: 'scatter',
}
export function photoContinuousTemplateFor(variant: TemplateVariant, slideIndex: number): string {
  const key = LAYOUT_KEY[variant]
  if (!key) throw new Error(`photoContinuousTemplateFor requires an Edge Peek/Corner Peek/Big Overlap/Scatter variant, got: ${variant}`)
  if (slideIndex < 0 || slideIndex > 4) throw new Error(`photoContinuousTemplateFor: slideIndex must be 0-4, got: ${slideIndex}`)
  return `${key}-slide${slideIndex + 1}.html`
}
