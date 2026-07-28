// Real chat-editing build (2026-07-21). Governed by reference/chat-editing-behavior.md (scope +
// model-tier rules) and reference/chat-editing-execution.md (edit-type taxonomy, what to actually
// change). Two edit types built now: copy_rewrite and photo_swap -- template_change (remapping a
// slide onto a different template's placeholder set) is explicitly deferred, per Jaylen, since the
// spec itself flags it as a bigger operation than the other two.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Slide } from '@/backend/lib/types'
import { ContentValues } from './captions'
import { findUsablePhoto } from './images'
import { sanitizeStrayEscapes } from './render'
import { FONT_LINKS } from './fonts'

const anthropic = new Anthropic()

// Cheap-tier model for the two mechanical classification passes below (which slide(s), what kind
// of edit) -- per chat-editing-behavior.md's "Model" section: edits are unlimited (no credit cap
// the way generation has), so an unnecessary Opus call on every edit is unbounded cost with no
// product lever to offset it. Classification is narrow pattern-matching against a fixed rule set,
// not open-ended judgment -- Haiku is the right tier, not a cost-cutting compromise.
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001'

// Real, important discovery (2026-07-21, same day as the tuple/record findings that broke initial
// generation): dumped this SDK's actual JSON schema for z.enum() AND for z.union() of z.literal()s
// and found BOTH demote their real constraint (enum values / const) to an inert `description`
// annotation, identical to the tuple/record bugs already found -- this isn't enum-specific, it's
// this SDK version's zod->JSON-schema conversion losing any refinement keyword beyond bare types.
// Real fix: editType is a plain string here, with NO schema-level constraint to rely on -- the
// caller (classifyEdit below) validates/normalizes the returned value in real code instead of
// trusting the schema to enforce it, the same "don't guess which zod construct survives, verify or
// avoid the risk" lesson from the tuple/record findings.
const EditClassification = z.object({
  // 0-based indices into the carousel's real slides array. Defaults to just the currently-viewed
  // slide unless the message explicitly names others -- see chat-editing-behavior.md's scope rule.
  slideIndices: z.array(z.number()),
  editType: z.string(),
  // Only meaningful for photo_swap -- which real template field (e.g. BG_IMG, CIRCLE_L_IMG) the
  // message means. Left unset (not guessed) when the target slide has only one photo field.
  targetField: z.string().optional(),
  // Only meaningful for editType 'ambiguous' -- a short, specific question to show back in the
  // chat instead of guessing at an edit. Per chat-editing-execution.md: never guess on ambiguity.
  clarifyingQuestion: z.string().optional(),
})

// Extended 2026-07-28 (Jaylen: "make sure our chat can take care of whatever the users needs...
// objects moved, objects deleted, something undone, ... change of text coloring, change of text
// font") -- delete_object/move_object/color_change/font_change all reuse existing per-field
// mechanisms the click-in-place editor already has (the _DISPLAY toggle, POS_X/POS_Y offsets, the
// same wrap-in-a-span approach the color/font pickers use) -- chat just gets a way to reach them.
// undo/redo are real edit types the model classifies (broad phrasing: "undo that", "go back", "put
// it back the way it was"), but neither actually touches the server at all -- undo history only
// ever exists in Viewer.tsx's local React state (the explicit-Save build made saving deliberate,
// not automatic), so editSlide (below) just confirms the intent and the CLIENT calls its own
// existing undo()/redo() directly. Background/border color changes deliberately NOT included here
// (Jaylen: skip those) -- most templates hardcode those, would need template-file changes first.
const VALID_EDIT_TYPES = [
  'copy_rewrite',
  'photo_swap',
  'delete_object',
  'move_object',
  'color_change',
  'font_change',
  'undo',
  'redo',
  'template_change',
  'brand_kit_redirect',
  'ambiguous',
] as const
export type EditType = (typeof VALID_EDIT_TYPES)[number]

export type EditClassificationResult = {
  slideIndices: number[]
  editType: EditType
  targetField?: string
  clarifyingQuestion?: string
}

