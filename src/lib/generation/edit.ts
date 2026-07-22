// Real chat-editing build (2026-07-21). Governed by reference/chat-editing-behavior.md (scope +
// model-tier rules) and reference/chat-editing-execution.md (edit-type taxonomy, what to actually
// change). Two edit types built now: copy_rewrite and photo_swap -- template_change (remapping a
// slide onto a different template's placeholder set) is explicitly deferred, per Jaylen, since the
// spec itself flags it as a bigger operation than the other two.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Slide } from '@/lib/types'
import { ContentValues } from './captions'
import { findUsablePhoto } from './images'

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

const VALID_EDIT_TYPES = ['copy_rewrite', 'photo_swap', 'template_change', 'brand_kit_redirect', 'ambiguous'] as const
export type EditType = (typeof VALID_EDIT_TYPES)[number]

export type EditClassificationResult = {
  slideIndices: number[]
  editType: EditType
  targetField?: string
  clarifyingQuestion?: string
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

  const systemPrompt = `You are classifying a chat-edit request for a real social media carousel. Your job is ONLY to classify -- which slide(s), what kind of edit, which field if it's a photo swap. Do not write any actual new copy or pick any actual photo here.

## The carousel's real slides right now

${slidesSummary}

## Scope rule (which slide(s) this touches) -- follow exactly, never guess wider

Default to ONLY the slide currently being viewed (slide ${input.currentSlideIndex + 1}) unless the message explicitly names other slide(s) by number ("slide 3", "slides 2 and 4"), a range ("slides 3-5", "the last two"), or everything ("all slides", "the whole carousel", "every slide"). An ambiguous message about scope stays scoped to the current slide -- under-scoping is recoverable (the user just asks again), over-scoping destroys slides they didn't ask to touch.

## Edit-type rule -- pick exactly one

- "copy_rewrite": the message asks to change wording/tone/emphasis of a caption, headline, kicker, story, stat number/label, tagline, statement, subhead, or CTA text.
- "photo_swap": the message asks to change, swap, or replace a photo/image.
- "template_change": the message asks to change the whole visual layout/style of a slide (e.g. "make this a stat slide instead", "use a different look for this one", "add circles to this slide"). This is NOT supported yet -- still classify it as this type, don't force it into copy_rewrite or photo_swap.
- "brand_kit_redirect": the message is actually about brand colors, logo, or font -- these aren't chat-edits, they belong in the Brand Kit settings.
- "ambiguous": the message doesn't give enough to act on confidently -- write a short, specific clarifyingQuestion.

If editType is "photo_swap" and the target slide's template has MORE than one real photo field (check "current content" above for which BG_IMG/CIRCLE_L_IMG/CIRCLE_R_IMG/IMG_LEFT/etc. fields it actually has) and the message doesn't say which one, set editType to "ambiguous" and ask which photo they mean instead of guessing.

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
    targetField: parsed.targetField,
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
  const parsed = format.parse(text)
  // ContentValues' fields are all individually optional -- only return the ones the model
  // actually set, so the caller's merge never overwrites an untouched field with `undefined`.
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)) as Record<string, string>
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
