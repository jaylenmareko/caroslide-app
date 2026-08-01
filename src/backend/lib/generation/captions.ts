import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Angle, Format, Look, TemplateVariant } from '@/backend/lib/types'
import { templateFileFor, CTA_TEMPLATE } from './templates'
import { loadTemplate, requiredPlaceholderFields } from './render'
import { tavilySearch } from './research'
import { photosNeeded } from './images'
import { EDITABLE_FIELDS } from './editableFields'
import { REFERENCE_DOCS } from './referenceDocs.generated'

const anthropic = new Anthropic()

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
// Exported (2026-07-21, chat-editing build) -- a copy-rewrite edit needs the exact same field
// universe as initial generation, not a second drifted schema.
export const ContentValues = z.object({
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

// Real bug found live (2026-07-22, right after the per-slide-call redesign): with each slide
// generated in isolation, the model started using WRONG field names for content slides -- e.g.
// STATEMENT_HTML/SUBHEAD/TAGLINE/STAT_NUMBER on Bold Hook, a template that only ever has
// KICKER/HEADLINE_HTML/STORY_HTML -- and even wrote the literal string "HEADLINE_HTML" as a
// field's VALUE, a clear sign of genuine confusion about which of ContentValues' 10 possible keys
// actually apply to THIS specific template. The original 5-in-1 call never showed this (the
// other 4 slides' context may have implicitly reinforced the right fields); each isolated call
// needs to be told explicitly. Reuses editableFields.ts's real per-template field map (already
// built for the click-in-place editor) rather than a second, drifted list -- filtered to just the
// 'text' kind entries that are also real ContentValues keys (excludes photo fields, and excludes
// cta.html's MICRO_TEXT, which has its own template default and was never part of this schema).
const CONTENT_VALUES_KEYS = new Set(Object.keys(ContentValues.shape))
function validValuesFieldsFor(templateFile: string): string[] {
  return (EDITABLE_FIELDS[templateFile] ?? [])
    .filter((f) => f.kind === 'text' && CONTENT_VALUES_KEYS.has(f.field))
    .map((f) => f.field)
}

// Generic photo slots, in the same top-to-bottom order the template's own HTML presents its real
// {{...IMG}} placeholders (told explicitly in the prompt below). NOT real field names, and NOT a
// URL -- a short scene-level search brief per slot (e.g. "man applying sunscreen outdoors photo").
// Leave a slot unset if this template needs fewer than 3 photos on this slide.
const PhotoBriefs = z.object({
  PHOTO_1: z.string().optional(),
  PHOTO_2: z.string().optional(),
  PHOTO_3: z.string().optional(),
})

const requireRealContent = {
  refine: (slide: { values: Record<string, unknown> }) =>
    Object.values(slide.values).some((v) => typeof v === 'string' && v.trim().length > 0),
  message: 'values must not be empty -- every slide needs real caption/headline content',
}

// Real bug found live (2026-07-22, AFTER the wrong-key whitelist fix above shipped): a per-template
// prose "these keys are REQUIRED" instruction still let the model just omit HEADLINE_HTML on
// 12-hook-block.html and pour the same content into STORY_HTML/CTA_TEXT instead -- because
// ContentValues makes every key `.optional()`, the schema itself never actually forbade skipping a
// required key, so "required" was pure prose the model could and did ignore. Real fix: build the
// `values` schema PER TEMPLATE, at the moment each of the 5 calls is made, from the same two real
// sources of truth already used for the prose whitelist (validValuesFieldsFor for which keys apply,
// requiredPlaceholderFields for which of those have no `|default` in the template's own HTML) --
// and make a required field a plain non-optional z.string() instead of `.optional()`. A required
// (non-optional) object key is the one construct this SDK/API has reliably enforced all session
// (title/photoBriefs/values themselves never once went missing); this makes the same guarantee
// apply per-field instead of just per-object, closing the actual escape hatch instead of asking
// the model nicely not to use it.
// Real bug found live (2026-07-22, same day, right after this schema fix's own real-required-field
// win): dual-mode templates' STAT_NUMBER/STAT_LABEL have no `|default` in the raw HTML either (the
// same signal that correctly makes HEADLINE_HTML required on Bold Hook), so this made them
// schema-required on EVERY carousel using a dual-mode template -- including a plain-mode (Photo
// Focus) carousel that should never need them at all, forcing a spurious validation failure and an
// extra retry every single time. `requiredPlaceholderFields` reads the template's raw HTML alone --
// it has no idea a field only applies in ONE of two modes. Real fix: a field belonging to the mode
// NOT in use this carousel is never schema-required, regardless of what the raw HTML says --
// pipeline.ts force-blanks it to "" after the fact anyway (see its own comment), so requiring it
// here only ever produced a false failure, never a real one.
function buildValuesSchema(templateFile: string, rawTemplateHtml: string, isStatMode: boolean) {
  const requiredSet = requiredPlaceholderFields(rawTemplateHtml)
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of validValuesFieldsFor(templateFile)) {
    const isStatField = field === 'STAT_NUMBER' || field === 'STAT_LABEL'
    const required = requiredSet.has(field) && isStatField === isStatMode
    shape[field] = required ? z.string().min(1) : z.string().optional()
  }
  return z.object(shape)
}

function slideSchemasFor(valuesSchema: z.ZodObject<Record<string, z.ZodTypeAny>>) {
  const shape = z.object({ photoBriefs: PhotoBriefs, values: valuesSchema })
  return {
    slide: shape.refine(requireRealContent.refine, { message: requireRealContent.message }),
    cover: shape.extend({ title: z.string().max(60) }).refine(requireRealContent.refine, {
      message: requireRealContent.message,
    }),
  }
}

export type GeneratedCarousel = {
  title: string
  slides: Array<{ photoBriefs: z.infer<typeof PhotoBriefs>; values: Record<string, string | undefined> }>
}

// Real bug found live (2026-07-22, Bold Hook's real generation, confirmed via the same
// standalone zodOutputFormat-dump discipline as every other zod-SDK finding this session):
// z.array(SlideOutput).length(5) never actually constrained anything -- this SDK demotes
// minItems/maxItems to an inert description string (same bug class as tuple prefixItems/record
// propertyNames/enum values/union literals found earlier), so nothing ever structurally forced
// the model to return 5 items; it was pure prose instruction, and it kept returning 1-3 slides
// instead (confirmed across both Growth and Value angles, ruling out an angle-specific
// writing-style cause). Two workarounds tried and both hit real, separate ceilings: 5
// separately-required named fields worked in an isolated reproduction but the real production
// schema was rejected outright with "Schema is too complex"; patching the array schema to
// restore real minItems/maxItems hit a hard, documented Anthropic API limit instead --
// "'minItems' values other than 0 or 1 are not supported." Exact-length array enforcement is
// genuinely not possible via structured outputs at all, confirmed, not a guess.
//
// Real fix (2026-07-22, per Jaylen's direction): stop asking for all 5 slides in one call.
// Generate each of the 5 slides with its OWN independent call, each with a single-slide schema
// (no array, nothing to under-count -- a single required object is the one construct this SDK/
// API reliably enforces, confirmed by `title`/the old `slides` key never once being missing
// across dozens of real runs tonight). Costs more total tokens (the shared context repeats per
// call instead of once) but no wall-clock cost -- the 5 calls run in parallel, same as the
// already-parallelized photo/render work in pipeline.ts.

const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001'

const AngleClassification = z.object({ angle: z.string() })

// Same 3 descriptions the wizard used to show a user picking manually -- kept identical so
// removing the question doesn't change what each angle actually means, just who decides it.
const ANGLE_DESCRIPTIONS: Record<Angle, string> = {
  Value: 'Direct tips, no story -- a straightforward list of practical advice.',
  Growth: 'A hook that builds into a story -- narrative arc, personal or brand journey.',
  Education: 'A real fact, explained -- teaches something specific and true.',
}

/**
 * Picks the content angle on the user's behalf (2026-08-01) -- a real usability test found a
 * first-time user with zero product context got stuck on "Value vs. Growth vs. Education" as the
 * very first thing the wizard asked, before she even understood what the product was. The
 * distinction is real and still drives the whole caption arc (see the "Content strategy" section
 * built below in generateCaptions) -- taking it off the user just means an AI call decides it
 * instead of a cold, uninformed guess, the same way this pipeline already decides photos, copy,
 * and layout details on the user's behalf.
 */
export async function classifyAngle(brief: string): Promise<Angle> {
  const systemPrompt = `Pick the single best content angle for a 5-slide social media carousel, based on the brief below. Choose exactly one of:

${(Object.entries(ANGLE_DESCRIPTIONS) as [Angle, string][]).map(([a, d]) => `- ${a}: ${d}`).join('\n')}

## Brief

${brief || '(no brief given -- pick whichever angle best fits a generic, broadly appealing post)'}`

  const format = zodOutputFormat(AngleClassification)
  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 128,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Pick the angle now.' }],
    output_config: { format },
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}'
  const parsed = format.parse(text)
  // No real schema-level enum constraint survives this SDK's zod conversion (same bug class
  // documented throughout this file) -- validate defensively, fall back to the simplest/safest
  // angle rather than trust the model never invents a 4th value.
  const valid: Angle[] = ['Value', 'Growth', 'Education']
  return valid.includes(parsed.angle as Angle) ? (parsed.angle as Angle) : 'Value'
}

