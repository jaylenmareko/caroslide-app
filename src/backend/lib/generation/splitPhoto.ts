import type { TemplateVariant } from '@/backend/lib/types'

const SPLIT_COUNT: Record<string, number> = { 'Split Two': 2, 'Split Three': 3, 'Split Four': 4 }

/** N evenly-spaced background-position X stops (0% .. 100%) for a Split-N TemplateVariant.
 * Paired with `background-size: {N*100}% 100%` in the template CSS, this is the standard
 * CSS sprite-strip technique: at stop i, the visible window is the i-th Nth of one image
 * stretched across N canvas-widths, so consecutive slides' edges line up exactly. */
export function splitPositionsFor(variant: TemplateVariant): string[] {
  const n = SPLIT_COUNT[variant]
  if (!n) throw new Error(`splitPositionsFor called with non-split variant: ${variant}`)
  return Array.from({ length: n }, (_, i) => `${((i / (n - 1)) * 100).toFixed(4).replace(/\.?0+%?$/, '')}%`)
}

export function splitCountFor(variant: TemplateVariant): number {
  const n = SPLIT_COUNT[variant]
  if (!n) throw new Error(`splitCountFor called with non-split variant: ${variant}`)
  return n
}
