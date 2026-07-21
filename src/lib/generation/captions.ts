import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { readFile } from 'fs/promises'
import path from 'path'
import type { Angle, Look, TemplateVariant } from '@/lib/types'
import { templateFileFor, CTA_TEMPLATE } from './templates'
import { loadTemplate } from './render'
import { tavilySearch } from './research'

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

// The full, real universe of content placeholder names across every template file (grepped
// directly from templates/*.html, not guessed) -- excludes image slots (own field, photoBriefs),
// brand/layout fields (PRIMARY/SECONDARY/CANVAS_H/LOGO_HTML/FONT_*/*_SIZE/*_POSITION/etc., which
// the pipeline sets itself from the brand kit or a repair step, never the model). Explicit named
// fields instead of the previous open z.record(string,string): measured live (2026-07-20) that
// Opus can satisfy an open record by returning `{}` for every slide -- valid JSON, none of the
// actual writing done. Naming the exact real fields as the JSON schema (rather than making the
// model synthesize arbitrary key names by reading them out of a buried HTML template) is a much
// easier structured-output target, not just a stronger validation check.
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
  MICRO_TEXT: z.string().optional(),
  CIRCLE_BLOCK: z.string().optional(),
})

// Real IMG placeholder names for a given template file, e.g. ["BG_IMG", "CIRCLE_L_IMG",
// "CIRCLE_R_IMG"] for 1-cover-circles.html -- extracted from the actual template text (grepped
// live, matches the real universe found across templates/*.html: BG_IMG, CIRCLE_IMG,
// CIRCLE_L_IMG, CIRCLE_R_IMG, IMG_MAIN, IMG_TOP/BOTTOM/LEFT/RIGHT), not a static guess. cta.html
// has none, so the CTA slide's photoBriefs schema below correctly ends up requiring nothing.
function extractImagePlaceholders(templateHtml: string): string[] {
  const matches = templateHtml.matchAll(/\{\{([A-Z_]*IMG[A-Z_]*)(?:\|[^}]*)?\}\}/g)
  return Array.from(new Set(Array.from(matches, (m) => m[1])))
}

// Same fix as ContentValues above, applied to photoBriefs: previously an open
// z.record(string,string), which the model could (and did) satisfy with `{}`. Built per-call
// (below) from whichever template is actually in use, since image field names differ per
// template -- naming them explicitly gives the model a concrete target instead of an
// open-ended "invent whatever keys you think apply" record.
function buildSlideSchema(imageFields: string[]) {
  const photoBriefsShape: Record<string, z.ZodOptional<z.ZodString>> = {}
  for (const field of imageFields) photoBriefsShape[field] = z.string().optional()

  return z
    .object({
      photoBriefs: z.object(photoBriefsShape),
      // Only the fields that apply to whichever mode this slide uses, per the dual/triple-mode
      // conventions in the template's own comments -- leave every other field unset/absent.
      values: ContentValues,
    })
    .refine((slide) => Object.values(slide.values).some((v) => v && v.trim().length > 0), {
      message: 'values must not be empty -- every slide needs real caption/headline content',
    })
    .refine(
      (slide) => imageFields.length === 0 || Object.values(slide.photoBriefs).some((v) => v && v.trim().length > 0),
      {
        message: `photoBriefs must not be empty -- this template needs real photo descriptions for: ${imageFields.join(', ')}`,
      }
    )
}

export type GeneratedCarousel = {
  title: string
  slides: {
    photoBriefs: Record<string, string | undefined>
    values: Record<string, string | undefined>
  }[]
}

export async function generateCaptions(input: {
  angle: Angle
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  voiceDescription: string | null
  hasReferenceImages: boolean
}): Promise<GeneratedCarousel> {
  const templateFile = templateFileFor(input.look, input.templateVariant)

  const [contentStrategies, templatesGuideFull, generationBehaviorFull, templateHtml, ctaHtml] = await Promise.all([
    readFile(path.join(REFERENCE_DIR, 'content-strategies.md'), 'utf-8'),
    readFile(path.join(REFERENCE_DIR, 'templates-guide.md'), 'utf-8'),
    readFile(path.join(REFERENCE_DIR, 'initial-generation-behavior.md'), 'utf-8'),
    loadTemplate(templateFile),
    loadTemplate(CTA_TEMPLATE),
  ])

  // Built per-call since image field names differ per template -- see buildSlideSchema's comment.
  const contentImageFields = extractImagePlaceholders(templateHtml)
  const ctaImageFields = extractImagePlaceholders(ctaHtml)
  const ContentSlideSchema = buildSlideSchema(contentImageFields)
  const CtaSlideSchema = buildSlideSchema(ctaImageFields)
  const GenerationOutput = z.object({
    title: z.string().max(60),
    slides: z.tuple([ContentSlideSchema, ContentSlideSchema, ContentSlideSchema, ContentSlideSchema, CtaSlideSchema]),
  })
  console.log(
    `[generation] image fields for this template: content=[${contentImageFields.join(', ')}], cta=[${ctaImageFields.join(', ')}]`
  )

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

  const systemPrompt = `You are writing the real content for a 5-slide Instagram/social carousel. You have already been told the content strategy (Angle), visual template, and format -- your job is ONLY the topic, the images each slide needs (as search briefs, not URLs), and the actual caption/headline copy. Do not reconsider or override the Angle/Look/TemplateVariant choices below, even if the brief seems to suggest a different shape -- the explicit picks outrank an inferred vibe from free text.

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
${input.hasReferenceImages ? 'The user has uploaded their own reference photos for some slides -- still write a photoBrief for every image slot (used as a fallback description / for any slot their uploads don\'t cover), the caller decides which slots actually use the upload vs. your brief.' : ''}
${researchSection}
${briefInstruction}

Return exactly 5 slides in order (4 content + 1 CTA). Caption color-clause convention and per-template photo-slot names are both documented above -- follow them exactly, don't invent new placeholder names.

Do all reasoning and any arithmetic (percentages, unit conversions, word/character counting) yourself, directly in plain text. Do not write or execute code for any part of this task -- there is no tool of any kind available in this request.

CRITICAL, checked automatically after you respond: every single slide's "values" object MUST contain real key-value pairs (the actual caption/headline/stat text for that slide) and every content slide's "photoBriefs" MUST contain a real scene description per image slot the template needs. An empty {} for either field on any slide is an incomplete, failed response, not a valid shortcut -- write the actual content for all 5 slides before returning.`

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