const ColorClassification = z.object({ paletteId: z.string() })

// Caroslide's own real brand colors -- matches globals.css's --green/--green-bright (the actual
// app-wide accent, not a placeholder), used as both the "no signal" fallback and the "caroslide"
// palette choice below.
const CAROSLIDE_PRIMARY = '#512888'
const CAROSLIDE_SECONDARY = '#38BDF8'

// A curated set, not free-form hex generation (2026-08-01, Brand Kit removed for v1) -- an LLM
// asked to invent arbitrary hex codes reliably produces muddy or illegible combinations; picking
// from a small set of real, pre-designed pairs is far more reliable while still being "based on
// the message," per Jaylen's direction.
const CURATED_PALETTES: Record<string, { primary: string; secondary: string; desc: string }> = {
  caroslide: { primary: CAROSLIDE_PRIMARY, secondary: CAROSLIDE_SECONDARY, desc: "Caroslide's own default -- use this when the brief gives no real color/mood/industry signal" },
  earthy: { primary: '#5B7A5E', secondary: '#F1E6D2', desc: 'Warm, natural, grounded -- wellness, food, agriculture, sustainability' },
  tech: { primary: '#2563EB', secondary: '#38BDF8', desc: 'Cool, sharp, modern -- software, AI, startups, productivity' },
  bold: { primary: '#DC2626', secondary: '#F59E0B', desc: 'High-energy, urgent, confident -- fitness, sales, hot takes' },
  luxury: { primary: '#78350F', secondary: '#D4AF37', desc: 'Elegant, premium -- fashion, finance, high-end services' },
  playful: { primary: '#DB2777', secondary: '#FBBF24', desc: 'Fun, youthful, energetic -- entertainment, social, lifestyle' },
  calm: { primary: '#0F766E', secondary: '#A7F3D0', desc: 'Soothing, trustworthy -- healthcare, mindfulness, financial advice' },
}

