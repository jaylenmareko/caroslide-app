import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { readFile } from 'fs/promises'
import path from 'path'
import type { Angle, Format, Look, TemplateVariant } from '@/lib/types'
import { templateFileFor, CTA_TEMPLATE } from './templates'
import { loadTemplate } from './render'
import { tavilySearch } from './research'
import { photosNeeded } from './images'

const anthropic = new Anthropic()
const REFERENCE_DIR = path.join(process.cwd(), 'reference')

// Measured live (2026-07-20): the full reference docs run the system prompt to ~21.8k input
// tokens, and the model was reliably returning a real title but completely empty photoBriefs/
// values for every slide (satisfies the JSON schema, does none of the actual writing) -- even
// after a direct in-conversation correction telling it exactly that. Re-reading the source docs
// found real cause for suspicion: `initial-generation-behavior.md` is mostly a BUILD spec (wizard
// architecture, cost-pipeline reasoning, render/storage plumbing) irrelevant to what the model
// should write, and `templates-guide.md` spends most of its length describing all 11 templates'
// selection tradeoffs when this call only ever needs the ONE already-chosen template (whose real
// HTML is injected separately below anyway). Extracting just the sections the model actually needs
// -- not a guess, grounded in what's demonstrably about writing vs. about building.
function extractSections(markdown: string, headings: string[]): string {
  const lines = markdown.split('\n')
  const kept: string[] = []
  let keeping = false
  for (const line of lines) {
    if (line.startsWith('## ')) {
      keeping = headings.some((h) => line.trim() === `## ${h}`)
    }
    if (keeping) kept.push(line)
  }
  return kept.join('\n').trim()
}

// Real, important discovery (2026-07-21): dumped the actual JSON schema z.record(string,string)
// produces via this SDK and found it serializes to `{"type":"object","properties":{},
// "additionalProperties":false}` -- the "any string key allowed" part (propertyNames) gets
// demoted to an inert `description` annotation (same bug pattern already found for z.tuple()'s
// prefixItems), while `additionalProperties:false` + empty `properties` stays a REAL, ENFORCED
// constraint. That combination only validates against `{}` -- confirmed live the same day: a real
// run returned real, non-empty `values` (named fields) but `photoBriefs: {}` on every slide, exactly
// matching this theory, not a prompt-attention issue.
// Fix: `photoBriefs` uses a FIXED set of 3 generic named slots (PHOTO_1/2/3, the max any template
// needs) instead of a record OR a per-template-dynamic named object. Real JSON schema (verified via
// the same standalone-dump technique), no record involved, and smaller than the combined schema
// that already cleared the "Schema is too complex" ceiling once (990 vs. 1044 chars) -- so this
// isn't a compromise, it's the actual fix for both prior bugs at once. images.ts's
// PHOTO_FIELDS_FOR_TEMPLATE maps these generic slots back onto the template's real placeholder
// names, in order.
const ContentValues = z.object({
  CAPTION_HTML: z.string().optional(),
  HEADLINE_HTML: z.string().optional(),
  KICKER: z.string().optional(),
  STORY_HTML: z.string().optional(),
  STAT_NUMBER: z.string().optional(),
  STAT_LABEL: z.string().optional(),
  TAGLINE: z.string().optional(),
  STATEMENT_HTML: z.string().optional(),
  SUBHEAD: z.string().optional(),
  CTA_TEXT: z.string().optional(),
})

// Generic photo slots, in the same top-to-bottom order the template's own HTML presents its real
// {{...IMG}} placeholders (told explicitly in the prompt below). NOT real field names, and NOT a
// URL -- a short scene-level search brief per slot (e.g. "man applying sunscreen outdoors photo").
// Leave a slot unset if this template needs fewer than 3 photos on this slide.
const PhotoBriefs = z.object({
  PHOTO_1: z.string().optional(),
  PHOTO_2: z.string().optional(),
  PHOTO_3: z.string().optional(),
})

const SlideOutput = z
  .object({
    photoBriefs: PhotoBriefs,
    // Only the fields that apply to whichever mode this slide uses, per the dual/triple-mode
    // conventions in the template's own comments below -- leave every other field unset/absent.
    values: ContentValues,
  })
  .refine((slide) => Object.values(slide.values).some((v) => v && v.trim().length > 0), {
    message: 'values must not be empty -- every slide needs real caption/headline content',
  })

const GenerationOutput = z.object({
  title: z.string().max(60),
  slides: z.array(SlideOutput).length(5),
})

export type GeneratedCarousel = z.infer<typeof GenerationOutput>

