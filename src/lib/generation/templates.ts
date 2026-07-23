import type { Look, TemplateVariant } from '@/lib/types'

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