/**
 * Picks PRIMARY/SECONDARY accent colors from the brief instead of asking the user upfront
 * (2026-08-01, Brand Kit removed for v1 -- Jaylen's direction: "pick the text colors for them
 * based on their message... if we can't gather anything from the message then default to
 * caroslide colors"). Skips the AI call entirely on an empty brief -- there's nothing to infer
 * from, and the "caroslide" palette IS the defined default for exactly that case.
 */
export async function classifyColors(brief: string): Promise<{ primary: string; secondary: string }> {
  if (!brief.trim()) return { primary: CAROSLIDE_PRIMARY, secondary: CAROSLIDE_SECONDARY }

  const systemPrompt = `Pick the single best color palette for a social media carousel, based on the brief below. Choose exactly one palette ID:

${Object.entries(CURATED_PALETTES).map(([id, p]) => `- ${id}: ${p.desc}`).join('\n')}

If the brief gives no real signal about mood, industry, or vibe, choose "caroslide".

## Brief

${brief}`

  const format = zodOutputFormat(ColorClassification)
  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 128,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Pick the palette now.' }],
    output_config: { format },
  })
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}'
  const parsed = format.parse(text)
  // Same defensive-validation discipline as classifyAngle above -- fall back to the real default
  // palette rather than trust the model never invents an unlisted paletteId.
  const palette = CURATED_PALETTES[parsed.paletteId] ?? CURATED_PALETTES.caroslide
  return { primary: palette.primary, secondary: palette.secondary }
}

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

  // Bundled as plain string constants (referenceDocs.generated.ts), not read from disk at
  // request time -- Cloudflare Workers has no real filesystem at runtime, same reason
  // loadTemplate's HTML templates are pre-generated too (see generate-reference.mjs's comment).
  const contentStrategies = REFERENCE_DOCS['content-strategies.md']
  const templatesGuideFull = REFERENCE_DOCS['templates-guide.md']
  const generationBehaviorFull = REFERENCE_DOCS['initial-generation-behavior.md']
  const [templateHtml, ctaHtml] = await Promise.all([
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
      ? 'This carousel\'s Look is "Bold Stat" -- this slide MUST use the template\'s stat-takeover mode (STAT_NUMBER + STAT_LABEL), even though the same file also supports a plain-caption mode. Leave CAPTION_HTML/HEADLINE_HTML/TAGLINE unset.'
      : 'This carousel\'s Look is "' + input.look + '" -- do NOT use stat-takeover mode (STAT_NUMBER/STAT_LABEL) even if the template file supports it; that mode is reserved for the separate "Bold Stat" Look. Use whichever non-stat mode the template\'s own comments describe (plain caption, or kicker+headline/story if this is a dual-mode template) -- and actually write that field. A short tagline/kicker/headline alone with the caption/story field left blank is NOT valid in this mode -- every non-stat slide needs real supporting body text, not just a one-line label.'

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

  // Square/Story removed 2026-07-23 (Jaylen: focus strictly on Post) -- this used to vary by
  // Format, but Post is the only format now and the word budgets below were always measured
  // against it, so the guidance is just a flat statement of that fact.
  const formatGuidance: Record<Format, string> = {
    Post: 'Post (1080x1350) is the format these word budgets were measured against -- use them as given.',
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
  // Each of the 5 slides now gets its own independent generation call (see the real-bug comment
  // above SlideOutput/CoverSlideOutput for why) -- this is the per-slide photo count instead of
  // one shared instruction describing all 5 at once. Real bug found live (2026-07-22, Bold Hook's
  // first real generation, fixed here too): a genuinely photo-less template (photoCount 0) needs
  // its own branch, not a tweaked conditional, or the instruction ends up self-contradictory
  // ("needs 0 real photos... fill PHOTO_1").
  function photoCountForSlide(slideNumber: number): number {
    if (slideNumber === 5) return 0 // CTA never needs photos
    if (photoCount === 0) return 0 // genuinely photo-less template (Bold Hook, Plain Text)
    if (slideNumber === 1) return photoCount // cover gets the full count
    return coverOnlyInnerCount ?? photoCount // inner slides simplify only for cover-only-motif templates
  }

  function photoSlotsInstructionFor(count: number): string {
    if (count === 0) {
      return `This slide has no photo placeholders -- leave PHOTO_1, PHOTO_2, and PHOTO_3 unset. Do not invent a photo brief.`
    }
    return `This slide needs ${count} real photo${count === 1 ? '' : 's'}. The template's own HTML above uses real placeholder names for these (in top-to-bottom order) -- but your response uses generic slots instead: fill PHOTO_1${count >= 2 ? ', PHOTO_2' : ''}${count >= 3 ? ', PHOTO_3' : ''} in that same top-to-bottom order with a short scene-level search brief (e.g. "man applying sunscreen outdoors photo"), NOT a URL and NOT the placeholder's real name.${count < 3 ? ` Leave ${count === 1 ? 'PHOTO_2 and PHOTO_3' : 'PHOTO_3'} unset -- this slide doesn't use ${count === 1 ? 'them' : 'it'}.` : ''}`
  }

  // Shared across all 5 calls -- the parts of the old single big prompt that don't vary by which
  // slide is being written. Content-strategy/generation-rules/word-budget/voice sections are
  // identical for every slide; only the template-conventions block, the framing line, and the
  // photo-slots instruction differ per slide (built in buildSlideSystemPrompt below).
  const sharedPromptTail = `## Generation rules (images, brief-parsing, captions) -- follow these exactly

${generationBehavior}

## Word budgets (measured empirically against real renders -- exceeding these risks visible clipping)

Value angle: <=15 words/slide. Narrative (growth): no fixed cap, one story beat per slide. Education: <=15 words on hook/payoff slides, 20-25 on mechanism slides. These are word counts for the writing itself; a separate automated check enforces hard character ceilings per template field after you write, so err toward the tighter end rather than the maximum.

${input.voiceDescription ? `## Brand voice\n\n${input.voiceDescription}\n\nA specific voice quirk or founder detail belongs in the caption, not flattened into generic copy.\n` : ''}`

  // Real product decision (2026-07-22): the carousel's overall arc (content-strategies.md's
  // Angle document) still needs to reach every slide even though each is generated independently
  // -- each call is told the full arc plus exactly where it sits in it, so slide 2 still reads as
  // "the myth/counter-claim" etc. without needing to see the other 4 slides' actual text.
  function buildSlideSystemPrompt(slideNumber: number): string {
    const isCta = slideNumber === 5
    const isCover = slideNumber === 1
    const roleFraming = isCta
      ? `You are writing ONLY the 5th and final slide of a 5-slide Instagram/social carousel -- the closing CTA slide. The other 4 slides (already written separately) cover the hook/claim/proof/resolution arc for this Angle; your job is just the close (follow-for-more / save-this / clear next step), not a recap of the whole arc.`
      : `You are writing ONLY slide ${slideNumber} of 5 in an Instagram/social carousel (slide 5 is always a separate CTA slide, not your concern). Based on this Angle's arc (below) and this being slide ${slideNumber} of the 4 content slides, ${isCover ? 'this is the COVER/hook slide -- it carries the most design weight and needs to earn the swipe.' : 'determine this slide\'s specific role in that arc yourself and write accordingly -- do not repeat the cover\'s hook, this slide has its own job in the sequence.'}`

    const count = photoCountForSlide(slideNumber)
    const templateSection = isCta
      ? `## The CTA template -- always this file, never altered/flipped\n\n\`\`\`html\n${ctaHtml}\n\`\`\``
      : `## Template conventions (this carousel uses ${templateFile} for every content slide)\n\n${templatesGuide}\n\n## ${modeInstruction}\n\n## The actual template file -- read its own top comment block for exact dual/triple-mode field conventions\n\n\`\`\`html\n${templateHtml}\n\`\`\``

    const validFields = validValuesFieldsFor(isCta ? CTA_TEMPLATE : templateFile)
    // Real bug found live (2026-07-22, same day, AFTER the wrong-key fix above shipped): "valid"
    // isn't the same claim as "required" -- 12-hook-block.html's HEADLINE_HTML has no `|default` in
    // the template (see that file's own top comment), so leaving it blank ships a literal broken
    // placeholder, but a whitelist that just lists allowed keys reads as "these are your options,"
    // and the model kept picking KICKER/STORY_HTML instead and leaving HEADLINE_HTML unset. Scans
    // the template's real HTML (requiredPlaceholderFields) so required-vs-optional can never drift
    // from a hand-maintained second list.
    const requiredHtml = isCta ? ctaHtml : templateHtml
    const requiredSet = requiredPlaceholderFields(requiredHtml)
    const requiredFields = validFields.filter((f) => requiredSet.has(f))
    const optionalFields = validFields.filter((f) => !requiredSet.has(f))
    const fieldWhitelist = `## Valid "values" keys for this exact template -- do not use any other key\n\nThe ONLY keys this template actually renders are: ${validFields.join(', ')}. The general schema exposes other keys (CAPTION_HTML, SUBHEAD, STATEMENT_HTML, TAGLINE, STAT_NUMBER, STAT_LABEL, etc.) that belong to OTHER templates, not this one -- if a key isn't in the list above, it does not apply here and must stay completely unset. Never write a field's own name (e.g. the literal text "HEADLINE_HTML") as if it were a value -- that is not real content.\n\n${requiredFields.length ? `REQUIRED, no exceptions -- these fields have no fallback text in the template at all, so leaving ${requiredFields.length === 1 ? 'it' : 'any of them'} blank or unset ships a literal broken "{{FIELD_NAME}}" placeholder on the real rendered image: ${requiredFields.join(', ')}. Write real content for ${requiredFields.length === 1 ? 'this field' : 'every one of these fields'} even if another field also carries the slide's main message -- filling one required field does not excuse leaving another one empty.` : ''}${optionalFields.length ? ` Optional, use only if this slide's mode calls for it: ${optionalFields.join(', ')}.` : ''}`

    return `${roleFraming} Your job is ONLY the topic, the image(s) this slide needs (as a search brief, not a URL), and the actual caption/headline copy for THIS slide. Do not reconsider or override the Angle/Look/TemplateVariant choices below, even if the brief seems to suggest a different shape -- the explicit picks outrank an inferred vibe from free text.

## Format (${input.format})

${formatGuidance[input.format]}

## Content strategy (Angle = ${input.angle}) -- the full arc across all 5 slides, for context on where slide ${slideNumber} sits

${contentStrategies}

${templateSection}

${fieldWhitelist}

${sharedPromptTail}
## Photo slot${count === 1 ? '' : 's'}

${photoSlotsInstructionFor(count)}
${input.hasReferenceImages ? 'The user has uploaded their own reference photos -- still write a photo brief for every slot this slide needs (used as a fallback description / for any slot their upload doesn\'t cover), the caller decides whether the upload or your brief actually gets used.' : ''}
${researchSection}
${briefInstruction}
${isCover ? '\nAlso write a real, specific carousel `title` (max 60 chars) -- not a generic restatement of the topic.' : ''}

Do all reasoning and any arithmetic (percentages, unit conversions, word/character counting) yourself, directly in plain text. Do not write or execute code for any part of this task -- there is no tool of any kind available in this request.

CRITICAL, checked automatically after you respond: "values" MUST contain real key-value pairs (the actual caption/headline/stat text for this slide) and, if this slide needs photos, every required PHOTO_ slot MUST be filled with a real scene description exactly as specified in "Photo slot(s)" above. Leaving a required slot unset/empty is an incomplete, failed response, not a valid shortcut.`
  }

  // No tools attached, ever, for these calls -- this is the real fix for the refusal bug (Opus was
  // invoking an ungranted code_execution tool whenever web_search was attached, triggering a
  // safety-classifier refusal that cut responses short; see session log 2026-07-20). Research now
  // happens beforehand via Tavily (plain HTTP, above), handed to the model as plain text instead
  // of giving it its own search tool.
  //
  // Generic over the schema (CoverSlideOutput for slide 1, SlideOutput for slides 2-5) -- same
  // 2-tier retry strategy as before (fresh restart on malformed JSON, same-conversation correction
  // on valid-but-incomplete content), just scoped to one slide's small response instead of a
  // 5-slide batch. A single slide's response is small; 4096 is generous headroom, not the 16384
  // the old 5-in-1 call needed.
  async function generateOneSlide<T extends z.ZodTypeAny>(systemPrompt: string, schema: T): Promise<z.infer<T>> {
    const format = zodOutputFormat(schema)

    async function attempt(messages: Anthropic.MessageParam[]): Promise<string> {
      const message = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        tools: [],
        system: systemPrompt,
        messages,
        output_config: { format },
      })
      const textBlocks = message.content.filter((block) => block.type === 'text')
      console.log(
        `[generation] slide call: stop_reason=${message.stop_reason}, text block lengths=[${textBlocks.map((b) => b.text.length).join(', ')}], usage=${JSON.stringify(message.usage)}`
      )
      const finalBlock = textBlocks[textBlocks.length - 1]
      if (!finalBlock) {
        throw new Error(`Slide generation returned no text content (stop_reason: ${message.stop_reason})`)
      }
      console.log(`[generation] slide raw output (${finalBlock.text.length} chars): ${finalBlock.text}`)
      return finalBlock.text
    }

    const openingMessage: Anthropic.MessageParam = { role: 'user', content: 'Write the real content for this slide now.' }

    const firstRawText = await attempt([openingMessage])
    let firstError: unknown
    try {
      return format.parse(firstRawText)
    } catch (error) {
      firstError = error
      console.log(
        `[generation] slide attempt failed validation, retrying once: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const firstErrorMessage = firstError instanceof Error ? firstError.message : String(firstError)
    const wasMalformedJson = firstErrorMessage.includes('as JSON')

    const secondRawText = wasMalformedJson
      ? await attempt([
          openingMessage,
          {
            role: 'user',
            content:
              'Write the real content for this slide now. Valid JSON only -- watch your string escaping carefully (a straight double-quote inside any text value must be escaped as \\", never left bare), and do not truncate mid-object.',
          },
        ])
      : await attempt([
          openingMessage,
          { role: 'assistant', content: firstRawText },
          {
            role: 'user',
            content:
              'That response left "values" and/or "photoBriefs" empty (or near-empty) -- that is an incomplete response, not a valid shortcut. Write the real caption/headline/stat text and real photo scene description(s) for this slide now, following all the same rules as before.',
          },
        ])

    try {
      return format.parse(secondRawText)
    } catch (error) {
      console.log(`[generation] slide retry also failed validation (last 300 chars): ...${secondRawText.slice(-300)}`)
      throw error
    }
  }

  // Built once per real call (not module scope) -- the schema depends on which template THIS
  // carousel resolved to, per the real-bug comment above buildValuesSchema/slideSchemasFor.
  // isStatMode: false is correct for CTA_TEMPLATE too -- cta.html has no STAT_NUMBER/STAT_LABEL
  // fields at all, so isStatMode never affects that schema either way.
  const contentSchemas = slideSchemasFor(buildValuesSchema(templateFile, templateHtml, input.look === 'Bold Stat'))
  const ctaSchemas = slideSchemasFor(buildValuesSchema(CTA_TEMPLATE, ctaHtml, false))

  const [cover, slide2, slide3, slide4, cta] = await Promise.all([
    generateOneSlide(buildSlideSystemPrompt(1), contentSchemas.cover),
    generateOneSlide(buildSlideSystemPrompt(2), contentSchemas.slide),
    generateOneSlide(buildSlideSystemPrompt(3), contentSchemas.slide),
    generateOneSlide(buildSlideSystemPrompt(4), contentSchemas.slide),
    generateOneSlide(buildSlideSystemPrompt(5), ctaSchemas.slide),
  ])

  return {
    title: cover.title,
    slides: [cover, slide2, slide3, slide4, cta].map((s) => ({
      photoBriefs: s.photoBriefs,
      values: s.values as Record<string, string | undefined>,
    })),
  }
}