export async function generateCaptions(input: {
  angle: Angle
  format: Format
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  voiceDescription: string | null
  hasReferenceImages: boolean
}): Promise<GeneratedCarousel> {
  const templateFile = templateFileFor(input.look, input.templateVariant)
  const photoCount = photosNeeded(input.templateVariant, input.look)

  const [contentStrategies, templatesGuideFull, generationBehaviorFull, templateHtml, ctaHtml] = await Promise.all([
    readFile(path.join(REFERENCE_DIR, 'content-strategies.md'), 'utf-8'),
    readFile(path.join(REFERENCE_DIR, 'templates-guide.md'), 'utf-8'),
    readFile(path.join(REFERENCE_DIR, 'initial-generation-behavior.md'), 'utf-8'),
    loadTemplate(templateFile),
    loadTemplate(CTA_TEMPLATE),
  ])

  // Trimmed to just what a caption-writing call needs -- see extractSections' comment above.
  const templatesGuide = extractSections(templatesGuideFull, [
    'Caption color convention',
    "Color contrast against the dark background — check it, don't eyeball it",
    'Caption length discipline',
  ])
  const generationBehavior = extractSections(generationBehaviorFull, ['Parsing the brief', 'Images', 'Captions'])
  console.log(
    `[generation] trimmed reference docs: templatesGuide ${templatesGuideFull.length}->${templatesGuide.length} chars, generationBehavior ${generationBehaviorFull.length}->${generationBehavior.length} chars`
  )

  // Several TemplateVariants (Side by Side, Photo Column, Editorial, Photo Grid, Split Flip) map
  // to the EXACT SAME template file for both the "Photo Focus" and "Bold Stat" Looks -- the file
  // alone can't tell the model which mode to fill (plain caption vs. a stat takeover). Without
  // this being explicit, a Bold Stat carousel could silently come out in plain-caption mode.
  const modeInstruction =
    input.look === 'Bold Stat'
      ? 'This carousel\'s Look is "Bold Stat" -- every content slide MUST use the template\'s stat-takeover mode (STAT_NUMBER + STAT_LABEL), even though the same file also supports a plain-caption mode. Leave CAPTION_HTML/HEADLINE_HTML/TAGLINE unset on content slides.'
      : 'This carousel\'s Look is "' + input.look + '" -- do NOT use stat-takeover mode (STAT_NUMBER/STAT_LABEL) on any content slide even if the template file supports it; that mode is reserved for the separate "Bold Stat" Look. Use whichever non-stat mode the template\'s own comments describe (plain caption, or kicker+headline/story if this is a dual-mode template).'

  // Real research now happens BEFORE this call, via Tavily (plain HTTP, no Anthropic tool) --
  // not by giving the model its own search tool. That was the actual fix for the refusal bug:
  // Opus was invoking an ungranted code_execution tool whenever web_search was attached, and a
  // safety classifier cut the response short. Removing all tools from this call closes that off
  // entirely, at the cost of the model no longer being able to research on its own -- Tavily's
  // findings (when there's a real brief to search on) are handed to it as plain text instead.
  const research = input.brief.trim() ? await tavilySearch(input.brief.trim()) : null
  console.log(
    `[generation] tavily research: ${research ? `answer=${research.answer ? 'yes' : 'no'}, sources=${research.sources.length}` : 'null (brief empty or lookup failed)'}`
  )

  const researchSection = research
    ? `## Research findings (real, fetched just now -- ground the copy in these, don't contradict them)\n\n${research.answer ? `${research.answer}\n\n` : ''}${research.sources.map((s) => `- ${s.title} (${s.url}): ${s.content.slice(0, 300)}`).join('\n')}\n`
    : ''

  const briefInstruction = input.brief.trim()
    ? `The user's brief: "${input.brief.trim()}"\n\nParse this by shape: a bare topic phrase is the subject; a detailed paragraph should be extracted concretely, not compressed away -- a specific claim or credential beats a generic rewording. ${research ? "Real research findings are provided above -- use them, and if they contradict an assumption in the brief (e.g. the brief assumes X but the research shows otherwise), write the honest version, don't just repeat the brief's premise." : 'No research findings were available for this brief (lookup failed or returned nothing) -- write from the brief itself, don\'t invent statistics or sources you can\'t back.'}`
    : `No brief was given and no research was possible without one -- write a real, honest, generically true carousel for this Angle/Look without inventing specific statistics, studies, or sources you can't back.${input.voiceDescription ? ' Weight it toward the voice/audience notes below.' : ''}`

  // Real bug found and fixed 2026-07-21: this call previously never received `format` at all --
  // the prompt claimed the model "has already been told" it, but Format (Post/Square/Story) only
  // ever reached the render step (CANVAS_H), never this call. The canvas WIDTH is always 1080px;
  // only the HEIGHT differs, so Square is meaningfully shorter (less vertical room per word) and
  // Story meaningfully taller than Post -- worth telling the model, since the per-template
  // character budgets in guardrails.ts were only empirically measured against Post's 1350px
  // height (see initial-generation-behavior.md's Captions section) and haven't been separately
  // measured for Square/Story. Giving qualitative guidance here (favor the tighter end on Square,
  // a little more room on Story) is a reasonable stopgap; the guardrail's hard ceiling is
  // unchanged and still Post-tuned regardless of what the model writes.
  const formatGuidance: Record<Format, string> = {
    Post: 'Post (1080x1350) is the format these word budgets were measured against -- use them as given.',
    Square: 'Square (1080x1080) is 20% shorter than Post -- favor the TIGHTER end of the word budget below, every word costs more vertical room here.',
    Story: 'Story (1080x1920) is 42% taller than Post -- there is a little more breathing room than the budget below implies, but do not pad captions just to fill space.',
  }

  // Real product decision (Jaylen, 2026-07-21): some templates reserve their strong, distinctive
  // multi-photo motif for the cover slide only -- inner slides simplify to fewer photos so the
  // motif doesn't repeat identically on every slide. Classic's 2-circle "proof" device was the
  // first real case (pipeline.ts's CIRCLES_DISPLAY toggle); Photo Grid's fixed asymmetric 3-photo
  // layout is the same category of risk, extended the same day (pipeline.ts's
  // GRID_MAIN_WIDTH/GRID_SIDE_DISPLAY toggles). Mirrors pipeline.ts's COVER_ONLY_MOTIF -- kept as
  // a separate, simpler map here since this prompt only needs the inner slide's photo COUNT, not
  // pipeline.ts's full field-remapping detail.
  const COVER_ONLY_MOTIF_INNER_COUNT: Record<string, number> = {
    '1-cover-circles.html': 1,
    '8-photo-grid.html': 1,
  }
  const coverOnlyInnerCount = COVER_ONLY_MOTIF_INNER_COUNT[templateFile]
  const photoSlotsInstruction =
    coverOnlyInnerCount !== undefined
      ? `Slide 1 (the cover) needs ${photoCount} real photos: fill PHOTO_1${photoCount >= 2 ? ', PHOTO_2' : ''}${photoCount >= 3 ? ', PHOTO_3' : ''} in top-to-bottom order (matching the template's real photo placeholder names) with a short scene-level search brief each (e.g. "man applying sunscreen outdoors photo"), NOT a URL and NOT the placeholder's real name. Slides 2-4 use a deliberately simplified version of this same template -- so the cover's distinctive multi-photo layout doesn't repeat identically on every slide -- and need only ${coverOnlyInnerCount} real photo${coverOnlyInnerCount === 1 ? '' : 's'}: fill PHOTO_1${coverOnlyInnerCount >= 2 ? ' and PHOTO_2' : ''}, leave the rest unset. The CTA slide (5) never needs photos -- leave all three unset there.`
      : `Each of the 4 content slides in this template needs ${photoCount} real photo${photoCount === 1 ? '' : 's'}. The template's own HTML above uses real placeholder names for these (in top-to-bottom order) -- but your response uses generic slots instead: fill PHOTO_1${photoCount >= 2 ? ', PHOTO_2' : ''}${photoCount >= 3 ? ', PHOTO_3' : ''} in that same top-to-bottom order with a short scene-level search brief (e.g. "man applying sunscreen outdoors photo"), NOT a URL and NOT the placeholder's real name.${photoCount < 3 ? ` Leave ${photoCount === 1 ? 'PHOTO_2 and PHOTO_3' : 'PHOTO_3'} unset on content slides -- this template doesn't use ${photoCount === 1 ? 'them' : 'it'}.` : ''} The CTA slide (5) never needs photos -- leave all three unset there.`

  const systemPrompt = `You are writing the real content for a 5-slide Instagram/social carousel. You have already been told the content strategy (Angle), visual template, and format -- your job is ONLY the topic, the images each slide needs (as search briefs, not URLs), and the actual caption/headline copy. Do not reconsider or override the Angle/Look/TemplateVariant choices below, even if the brief seems to suggest a different shape -- the explicit picks outrank an inferred vibe from free text.

## Format (${input.format})

${formatGuidance[input.format]}

## Content strategy (Angle = ${input.angle})

${contentStrategies}

## Template conventions (this carousel uses ${templateFile} for all 4 content slides, ${CTA_TEMPLATE} for slide 5, always)

${templatesGuide}

## ${modeInstruction}

## The actual template file for slides 1-4 -- read its own top comment block for exact dual/triple-mode field conventions

\`\`\`html
${templateHtml}
\`\`\`

## The CTA template for slide 5 -- always this file, never altered/flipped

\`\`\`html
${ctaHtml}
\`\`\`

## Generation rules (images, brief-parsing, captions) -- follow these exactly

${generationBehavior}

## Word budgets (measured empirically against real renders -- exceeding these risks visible clipping)

Value angle: <=15 words/slide. Narrative (growth): no fixed cap, one story beat per slide. Education: <=15 words on hook/payoff slides, 20-25 on mechanism slides. These are word counts for the writing itself; a separate automated check enforces hard character ceilings per template field after you write, so err toward the tighter end rather than the maximum.

${input.voiceDescription ? `## Brand voice\n\n${input.voiceDescription}\n\nA specific voice quirk or founder detail belongs in the caption, not flattened into generic copy.\n` : ''}
## Photo slots

${photoSlotsInstruction}
${input.hasReferenceImages ? 'The user has uploaded their own reference photos for some slides -- still write a photo brief for every slot the template needs (used as a fallback description / for any slot their uploads don\'t cover), the caller decides which slots actually use the upload vs. your brief.' : ''}
${researchSection}
${briefInstruction}

Return exactly 5 slides in order (4 content + 1 CTA). Caption color-clause convention is documented above, and photo-slot filling is documented in "Photo slots" above -- follow both exactly.

Do all reasoning and any arithmetic (percentages, unit conversions, word/character counting) yourself, directly in plain text. Do not write or execute code for any part of this task -- there is no tool of any kind available in this request.

CRITICAL, checked automatically after you respond: every single slide's "values" object MUST contain real key-value pairs (the actual caption/headline/stat text for that slide) and every content slide MUST have its required PHOTO_ slots filled with a real scene description, exactly as specified in "Photo slots" above (all 4 content slides need the same count for this template, EXCEPT for the cover-only-motif templates named in "Photo slots" above, where only slide 1 needs the full count and slides 2-4 need fewer). Leaving a required slot unset/empty on any slide is an incomplete, failed response, not a valid shortcut -- write the actual content for all 5 slides before returning.`

  const format = zodOutputFormat(GenerationOutput)

  // No tools attached, ever, for this call -- this is the real fix for the refusal bug (Opus was
  // invoking an ungranted code_execution tool whenever web_search was attached, triggering a
  // safety-classifier refusal that cut responses short; see session log 2026-07-20). Research now
  // happens beforehand via Tavily (plain HTTP, above), handed to the model as plain text instead
  // of giving it its own search tool.
  async function attempt(messages: Anthropic.MessageParam[]): Promise<string> {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      // 16384 (bumped from 8192, which measured too low for a full 5-slide structured payload).
      max_tokens: 16384,
      tools: [],
      system: systemPrompt,
      messages,
      output_config: { format },
    })

    // Still using .create() instead of .parse() and manually selecting the last text block --
    // harmless now that there's only ever one block (no tools means no preamble text), but no
    // reason to revert since .parse()'s first-block-wins behavior was a real bug found here.
    const textBlocks = message.content.filter((block) => block.type === 'text')
    console.log(
      `[generation] captions call: stop_reason=${message.stop_reason}, content blocks=[${message.content.map((b) => b.type).join(', ')}], text block lengths=[${textBlocks.map((b) => b.text.length).join(', ')}], usage=${JSON.stringify(message.usage)}`
    )
    const finalBlock = textBlocks[textBlocks.length - 1]
    if (!finalBlock) {
      throw new Error(`Caption generation returned no text content (stop_reason: ${message.stop_reason})`)
    }
    console.log(`[generation] full raw output (${finalBlock.text.length} chars): ${finalBlock.text}`)
    return finalBlock.text
  }

  const openingMessage: Anthropic.MessageParam = {
    role: 'user',
    content: 'Write the real content for this carousel now.',
  }

  const firstRawText = await attempt([openingMessage])
  try {
    return format.parse(firstRawText)
  } catch (error) {
    // Measured live (2026-07-20): Opus can satisfy the JSON schema with `{}` for every slide's
    // values/photoBriefs while doing almost none of the actual writing (one real run: 21k input
    // tokens, 125 output tokens, real title, five empty slide objects) -- the .refine() above
    // catches that as a validation failure. One retry, in the SAME conversation so the model sees
    // its own incomplete answer plus a direct correction -- much stronger than silently re-issuing
    // the identical prompt from scratch.
    console.log(
      `[generation] first attempt failed validation, retrying once with a direct correction: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const secondRawText = await attempt([
    openingMessage,
    { role: 'assistant', content: firstRawText },
    {
      role: 'user',
      content:
        'That response left "values" and/or "photoBriefs" empty (or near-empty) on one or more slides -- that is an incomplete response, not a valid shortcut. Write the real caption/headline/stat text and real photo scene descriptions for every slide now, following all the same rules as before.',
    },
  ])

  try {
    return format.parse(secondRawText)
  } catch (error) {
    console.log(`[generation] retry also failed validation (last 300 chars): ...${secondRawText.slice(-300)}`)
    throw error
  }
}