// Defensive normalization (2026-07-28, found live: "move the caption down a bit" came back with
// targetField "CAPTION_HTML_POS_Y" instead of "CAPTION_HTML") -- the prompt now says explicitly not
// to do this, but a slide's own `values` JSON (shown to the model as context) has both the base key
// and its "_POS_X"/"_POS_Y"/"_DISPLAY"/"_SIZE" siblings sitting right next to each other, so a model
// slip here is cheap to guard against in code rather than trust the prompt alone -- same "don't
// trust the schema/prompt to fully enforce this, validate defensively" pattern as editType above.
// These 4 suffixes are exactly the per-field metadata keys editableFields.ts/actions.ts ever append
// to a base field name, so stripping one is always safe, never ambiguous.
const TARGET_FIELD_SUFFIXES = ['_POS_X', '_POS_Y', '_DISPLAY', '_SIZE'] as const
function normalizeTargetField(field: string | undefined): string | undefined {
  if (!field) return field
  const suffix = TARGET_FIELD_SUFFIXES.find((s) => field.endsWith(s))
  return suffix ? field.slice(0, -suffix.length) : field
}

/**
 * Classifies a chat-edit message: which slide(s) it touches, what kind of edit it is, and (for
 * photo_swap) which field. Uses each slide's own real template/values as context so "make it
 * punchier" can be judged against what's actually on the screen right now, not guessed blind.
 */
export async function classifyEdit(input: {
  message: string
  currentSlideIndex: number
  slides: Slide[]
}): Promise<EditClassificationResult> {
  const slidesSummary = input.slides
    .map((s, i) => {
      const marker = i === input.currentSlideIndex ? ' (the slide currently being viewed)' : ''
      return `Slide ${i + 1}${marker} -- template: ${s.template ?? 'unknown'}, current content: ${JSON.stringify(s.values ?? {})}`
    })
    .join('\n')

  const systemPrompt = `You are classifying a chat-edit request for a real social media carousel. Your job is ONLY to classify -- which slide(s), what kind of edit, which field it targets (for photo_swap/delete_object/move_object/color_change/font_change). Do not write any actual new copy, pick any actual photo, or write any actual color/font here -- a separate step handles that.

## The carousel's real slides right now

${slidesSummary}

## Scope rule (which slide(s) this touches) -- follow exactly, never guess wider

The code already knows which slide is currently being viewed (slide ${input.currentSlideIndex + 1} above) and defaults to editing ONLY that slide on its own -- you never need to name it yourself, and you MUST NOT try to. Leave slideIndices as an EMPTY array unless the message explicitly names OTHER slide(s) by number ("slide 3", "slides 2 and 4"), a range ("slides 3-5", "the last two"), or everything ("all slides", "the whole carousel", "every slide") -- only then set slideIndices to the real 0-based index/indices of exactly those named slides (slide 3 = index 2, etc). An ambiguous message about scope stays an EMPTY array, never a guess -- under-scoping is recoverable (the user just asks again), over-scoping (or naming the wrong slide) destroys or changes content they didn't ask to touch.

## Edit-type rule -- pick exactly one

- "copy_rewrite": the message asks to change wording/tone/emphasis of a caption, headline, kicker, story, stat number/label, tagline, statement, subhead, or CTA text.
- "photo_swap": the message asks to change, swap, or replace a photo/image.
- "delete_object": the message asks to remove/delete/hide an element -- the divider line, the logo, a circle photo, or a text field. Set targetField to the real field name (check "current content" for the actual field names this slide's template has, e.g. DIVIDER, LOGO_HTML, CIRCLE_L_IMG, CAPTION_HTML).
- "move_object": the message asks to reposition/move/nudge an element (e.g. "move the logo up", "shift the circle right", "center the caption"). Set targetField the same way.
- "color_change": the message asks to change the COLOR of specific TEXT on this slide (e.g. "make 'SALE' red", "turn the headline gold"). Set targetField to the real text field this refers to. This is NOT for brand colors/logo/font overall -- see brand_kit_redirect below.
- "font_change": the message asks to change the FONT/typeface of specific TEXT on this slide (e.g. "make the caption Poppins", "use a bolder font for this word"). Set targetField the same way. Also NOT for the carousel's overall brand font -- see brand_kit_redirect below.
- "undo": the message asks to undo, revert, or go back on the last change (e.g. "undo that", "undo the last edit", "go back", "put it back the way it was", "never mind, undo").
- "redo": the message asks to redo or reapply a change that was just undone (e.g. "redo that", "put it back", right after an undo).
- "template_change": the message asks to change the whole visual layout/style of a slide (e.g. "make this a stat slide instead", "use a different look for this one", "add circles to this slide"). This is NOT supported yet -- still classify it as this type, don't force it into copy_rewrite or photo_swap.
- "brand_kit_redirect": the message is about the carousel's OVERALL brand colors, logo, or font (not one specific text field/word on one slide) -- these live in the Brand Kit settings, not chat-edits. ("make my brand color green", "change my logo", "use a different font for everything" -> brand_kit_redirect. "make this ONE word green" or "make THIS caption a different font" -> color_change/font_change instead.)
- "ambiguous": the message doesn't give enough to act on confidently -- write a short, specific clarifyingQuestion.

If editType is "photo_swap"/"delete_object"/"move_object"/"color_change"/"font_change" and the target slide's template has MORE than one field that plausibly matches (check "current content" above for the real field names it actually has) and the message doesn't say which one clearly enough, set editType to "ambiguous" and ask which one they mean instead of guessing.

targetField must always be the BASE field name (e.g. "CAPTION_HTML", "LOGO_HTML", "CIRCLE_L_IMG") -- NEVER a field ending in "_POS_X", "_POS_Y", "_DISPLAY", or "_SIZE". Those suffixed keys in "current content" are internal per-field metadata (this field's own position/visibility/size override), not separate objects you can target -- "move the caption down" targets "CAPTION_HTML", not "CAPTION_HTML_POS_Y", even though the Y-position key is what actually changes under the hood.

The user's message: "${input.message}"`

  const format = zodOutputFormat(EditClassification)
  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Classify this edit request now.' }],
    output_config: { format },
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}'
  console.log(`[chat-edit] classify raw output (${text.length} chars): ${text}`)
  const parsed = format.parse(text)

  // editType has no real schema-level constraint (see the comment above EditClassification) --
  // the prompt spells out the exact 5 valid strings, but validate defensively in code rather than
  // trusting the model never typos/invents a 6th value. Falls back to 'ambiguous' with a generic
  // clarifying question rather than silently mis-routing an unrecognized value into copy_rewrite.
  const editType = (VALID_EDIT_TYPES as readonly string[]).includes(parsed.editType)
    ? (parsed.editType as EditType)
    : 'ambiguous'

  return {
    slideIndices: parsed.slideIndices,
    editType,
    targetField: normalizeTargetField(parsed.targetField),
    clarifyingQuestion:
      editType === 'ambiguous' ? parsed.clarifyingQuestion || 'Not sure what you meant -- could you rephrase that?' : parsed.clarifyingQuestion,
  }
}

