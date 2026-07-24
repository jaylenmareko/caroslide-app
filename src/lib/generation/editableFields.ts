// Click-in-place editor support (2026-07-22). Rather than hand-annotating all 13 template files
// with data-field attributes (real risk of quietly breaking a template already debugged tonight),
// this is a single central map of CSS selector -> field name per template file. The live editor
// (SlideCanvasEditor.tsx) renders the slide's real filled HTML in an iframe and uses this map to
// find the right DOM node for each field, rather than parsing/guessing from markup.
//
// Only fields with a single unambiguous DOM node are listed here. A few fields are deliberately
// left OUT because they're not a simple text/photo swap:
// - CIRCLE_BLOCK (4-vertical-split.html, 5-stat-takeover.html) is a whole pre-built HTML blob
//   placeholder (the entire circle + tag markup, optionally entirely absent), not a single element
//   to point at -- still editable via chat, just not click-in-place for v1.
//
// 'text' fields become contenteditable in the iframe. 'photo-img' fields are real <img> elements
// (set .src directly). 'photo-bg' fields are a div whose CSS background-image carries the photo
// (1-cover-circles.html's .photo, 6/11's outer .photo wrapper is itself just a positioning div --
// only 1-cover-circles.html actually uses the CSS-background-image pattern; the rest use a real
// <img> even when the field name looks similar).
export type EditableFieldKind = 'text' | 'photo-img' | 'photo-bg'

// movable (2026-07-24, Jaylen): text and circle-photo elements can be dragged to a new position in
// the click-in-place editor; main/background photos deliberately cannot -- they fill a fixed-size
// container by design (the photo IS part of the Look), so moving one would just leave an empty gap
// where the Look expects it full-bleed. Position is stored as a `{FIELD}_POS_X`/`{FIELD}_POS_Y`
// pixel-offset pair (a relative translate, not an absolute coordinate -- works the same regardless
// of whatever the template's own default position is) -- derived mechanically from `field`, no
// separate property needed. `sizeField` is set only on text fields that should also get a bounded
// font-size drag control (shift+drag) -- names the exact `{{...SIZE|default}}` placeholder key to
// write to, reusing the SAME key the automatic guardrail-shrink system already uses where one
// exists (CAPTION_SIZE, HEADLINE_SIZE, STORY_SIZE, STATEMENT_SIZE, STAT_SIZE) so there's one
// unified size slot per field, not two competing ones -- a new key for fields that never had one.
export type EditableField = { field: string; selector: string; kind: EditableFieldKind; movable?: boolean; sizeField?: string }

export const EDITABLE_FIELDS: Record<string, EditableField[]> = {
  '1-cover-circles.html': [
    { field: 'CAPTION_HTML', selector: '.caption-inner', kind: 'text', movable: true, sizeField: 'CAPTION_SIZE' },
    { field: 'BG_IMG', selector: '.photo', kind: 'photo-bg' },
    { field: 'CIRCLE_L_IMG', selector: '.circle-wrap.left img', kind: 'photo-img', movable: true },
    { field: 'CIRCLE_R_IMG', selector: '.circle-wrap.right img', kind: 'photo-img', movable: true },
  ],
  '2-split-cover.html': [
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true },
    { field: 'IMG_LEFT', selector: '.half.l img', kind: 'photo-img' },
    { field: 'IMG_RIGHT', selector: '.half.r img', kind: 'photo-img' },
  ],
  '3-flip.html': [
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true },
    { field: 'BG_IMG', selector: '.photozone img', kind: 'photo-img' },
    { field: 'CIRCLE_L_IMG', selector: '.circle-wrap.left img', kind: 'photo-img', movable: true },
    { field: 'CIRCLE_R_IMG', selector: '.circle-wrap.right img', kind: 'photo-img', movable: true },
  ],
  '4-vertical-split.html': [
    { field: 'TAGLINE', selector: '.tagline', kind: 'text', movable: true },
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true },
    { field: 'BG_IMG', selector: '.photocol img', kind: 'photo-img' },
  ],
  '5-stat-takeover.html': [
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true },
    { field: 'BG_IMG', selector: '.photostrip img', kind: 'photo-img' },
  ],
  '6-minimal-magazine.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true },
    { field: 'HEADLINE_HTML', selector: '.headline', kind: 'text', movable: true },
    { field: 'STORY_HTML', selector: '.story', kind: 'text', movable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true },
    { field: 'BG_IMG', selector: '.photo img', kind: 'photo-img' },
  ],
  '7-keynote.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true },
    { field: 'STATEMENT_HTML', selector: '.statement', kind: 'text', movable: true },
  ],
  '8-photo-grid.html': [
    { field: 'TAGLINE', selector: '.tagline', kind: 'text', movable: true },
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true },
    { field: 'IMG_MAIN', selector: '.grid-main img', kind: 'photo-img' },
    { field: 'IMG_TOP', selector: '.grid-side .cell:nth-child(1) img', kind: 'photo-img' },
    { field: 'IMG_BOTTOM', selector: '.grid-side .cell:nth-child(2) img', kind: 'photo-img' },
  ],
  '9-split-flip.html': [
    { field: 'TAGLINE', selector: '.tagline', kind: 'text', movable: true },
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true },
    { field: 'IMG_LEFT', selector: '.half.l img', kind: 'photo-img' },
    { field: 'IMG_RIGHT', selector: '.half.r img', kind: 'photo-img' },
  ],
  '10-split-overlay.html': [
    { field: 'CAPTION_HTML', selector: '.headline', kind: 'text', movable: true },
    { field: 'IMG_LEFT', selector: '.half.l img', kind: 'photo-img' },
    { field: 'IMG_RIGHT', selector: '.half.r img', kind: 'photo-img' },
  ],
  '11-single-circle.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true },
    { field: 'HEADLINE_HTML', selector: '.headline', kind: 'text', movable: true },
    { field: 'STORY_HTML', selector: '.story', kind: 'text', movable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true },
    { field: 'BG_IMG', selector: '.photo img', kind: 'photo-img' },
    { field: 'CIRCLE_IMG', selector: '.circle-wrap img', kind: 'photo-img', movable: true },
  ],
  '12-hook-block.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true },
    { field: 'HEADLINE_HTML', selector: '.headline', kind: 'text', movable: true },
    { field: 'STORY_HTML', selector: '.story', kind: 'text', movable: true },
  ],
  'cta.html': [
    { field: 'HEADLINE_HTML', selector: 'h1', kind: 'text', movable: true },
    { field: 'SUBHEAD', selector: '.sub', kind: 'text', movable: true },
    { field: 'CTA_TEXT', selector: '.btn', kind: 'text', movable: true },
    { field: 'MICRO_TEXT', selector: '.micro', kind: 'text', movable: true },
  ],
}
