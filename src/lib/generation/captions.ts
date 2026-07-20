import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { readFile } from 'fs/promises'
import path from 'path'
import type { Angle, Look, TemplateVariant } from '@/lib/types'
import { templateFileFor, CTA_TEMPLATE } from './templates'
import { loadTemplate } from './render'

const anthropic = new Anthropic()
const REFERENCE_DIR = path.join(process.cwd(), 'reference')

const SlideOutput = z.object({
  // Which real photo slots this slide's template needs filled, described as a short scene-level
  // search brief per IMG placeholder (e.g. {"BG_IMG": "man applying sunscreen outdoors photo"}) --
  // NOT a URL. Actual photo sourcing (user uploads first, web search for the shortfall) happens
  // as a separate step; this call only decides what each photo should show.
  photoBriefs: z.record(z.string(), z.string()),
  // Every non-image placeholder this slide's template needs (CAPTION_HTML, HEADLINE_HTML,
  // KICKER, STORY_HTML, STAT_NUMBER, STAT_LABEL, TAGLINE, STATEMENT_HTML, etc.) -- only the
  // ones that apply to whichever mode this slide uses, per the dual/triple-mode conventions in
  // the template's own comments below. Leave every other template's fields out entirely.
  values: z.record(z.string(), z.string()),
})

const GenerationOutput = z.object({
  title: z.string().max(60),
  slides: z.array(SlideOutput).length(5),
})

export type GeneratedCarousel = z.infer<typeof GenerationOutput>

export async function generateCaptions(input: {
  angle: Angle
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  voiceDescription: string | null
  hasReferenceImages: boolean
}): Promise<GeneratedCarousel> {
  const templateFile = templateFileFor(input.look, input.templateVariant)

  const [contentStrategies, templatesGuide, generationBehavior, templateHtml, ctaHtml] = await Promise.all([
    readFile(path.join(REFERENCE_DIR, 'content-strategies.md'), 'utf-8'),
    readFile(path.join(REFERENCE_DIR, 'templates-guide.md'), 'utf-8'),
    readFile(path.join(REFERENCE_DIR, 'initial-generation-behavior.md'), 'utf-8'),
    loadTemplate(templateFile),
    loadTemplate(CTA_TEMPLATE),
  ])

  // Several TemplateVariants (Side by Side, Photo Column, Editorial, Photo Grid, Split Flip) map
  // to the EXACT SAME template file for both the "Photo Focus" and "Bold Stat" Looks -- the file
  // alone can't tell the model which mode to fill (plain caption vs. a stat takeover). Without
  // this being explicit, a Bold Stat carousel could silently come out in plain-caption mode.
  const modeInstruction =
    input.look === 'Bold Stat'
      ? 'This carousel\'s Look is "Bold Stat" -- every content slide MUST use the template\'s stat-takeover mode (STAT_NUMBER + STAT_LABEL), even though the same file also supports a plain-caption mode. Leave CAPTION_HTML/HEADLINE_HTML/TAGLINE unset on content slides.'
      : 'This carousel\'s Look is "' + input.look + '" -- do NOT use stat-takeover mode (STAT_NUMBER/STAT_LABEL) on any content slide even if the template file supports it; that mode is reserved for the separate "Bold Stat" Look. Use whichever non-stat mode the template\'s own comments describe (plain caption, or kicker+headline/story if this is a dual-mode template).'

  const briefInstruction = input.brief.trim()
    ? `The user's brief: "${input.brief.trim()}"\n\nParse this by shape: an empty/near-empty brief means research a real, current, relevant topic yourself; a bare topic phrase is the subject (research supporting facts if the phrase alone isn't enough for 5 real slides); a detailed paragraph should be extracted concretely, not compressed away -- a specific claim or credential beats a generic rewording.`
    : `No brief was given -- this is the normal case, not an error. Research a real, current, relevant topic yourself${input.voiceDescription ? ", weighted toward the voice/audience notes below" : ''}.`

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

${briefInstruction}

Return exactly 5 slides in order (4 content + 1 CTA). Caption color-clause convention and per-template photo-slot names are both documented above -- follow them exactly, don't invent new placeholder names.`

  const format = zodOutputFormat(GenerationOutput)

  // Deliberately using .create() instead of .parse(): with web_search attached, the model emits
  // short natural-language text blocks ("Let me check current stats...") ahead of its final JSON
  // answer, and the SDK's .parse() helper (lib/parser.js) always grabs the FIRST text block in
  // message.content to run through the output format's parser -- that's the preamble, not the
  // answer, so .parse() reliably fails here. Selecting the LAST text block ourselves instead.
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    // 8192 was measured to truncate mid-JSON on a real run: 3 web_search round-trips plus the
    // full 5-slide structured output (photoBriefs + values per slide) share this one turn's
    // budget, and research-heavy briefs can burn through it before the JSON closes.
    max_tokens: 16384,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'Write the real content for this carousel now.',
      },
    ],
    output_config: { format },
  })

  const textBlocks = message.content.filter((block) => block.type === 'text')
  console.log(
    `[generation] captions call: stop_reason=${message.stop_reason}, content blocks=[${message.content.map((b) => b.type).join(', ')}], text block lengths=[${textBlocks.map((b) => b.text.length).join(', ')}]`
  )
  const finalBlock = textBlocks[textBlocks.length - 1]
  if (!finalBlock) {
    throw new Error(`Caption generation returned no text content (stop_reason: ${message.stop_reason})`)
  }

  try {
    return format.parse(finalBlock.text)
  } catch (error) {
    console.log(`[generation] failed text block (last 300 chars): ...${finalBlock.text.slice(-300)}`)
    throw error
  }
}
