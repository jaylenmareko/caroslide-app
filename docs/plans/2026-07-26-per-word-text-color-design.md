# Per-Word Text Color Highlighting — Design

## Context

Decided during the Brand Kit removal work (2026-07-26): instead of a separate Brand Kit panel for
text formatting, users should be able to click into a text object, highlight a specific word or
phrase, and change just that selection's color — Canva-style. Jaylen explicitly rejected a simpler
"whole-field color change" middle ground in favor of true per-word highlighting. Never built; this
document scopes it out before implementation.

## Scope decisions (confirmed with Jaylen)

- **Any color, not just the 3 brand colors.** Real color picker (arbitrary hex), not limited to the
  existing `c1`/`c2`/`c3` (secondary/white/primary) classes every template already renders.
- **Color only, not font, in this pass.** Per-word font needs multiple font files loaded
  simultaneously and more picker UI — a real, separate follow-up once color is proven out.
- **Every text field, uniformly.** Captions, headlines, kickers, stat numbers/labels, CTA text —
  all of them, matching how the click-in-place editor already treats every text field identically.

## How it works

### 1. Trigger & UI
Only active once a text field is already in edit mode (existing click-to-edit flow, unchanged).
Selecting text within it (drag-select or double-click — native contenteditable behavior) shows a
small floating toolbar positioned above the selection's bounding rect: a row of quick swatches (this
carousel's own brand Primary and Secondary colors, plus white and black) and one native
`<input type="color">` swatch for any custom hex. Clicking a color applies immediately — no
separate confirm step, matching how color pickers already behave elsewhere in the app (Brand Kit
step, Settings). The toolbar hides when the selection collapses or focus leaves the field, mirroring
the existing hover-delete-button's show/hide pattern.

Built inside the injected iframe script (`SlideCanvasEditor.tsx`'s template-literal script), same as
every other in-place interaction (drag, hover-delete, contenteditable) — not in the outer React page,
since it needs direct access to the iframe's own `Selection`/`Range` objects.

### 2. Applying the color
On a color pick, capture `window.getSelection()` inside the iframe and get its `Range`. Wrap exactly
that range in a new `<span style="color:#hex">` — splitting any existing wrapping span (e.g. an
AI-written `c1`/`c2`/`c3` span) at the selection boundaries first, so only the highlighted portion
changes and the rest of that span's original class/color is preserved on either side. Implemented via
manual DOM manipulation (extract/reconstruct around the range), not `document.execCommand` (deprecated,
historically inconsistent on overlapping-span edge cases) and not a rearchitecture into a
range-based text model (no existing field needs one, and every other field in this app already
stores raw HTML strings — no reason for this one field type to diverge).

### 3. Storage & save path
No new data model, no new DB column, no new server action. The colored span is just more HTML inside
the same field value (`values.CAPTION_HTML` etc.) the app already stores and renders. Saving rides
the exact same blur-triggered save every text edit already uses (`caroslide-field-edit` postMessage →
`SlideCanvasEditor`'s existing `save()`) — one save per edit session (type and/or re-color, then click
away), not one server round-trip per color click. No guardrail/character-budget interaction, since
manual field edits already bypass `renderAndGuard` entirely (established rule: a user-typed/picked
value is never silently rewritten).

### 4. Scope of change
Applies to every `kind: 'text'` field in `editableFields.ts` uniformly — no per-template or
per-field-type special-casing needed, since the mechanism operates on the browser's own text
selection inside whatever contenteditable element is currently focused.

## Explicitly not building this pass

- **Font-per-word.** Confirmed deferred to a later, separate pass.
- **Preserving manual colors across a later chat-edit rewrite of the same field.** Chat-editing's
  `editSlide()` rewrites a field's HTML wholesale when the user requests a copy change — any
  manually-applied color spans in that field would be lost. Known, accepted limitation; not solved
  here. If it becomes a real complaint later, worth its own design pass (e.g. asking the rewrite
  model to preserve inline spans, or warning the user before a rewrite clobbers manual formatting).
- **Undo/redo granularity finer than "one save."** A color change participates in the existing
  slide-level undo/redo stack exactly like any other text edit already does — no per-keystroke or
  per-color-pick undo history.

## Open implementation questions (for the plan, not blocking design approval)

- Exact swatch set/ordering in the toolbar (brand Primary/Secondary + white/black, confirmed; exact
  visual layout is an implementation detail).
- Where exactly the custom-color `<input type="color">` sits in the toolbar (inline vs. a
  "more colors" overflow) — small UI detail, not architecturally significant.
