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
// 'move-only' (2026-07-24, Jaylen) is for elements that are neither text nor a photo swap target
// at all -- the logo (its image/text content is controlled entirely from Brand Kit settings, not
// click-in-place) and decorative elements like the divider line (no content, just a position and
// an on/off state). No click/dblclick handler of any kind attaches to these -- drag-to-move is the
// only interaction.
export type EditableFieldKind = 'text' | 'photo-img' | 'photo-bg' | 'move-only'

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
// `deletable` (2026-07-24, extended to text 2026-07-26 per Jaylen: "users should be able to
// delete their text box if they want") shows a small hover-revealed delete control. For
// decorative move-only elements with no content of their own (the divider), it sets a
// `{FIELD}_DISPLAY` placeholder to 'hidden' -- a real, reversible on/off toggle. For text fields,
// there's no such placeholder in any template (and adding one to all 13 would be real template-
// level work, unlike this) -- deleting just clears the field's own value to an empty string via
// the same save path a normal edit already uses, which is enough to make the box disappear
// visually without needing any template changes at all, so this rolled out to every template's
// text fields at once, not gated behind the same per-template wiring move/resize needs (task
// #32). Deliberately mouse-only (the hover button), not wired to keyboard Delete -- text fields
// go straight to contenteditable on click rather than a separate "selected" state the way
// movable/deletable non-text fields do, so a keyboard shortcut here would risk colliding with a
// real Backspace keystroke while actually editing.
export type EditableField = {
  field: string
  selector: string
  kind: EditableFieldKind
  movable?: boolean
  sizeField?: string
  deletable?: boolean
}

export const EDITABLE_FIELDS: Record<string, EditableField[]> = {
  '1-cover-circles.html': [
    { field: 'CAPTION_HTML', selector: '.caption-inner', kind: 'text', movable: true, sizeField: 'CAPTION_SIZE', deletable: true },
    { field: 'BG_IMG', selector: '.photo', kind: 'photo-bg' },
    { field: 'CIRCLE_L_IMG', selector: '.circle-wrap.left img', kind: 'photo-img', movable: true },
    { field: 'CIRCLE_R_IMG', selector: '.circle-wrap.right img', kind: 'photo-img', movable: true },
    { field: 'LOGO_HTML', selector: '.logo', kind: 'move-only', movable: true, deletable: true },
    { field: 'DIVIDER', selector: '.divider', kind: 'move-only', movable: true, deletable: true },
  ],
  '2-split-cover.html': [
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true, deletable: true },
    { field: 'IMG_LEFT', selector: '.half.l img', kind: 'photo-img' },
    { field: 'IMG_RIGHT', selector: '.half.r img', kind: 'photo-img' },
  ],
  '3-flip.html': [
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true, deletable: true },
    { field: 'BG_IMG', selector: '.photozone img', kind: 'photo-img' },
    { field: 'CIRCLE_L_IMG', selector: '.circle-wrap.left img', kind: 'photo-img', movable: true },
    { field: 'CIRCLE_R_IMG', selector: '.circle-wrap.right img', kind: 'photo-img', movable: true },
    { field: 'LOGO_HTML', selector: '.logo', kind: 'move-only', movable: true, deletable: true },
    { field: 'DIVIDER', selector: '.divider', kind: 'move-only', movable: true, deletable: true },
  ],
  '4-vertical-split.html': [
    { field: 'TAGLINE', selector: '.tagline', kind: 'text', movable: true, deletable: true },
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true, deletable: true },
    { field: 'BG_IMG', selector: '.photocol img', kind: 'photo-img' },
  ],
  '5-stat-takeover.html': [
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true, deletable: true },
    { field: 'BG_IMG', selector: '.photostrip img', kind: 'photo-img' },
  ],
  '6-minimal-magazine.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true, deletable: true },
    { field: 'HEADLINE_HTML', selector: '.headline', kind: 'text', movable: true, deletable: true },
    { field: 'STORY_HTML', selector: '.story', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true, deletable: true },
    { field: 'BG_IMG', selector: '.photo img', kind: 'photo-img' },
  ],
  '7-keynote.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true, deletable: true },
    { field: 'STATEMENT_HTML', selector: '.statement', kind: 'text', movable: true, deletable: true },
  ],
  '8-photo-grid.html': [
    { field: 'TAGLINE', selector: '.tagline', kind: 'text', movable: true, deletable: true },
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true, deletable: true },
    { field: 'IMG_MAIN', selector: '.grid-main img', kind: 'photo-img' },
    { field: 'IMG_TOP', selector: '.grid-side .cell:nth-child(1) img', kind: 'photo-img' },
    { field: 'IMG_BOTTOM', selector: '.grid-side .cell:nth-child(2) img', kind: 'photo-img' },
  ],
  '9-split-flip.html': [
    { field: 'TAGLINE', selector: '.tagline', kind: 'text', movable: true, deletable: true },
    { field: 'CAPTION_HTML', selector: '.caption', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true, deletable: true },
    { field: 'IMG_LEFT', selector: '.half.l img', kind: 'photo-img' },
    { field: 'IMG_RIGHT', selector: '.half.r img', kind: 'photo-img' },
  ],
  '10-split-overlay.html': [
    { field: 'CAPTION_HTML', selector: '.headline', kind: 'text', movable: true, deletable: true },
    { field: 'IMG_LEFT', selector: '.half.l img', kind: 'photo-img' },
    { field: 'IMG_RIGHT', selector: '.half.r img', kind: 'photo-img' },
  ],
  '11-single-circle.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true, deletable: true },
    { field: 'HEADLINE_HTML', selector: '.headline', kind: 'text', movable: true, deletable: true },
    { field: 'STORY_HTML', selector: '.story', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_NUMBER', selector: '.stat', kind: 'text', movable: true, deletable: true },
    { field: 'STAT_LABEL', selector: '.statlbl', kind: 'text', movable: true, deletable: true },
    { field: 'BG_IMG', selector: '.photo img', kind: 'photo-img' },
    { field: 'CIRCLE_IMG', selector: '.circle-wrap img', kind: 'photo-img', movable: true },
    { field: 'LOGO_HTML', selector: '.logo', kind: 'move-only', movable: true, deletable: true },
  ],
  '12-hook-block.html': [
    { field: 'KICKER', selector: '.kicker', kind: 'text', movable: true, deletable: true },
    { field: 'HEADLINE_HTML', selector: '.headline', kind: 'text', movable: true, deletable: true },
    { field: 'STORY_HTML', selector: '.story', kind: 'text', movable: true, deletable: true },
  ],
  // LOGO_HTML added 2026-07-28 (Jaylen: "slide 5 the logo isn't an object like the logo on the
  // rest of the pages") -- real gap, not a design choice: cta.html renders a real .logo div (same
  // as every other template) but was the only template whose editableFields entry never listed it,
  // so it never got a click-to-select/move/delete handler at all. See the template's own .logo CSS
  // rule for the matching visibility/transform placeholders this now relies on.
  'cta.html': [
    { field: 'HEADLINE_HTML', selector: 'h1', kind: 'text', movable: true, deletable: true },
    { field: 'SUBHEAD', selector: '.sub', kind: 'text', movable: true, deletable: true },
    { field: 'CTA_TEXT', selector: '.btn', kind: 'text', movable: true, deletable: true },
    { field: 'MICRO_TEXT', selector: '.micro', kind: 'text', movable: true, deletable: true },
    { field: 'LOGO_HTML', selector: '.logo', kind: 'move-only', movable: true, deletable: true },
  ],
}