/**
 * Rewrites ONLY the fields implicated by the instruction, given the slide's current values --
 * never re-fills the whole template from scratch (would silently drift colors/logo/font away from
 * the carousel's saved brand snapshot over repeated edits, per chat-editing-execution.md). Returns
 * just the changed fields; caller merges them into the slide's existing values.
 */
export async function rewriteCopy(input: {
  message: string
  currentValues: Record<string, string>
  voiceDescription: string | null
}): Promise<Record<string, string>> {
  const systemPrompt = `You are editing ONE existing slide of a real social media carousel, per a user's chat instruction. Rewrite ONLY the field(s) the instruction actually implicates -- return every other field completely unset. Never touch PRIMARY/SECONDARY/LOGO_HTML/FONT_FAMILY/CANVAS_H or any image field -- those aren't yours to change here.

## This slide's current content

${JSON.stringify(input.currentValues)}

## Caption color convention (keep it if you rewrite a field that uses it)

Every caption/headline is 2-3 \`<span>\` clauses: \`class="c1"\` (secondary accent), \`class="c2"\` (white/body), \`class="c3"\` (primary accent), cycling secondary → white → primary. Don't use more than 3 clauses.

${input.voiceDescription ? `## Brand voice\n\n${input.voiceDescription}\n\nA specific voice quirk or founder detail belongs in the rewrite, not flattened into generic copy.\n` : ''}
## The user's instruction

"${input.message}"

Do all reasoning yourself, directly in plain text. Do not write or execute code -- there is no tool of any kind available in this request.`

  const format = zodOutputFormat(ContentValues)
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Make this edit now.' }],
    output_config: { format },
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}'
  console.log(`[chat-edit] rewrite raw output (${text.length} chars): ${text}`)
  const parsed = format.parse(text)
  // ContentValues' fields are all individually optional -- only return the ones the model
  // actually set, so the caller's merge never overwrites an untouched field with `undefined`.
  // sanitizeStrayEscapes here too -- chat-edit rewrites go through the same model/JSON path as
  // initial generation, so they're just as exposed to the stray-escape bug (see its own comment).
  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([k, v]) => [k, sanitizeStrayEscapes(v)])
  )
}

/**
 * "Swap this photo" edits don't have an original search brief stored (Slide.values only keeps the
 * final resolved URL, not the scene description that found it) -- regenerate a fresh one from the
 * slide's own current caption content plus the user's instruction, rather than adding a schema
 * field to persist briefs just for this. Simpler, no migration, good enough for a first version.
 */
export async function generateSwapBrief(input: { message: string; currentValues: Record<string, string> }): Promise<string> {
  const captionText = Object.values(input.currentValues)
    .filter((v) => typeof v === 'string')
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .slice(0, 400)

  const systemPrompt = `A user wants a different photo on one slide of a real social media carousel. Based on this slide's current caption/text content and their instruction, write ONE short scene-level photo search brief (e.g. "raw wagyu steak marbling close-up photo") -- NOT a URL, NOT the placeholder name. Prefer something visibly DIFFERENT from what a generic search on the same topic would already have found, since this is explicitly a swap request, not a repeat.

## This slide's current text content

${captionText}

## The user's instruction

"${input.message}"

Reply with ONLY the search brief, nothing else.`

  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 128,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Write the search brief now.' }],
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text.trim() ?? ''
  return text
}

/** Sources a real replacement photo for a swap edit, reusing the same 3-tier pipeline
 * (Pexels → Tavily image search → og:image scrape) and stock-domain/dimension validation as
 * initial generation -- no separate, drifted photo-sourcing path for edits. */
export async function swapPhoto(brief: string): Promise<string | null> {
  const photo = await findUsablePhoto(brief)
  return photo?.url ?? null
}

/**
 * "Move it" chat edits (2026-07-28) -- interprets a natural-language direction/magnitude into a
 * pixel delta relative to the field's CURRENT offset, not an absolute target -- "move it down more"
 * builds on wherever it already is, same as dragging it again would. Deliberately a rough nudge,
 * not precise placement -- precise placement is what dragging is for; chat is the rough-direction
 * path, matching how a designer would eyeball a nudge amount rather than typing exact coordinates.
 */
export async function generateMoveDelta(input: {
  message: string
  currentPosX: number
  currentPosY: number
}): Promise<{ deltaX: number; deltaY: number }> {
  const MoveDelta = z.object({ deltaX: z.number(), deltaY: z.number() })
  const systemPrompt = `A user wants to reposition one element on a real social media carousel slide via chat, relative to where it already is (currently offset ${input.currentPosX}px horizontally, ${input.currentPosY}px vertically from its default spot). The canvas is 1080px wide. Positive deltaX moves right, negative moves left; positive deltaY moves down, negative moves up.

Pick a REASONABLE pixel nudge for the instruction -- a small nudge ("a bit", "slightly") is roughly 30-60px, a normal move ("down", "to the left", no qualifier) is roughly 80-150px, a big move ("to the corner", "way over", "a lot") is roughly 200-300px. "Center it" / "put it back" / "reset the position" should return whatever delta cancels out the CURRENT offset exactly (deltaX = ${-input.currentPosX}, deltaY = ${-input.currentPosY}).

## The user's instruction

"${input.message}"

Return only the pixel delta to ADD to the current position.`

  const format = zodOutputFormat(MoveDelta)
  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 128,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Compute the move now.' }],
    output_config: { format },
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}'
  return format.parse(text)
}

/**
 * "Change the color of X" chat edits (2026-07-28) -- identifies the EXACT plain-text substring to
 * recolor and resolves the requested color to a real hex value. Matched against the field's own
 * CURRENTLY STORED text, not a guessed-at rendered version -- templates often apply
 * text-transform:uppercase via CSS while the real stored value is normal/mixed case, so matching
 * against the rendered look would silently never find anything. Execution (wrapTextWithStyle
 * below) mirrors the click-in-place color picker's own wrap mechanism -- just AI-identified
 * instead of user-dragged.
 */
export async function generateColorEdit(input: {
  message: string
  currentHtml: string
  primary: string
  secondary: string
}): Promise<{ matchText: string; hex: string } | null> {
  const ColorEdit = z.object({ matchText: z.string(), hex: z.string() })
  const plainText = input.currentHtml.replace(/<[^>]+>/g, '')
  const systemPrompt = `A user wants to change the color of part of a text field on a real social media carousel slide, via chat. Identify the EXACT, VERBATIM plain-text substring (a word or short phrase, copied character-for-character from "Current text" below -- no punctuation added/removed, no case changes) the instruction refers to, and the target color as a hex code.

## Current text (verbatim -- match against THIS exact text, not an uppercase or otherwise-reformatted guess)

"${plainText}"

## This carousel's brand colors

PRIMARY: ${input.primary}, SECONDARY: ${input.secondary} -- use one of these if the instruction says "brand color", "primary color", "secondary color", or similar. Otherwise resolve a plain color name (red, blue, gold, etc.) to a reasonable real hex value yourself.

## The user's instruction

"${input.message}"

If the instruction doesn't clearly name which words to recolor, or no target color, set matchText to an empty string instead of guessing.`

  const format = zodOutputFormat(ColorEdit)
  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Identify the edit now.' }],
    output_config: { format },
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}'
  const parsed = format.parse(text)
  if (!parsed.matchText || !plainText.includes(parsed.matchText)) return null
  return parsed
}

/** Same shape as generateColorEdit, for font instead of color -- constrained to the exact same
 * 5-font whitelist the click-in-place font picker and Brand Kit already use (FONT_LINKS), not an
 * open-ended font name the AI could invent that was never actually loaded/tested. */
export async function generateFontEdit(input: {
  message: string
  currentHtml: string
}): Promise<{ matchText: string; fontFamily: string } | null> {
  const FontEdit = z.object({ matchText: z.string(), fontName: z.string() })
  const plainText = input.currentHtml.replace(/<[^>]+>/g, '')
  const fontNames = Object.keys(FONT_LINKS)
  const systemPrompt = `A user wants to change the font of part of a text field on a real social media carousel slide, via chat. Identify the EXACT, VERBATIM plain-text substring (copied character-for-character from "Current text" below) the instruction refers to, and which font to use.

## Current text (verbatim)

"${plainText}"

## Available fonts -- pick EXACTLY one of these names, no others

${fontNames.join(', ')}

## The user's instruction

"${input.message}"

If the instruction doesn't clearly name which words, or asks for a font not in this list, set matchText to an empty string instead of guessing.`

  const format = zodOutputFormat(FontEdit)
  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Identify the edit now.' }],
    output_config: { format },
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}'
  const parsed = format.parse(text)
  if (!parsed.matchText || !plainText.includes(parsed.matchText) || !fontNames.includes(parsed.fontName)) return null
  return { matchText: parsed.matchText, fontFamily: FONT_LINKS[parsed.fontName].family }
}

/** Wraps the first verbatim occurrence of matchText in a field's raw HTML with a new inline style
 * -- a plain string search/replace is safe here (unlike the click-in-place picker's Range-based
 * version) since matchText is always a fully-known, already-validated substring, never an
 * arbitrary user selection that could straddle element boundaries. Returns null (fails safe,
 * doesn't guess) if matchText isn't found VERBATIM IN THE RAW HTML -- it was only checked against
 * the plain-text version when the AI proposed it, and a match spanning across an existing tag
 * boundary (e.g. two adjacent c1/c2 spans) wouldn't appear as one contiguous run in the raw markup
 * even though it does in stripped plain text. */
export function wrapTextWithStyle(html: string, matchText: string, styleProp: string, styleValue: string): string | null {
  const idx = html.indexOf(matchText)
  if (idx === -1) return null
  const before = html.slice(0, idx)
  const after = html.slice(idx + matchText.length)
  return `${before}<span style="${styleProp}:${styleValue}">${matchText}</span>${after}`
}
