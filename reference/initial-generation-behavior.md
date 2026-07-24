# Initial-generation interpretation

Governs how `createCarousel`'s real implementation (currently stubbed — see the `TODO` in
`src/lib/actions.ts`) turns the wizard's inputs into an actual rendered carousel. Whoever builds
that generation call must follow this contract. Companion to `chat-editing-behavior.md` (which
covers edits to an *existing* carousel, not first generation) and to `chat-editing-execution.md`
(what an edit actually changes once scoped).

## What's already decided before generation ever runs

The wizard resolves most of the `/carousel` skill's judgment calls structurally, via UI picks —
**don't re-derive these from the brief, they're already given:**

| Skill step (`.claude/skills/carousel/SKILL.md`) | Already fixed by |
|---|---|
| Step 4, content strategy (value / narrative / education) | `Angle` (`Value`\|`Growth`\|`Education` — `Growth` is the skill's "narrative" strategy under its team-vocabulary name, see `content-strategies.md`) |
| Step 5, template | `Look` + `TemplateVariant` (`NewCarouselWizard.tsx`'s `variantsFor()` maps these to one real `.claude/skills/carousel/templates/*.html` file) |
| Step 2, format | `Format` (`Post`\|`Square`\|`Story`) |
| Brand colors/logo/font | `brandColors`, `logoUrl`, `font` — already snapshotted onto the carousel at creation, don't ask again |

So the generation call's actual job is narrow: **skill steps 3 (topic), 6 (images), and 7
(captions)** — nothing more. Don't reopen strategy or template selection based on what the brief
seems to imply; if a user's brief reads like a story but they picked `Angle: Value`, still write a
value-post arc (five standalone points) — the explicit UI pick outranks an inferred vibe from free
text. If this creates an obviously bad mismatch worth surfacing, that's a chat-editing conversation
after the fact, not a silent override during generation.

## Inputs available

From `createCarousel`'s real input shape (`src/lib/actions.ts`) plus `BrandKit.voice_description`:

- `brief: string` — free text from the composer (`"Give us as much context as possible: brand
  colors, photos, links, tone, what you want the carousel to say…"`). Can be empty, a single topic
  phrase, or a detailed paragraph with links/facts/tone notes.
- `referenceImageUrls: string[]` — user-supplied photos, already uploaded to Supabase Storage
  before this call runs (see `Composer supports photo attachments` in `caroslide/CONTEXT.md`).
- `angle`, `format`, `look`, `templateVariant` — see table above.
- `brandColors`, `logoUrl`, `font` — feed the template's `PRIMARY`/`SECONDARY`/`LOGO_HTML`/font
  placeholders directly, same as any `/carousel` skill brand config. **`logoUrl` fallback rule
  (Jaylen, 2026-07-21): if the user never uploaded a logo, `LOGO_HTML` falls back to Caroslide's
  OWN wordmark, not the account's display name** — a carousel with no brand logo set should read
  as "made with Caroslide," not silently promote whatever the account owner's name happens to be.
  Implemented in `pipeline.ts` as a text wordmark (the same `.a`/`.b` two-tone span convention
  every template already uses for a text-only brand fallback) since there's no up-to-date
  Caroslide logo *image* asset in this repo yet — swap in a real `<img>` once one exists.
- `BrandKit.voice_description` — real as of 2026-07-20: a "Voice & Tone" textarea in
  `SettingsForm.tsx`, wired through `saveBrandKit()` to the existing `brand_kits.voice_description`
  column. Optional, may still be null/empty for most users (nothing forces it) — treat an empty
  value as "no voice guidance given," not an error. This is the direct equivalent of the skill's
  `carousel-brand.json` `context` field (`brand-config.md`) — real founder background/voice/
  audience-gap notes that shape topic and tone choices.

## Parsing the brief

The brief is the only place "skill step 3, topic" and "skill step 7, captions" get their real
subject matter and voice. Handle it by shape:

- **Empty or near-empty** (e.g. blank, or just "surprise me") — same rule as the skill's own step 3:
  research a real, current, relevant topic yourself, weighted toward `voice_description`'s
  target-audience notes if that field has been filled in. Don't block generation on an empty brief;
  it's the normal case, not an error state.
- **A bare topic phrase** ("seed oils and skin", "our new tallow lip balm") — treat as the subject,
  same as a user typing `/carousel something about seed oils` in chat. Still do your own research
  for supporting facts/current framing if the phrase alone isn't enough to write five real slides.
- **A detailed paragraph** (tone notes, links, specific claims, explicit CTA wording) — extract
  concretely, don't compress away specifics. A founder's real credential or a specific product claim
  in the brief beats a generic rewording of it — same principle as `brand-config.md`'s `context`
  field ("capture it close to verbatim rather than compressing it into a tag list").
- **Contains an explicit instruction about scope/format that contradicts the structured picks**
  (e.g. brief says "make this a 3-slide carousel" but the skill/product default is 5) — the
  structured wizard picks and the product's own fixed conventions (5 slides: 4 content + `cta.html`)
  win; a stray line in free text doesn't get to change the product's shape. If the brief's request
  is genuinely incompatible with what's possible, that's worth a visible note to the user, not a
  silent partial-compliance.

## Images

Mirrors skill step 6 exactly:

- `referenceImageUrls` present → archive/use them for any slide making a real "here's the result"
  claim; fair game for illustrative slides too if they fit the topic.
- Fewer `referenceImageUrls` than the chosen template needs → **research only the shortfall**, not
  a blanket "always search the web." Count what's required per `Look`/`TemplateVariant` (one real
  photo slot per `{{...IMG}}` placeholder in the mapped `.claude/skills/carousel/templates/*.html`
  file):

  | TemplateVariant | Photos needed |
  |---|---|
  | Classic — slide 1 (cover) | 3 (`BG_IMG` + 2 circle photos) |
  | Classic — slides 2-4 | **1** (`BG_IMG` only — see the cover-only-motif note below) |
  | Flipped | 3 on every content slide (`BG_IMG` + 2 circle photos) |
  | Spotlight, Spotlight Left | 2 (`BG_IMG` + 1 circle photo) |
  | Side by Side, Split Flip, Overlay | 2 |
  | Photo Grid — slide 1 (cover) | 3 (`IMG_MAIN` + `IMG_TOP` + `IMG_BOTTOM`) |
  | Photo Grid — slides 2-4 | **1** (`IMG_MAIN` only — see the cover-only-motif note below) |
  | Photo Column, Editorial | 1 |
  | Plain Text | 0 — never triggers research |

  If the user uploaded 1 of the 3 a Classic/Photo Grid COVER slide needs, research the other 2,
  not all 3 — don't discard a real user-supplied photo just because more are needed.
- **Some templates reserve their strong multi-photo motif for the cover slide only (real decision,
  Jaylen 2026-07-21, not a bug).** Classic's 2-circle "proof" motif was the first real case — a
  strong, distinctive device meant for a cover slide, repeating it identically on slides 2-4 read
  as "same slide, new photo" (a real complaint, confirmed against a hand-built reference carousel
  whose actual inner slides drop the circles too and keep just the full-bleed photo). Photo Grid's
  fixed asymmetric 3-photo layout is the same category of risk (a distinctive fixed shape, no
  built-in variation mechanism the way the alternating-split templates have) — extended the same
  day. `pipeline.ts`'s `COVER_ONLY_MOTIF` config sets each template's own CSS toggle to hide the
  extra photo slots on slides 2-4 (`1-cover-circles.html`'s `CIRCLES_DISPLAY`, `8-photo-grid.html`'s
  `GRID_MAIN_WIDTH`/`GRID_SIDE_DISPLAY` — the remaining photo/main-grid-cell keeps working
  independently since the hidden elements are absolutely positioned or a separate flex sibling, not
  something the remaining layout depends on). **Flipped keeps circles on every slide** — its own
  template comment explicitly says "apply to every content slide (1-4) for a consistent look," a
  deliberately different design choice this doesn't override.
- **2-photo-split templates now actually alternate orientation between slides** (`Side by Side`,
  `Split Flip`, `Overlay`, `Photo Column` — real fix, 2026-07-21). Several of these templates' own
  top comments already called for this ("mirror it on alternating slides" / "so the carousel
  doesn't feel static") but the pipeline never implemented it before now — `pipeline.ts` sets each
  template's real orientation placeholder (`SPLIT_DIRECTION` for the three horizontal-split
  templates, `ROW_DIRECTION` for `4-vertical-split.html`) to alternate `row`/`row-reverse` by
  content-slide index.
- No reference images at all → source illustrative photos via `images.ts`'s `findUsablePhoto()`,
  a real three-tier pipeline (rewritten 2026-07-21 after measuring the original single-tier
  approach at ~50% hit rate):
  1. **Pexels** (`PEXELS_API_KEY`) tried first — a curated free-to-use photo library, no
     attribution required (confirmed on pexels.com/license). Highest hit rate for generic
     aesthetic briefs (e.g. "raw wagyu steak marbling close-up photo"), which is most of what a
     caption-writing call actually generates.
  2. **Tavily image search** (`include_images` mode) tried second — real data found live: this
     underperforms Pexels for generic aesthetic briefs (mostly returns stock-marketplace previews,
     see below) but *outperforms* it for literal/branded/retail-product briefs (e.g. "grocery
     store ground beef package photo" returned real photos from Kroger/Meijer/a real ranch's own
     site) — kept specifically for that case.
  3. **Tavily page search + `og:image` scrape** (the original approach) tried last, as a genuine
     fallback, not discarded.

  All three sources are validated the same way: rejected outright if the host is a known
  stock-photo marketplace (Alamy/Shutterstock/Getty/iStock/Dreamstime/123rf/Depositphotos/Adobe
  Stock+its `ftcdn.net` CDN/Canstock/Bigstock/Vecteezy/Unsplash's paid `plus.` tier — a real
  watermarked Alamy preview shipped in a render once, caught only by luck via vision-review), then
  checked for real dimensions (≥400px both axes). If sourcing genuinely fails for a slot after all
  three tiers, the field gets a flat brand-color placeholder (`solidColorPlaceholder()` in
  `pipeline.ts`) instead of shipping a broken/unresolved image.
- Never reuse the same photo as both `BG_IMG` and a circle image on templates that pair the two
  (Spotlight/Spotlight Left especially) — the whole point of a background-plus-circle-inset layout
  is pairing the main subject with a *different* related photo, not a duplicate crop of the same one
  (this exact mistake got caught and fixed once already this session on a real render).
- Never substitute a stock photo into a slide making a real before/after or "here's proof" claim.
  If no real photos exist and the template needs one, that's a case for picking a different
  template variant that doesn't require a photo (see `templates-guide.md`'s photo-optional list),
  not for faking the claim.

## Captions

Written in the chosen `Angle`'s arc shape (`content-strategies.md`) and the chosen template's real
color-clause convention (`templates-guide.md`'s caption section) and word-count discipline (value
≤15 words/slide, narrative no fixed cap but one beat per slide, education ≤15 on hook/payoff,
20-25 on mechanism slides). `voice_description`, once collected, shapes tone the same way a brand's
`context` field does in manual generation — a specific voice quirk or founder detail belongs in the
caption, not flattened into generic copy.

**Real bug found and fixed 2026-07-21: `format` must reach the caption-writing call, not just the
render step.** For a while this call never received `format` at all — it fed `CANVAS_H` at render
time only, while the system prompt falsely claimed the model "has already been told" format. Since
canvas width is fixed at 1080px and only height varies (Post 1350 / Square 1080 / Story 1920),
Square has meaningfully less vertical room per word than Post and Story meaningfully more — the
model is now told this explicitly and given qualitative guidance (favor the tighter end of the
word budget on Square, a little more breathing room on Story, don't pad). **Still an open,
honestly-flagged gap, not silently accepted:** the character budgets in `guardrails.ts`
(`CHAR_BUDGETS`) were only ever empirically measured against Post's 1350px canvas (real
boundary-case renders, see the pipeline section below) — Square/Story reuse the exact same numbers
unverified. If Square/Story usage grows, they deserve their own measurement pass rather than
assuming Post's numbers transfer cleanly.

## Cost-conscious generation pipeline (bounded steps, guardrails-first)

**Why this exists:** the marquee carousels (built by hand this session, see
`sessions/business/caroslide/session.md`) hit real quality bugs repeatedly even under careful,
hands-on review — caption text overflowing its box, a bad photo crop, a circle accidentally
duplicating the main photo's subject, low-contrast text. Template-fill rendering (this product's
whole approach — real HTML/CSS + real data, not an image-generation model) has that specific
failure surface *by construction*; a pure image-gen product like ChatGPT/DALL-E doesn't, because it
has no separate "does this text fit this predefined box" step to fail at. So some form of check is
structurally necessary here, not optional polish — but it does NOT need to be an open-ended AI
agent loop, which is expensive and unpredictable. Decided 2026-07-20: **deterministic guardrails
first, AI review only as a fallback when a guardrail actually trips** — most of a carousel's real
failure modes are catchable with plain code, not judgment calls.

**Deterministic guardrails (code, not AI — run on every generation, effectively free):**
- Per-template character/length budgets on every text placeholder (`CAPTION_HTML`, `HEADLINE_HTML`,
  `STAT_LABEL`, etc.) — reject or force a smaller `*_SIZE` override before render if the
  caption-writing call's output exceeds the budget for that template's box at that font size.
  **Measured empirically 2026-07-20** (real boundary-case renders at 15/20/25/30-word captions
  against the generic gray-mockup placeholder, screenshot-verified, not guessed) — see the table
  below. Two real bugs surfaced by this testing, **both fixed the same day, not just documented:**
  - **Photo Grid** (`8-photo-grid.html`) — FIXED: a caption past ~25 words used to grow the
    (vertically-centered) head zone tall enough that the logo (fixed `top:44px`) visually collided
    with the caption's first line. Fixed by switching `.head` from centered to top-anchored
    (`justify-content:flex-start`, more top padding to clear the logo, `HEAD_H` default bumped
    32vh→36vh to compensate for the added padding) — caption can now only grow downward, away from
    the logo. Growth risk shifted to the *bottom* of the zone (bleeding toward the photo grid)
    instead, confirmed via re-render to be a much later, softer failure than the logo collision —
    still budget ≤25 words to stay clear of it entirely.
  - **Editorial / Spotlight** (`6-minimal-magazine.html`, `11-single-circle.html`) kicker+headline
    mode — FIXED: past ~20 words the headline (which grew upward from a fixed `bottom:110px`) used
    to collide with the kicker (independently fixed at `bottom:400px`). Fixed by wrapping both in
    one bottom-anchored flex block (`.cover-block`) so the kicker always sits directly above the
    headline and the whole block grows upward together — **re-tested clean even at 33 words**, no
    collision possible anymore regardless of length. The ≤25-word budget below is a writing-quality
    ceiling now (per `content-strategies.md`), not a layout-safety one.
  - (Already known, reconfirmed, not yet fixed) **Overlay** (`10-split-overlay.html`) still collides
    with its own brand-badge past ~15-18 words at the default `BRAND_LINE_BOTTOM:200px` — matches
    the real per-carousel overrides `templates-guide.md` already documents (carousels #03/#13 both
    needed `BRAND_LINE_BOTTOM` bumped for longer captions). Real safe default is closer to one short
    line (~10 words) unless `BRAND_LINE_BOTTOM` is pushed down proportionally — the guardrail must
    enforce this one for real, since the template itself hasn't been restructured to prevent it.

  | TemplateVariant | Field | Safe default budget | Notes |
  |---|---|---|---|
  | Classic | `CAPTION_HTML` | ≤25 words / ~165 chars | 33 words (7 lines) still fit, no margin to spare — don't push past 30 |
  | Flipped | `CAPTION_HTML` | ≤25 words / ~165 chars | 33 words (6 lines) right at the divider line — don't push past 30 |
  | Spotlight, Spotlight Left | `HEADLINE_HTML` (cover mode) | ≤25 words / ~165 chars | structurally can't collide anymore (fixed) — budget is a writing-quality ceiling, not a safety one |
  | Spotlight, Spotlight Left | `STORY_HTML` (narrative mode) | ≤45 words / ~250 chars | tested clean at 47 words, no nearby element to collide with |
  | Side by Side | `CAPTION_HTML` | ≤25 words / ~165 chars | tested clean through 26 words |
  | Photo Column | `TAGLINE`+`CAPTION_HTML` | ≤25 words / ~165 chars | full-height column, generous — no collision risk found even at the tested ceiling |
  | Editorial | `HEADLINE_HTML` (cover mode) | ≤25 words / ~165 chars | structurally can't collide anymore (fixed) — budget is a writing-quality ceiling, not a safety one |
  | Editorial | `STORY_HTML` (narrative mode) | ≤45 words / ~250 chars | tested clean at 47 words |
  | Photo Grid | `TAGLINE`+`CAPTION_HTML` | ≤25 words / ~165 chars | logo collision fixed (top-anchored now) — this budget avoids the *new*, softer bottom-of-zone bleed risk, not the logo |
  | Split Flip | `TAGLINE`+`CAPTION_HTML` | ≤30 words / ~195 chars | tested clean through 33 words, roomier than Photo Grid |
  | Overlay | `CAPTION_HTML` (headline) | **≤10 words / ~60 chars at default `BRAND_LINE_BOTTOM`** | 18 words (3 lines) already collides with the brand badge — bump `BRAND_LINE_BOTTOM` for anything longer, per `templates-guide.md`'s existing per-carousel pattern |
  | Plain Text | `STATEMENT_HTML` | ≤12 words / ~70 chars | template's own intent is a single short punchy line, not tested past this — don't write more even if it would technically fit |
  | Every template's CTA slide | `HEADLINE_HTML`/`SUBHEAD`/`CTA_TEXT` | headline ≤9 words, subhead ≤12 words, button ≤4 words | tested clean well within these, plenty of margin |

  These are the actual measured numbers — enforce them as hard caps in the guardrail step, don't
  loosen them without re-rendering a real boundary test first (font sizes/box dimensions change
  between templates, a budget that's safe on one is not automatically safe on another).
- Image URL existence/load check before render.
- The no-duplicate-photo rule above (background vs. circle image), checked by comparing the actual
  URLs/hashes, not by asking a model to notice.
- Zero unresolved `{{PLACEHOLDER}}` tokens in the filled HTML — `fill_template.py` already warns on
  this; wire that warning to block the render instead of just logging it.

**AI vision review — fallback only, not default:** triggered specifically when a guardrail can't
resolve something deterministically (e.g. a length budget was met but the render still needs a
one-time visual sanity check on first rollout, or a guardrail flagged something borderline). One
render → one look → at most one retry. Never an open-ended "keep trying until it looks good" loop —
if the retry still isn't right, ship it and let the user's free chat-edit fix it, same as any other
imperfect first draft. Don't build unbounded self-correction; bound it at 1 retry, always.

**Model choice per step, driven by which steps are genuinely judgment-heavy vs. routine:**
- Caption-writing (topic research + voice/copy): `claude-opus-4-8` — see Model section below,
  unchanged from the original reasoning, this is the one call worth paying for.
- Photo research/sourcing calls: a cheaper model is fine — the task is "find and verify a real
  photo matches this topic," not brand-voice judgment.
- The fallback vision-review step (when it fires): cheaper model unless the guardrail that
  triggered it specifically needs strong visual judgment.
- No step should ever run an unbounded number of times per generation — cap web searches (e.g. 2-3
  max per photo needed) and cap the vision-review retry (1 max), full stop. Predictable, small,
  per-generation cost beats an open-ended agent loop every time for a paid-per-generation product.

## Render dependency

None of the above matters until there's an actual render path: fill the chosen template's
placeholders into a real `values.json`-equivalent, run the same headless-screenshot pipeline the
skill uses (`fill_template.py` + a headless Chrome instance, server-side — see `SKILL.md` step 9),
verify dimensions, then store the resulting image URLs. **This needs a per-slide record of what
generated it (template name + the filled values), not just the final image URL** — see
`chat-editing-execution.md` for why that persisted record is required for editing to work at all,
and design the generation call's output to write it from the start rather than retrofitting later.

## Model

Use `claude-opus-4-8` for the brief-interpretation + caption-writing call, same reasoning as
`chat-editing-behavior.md`: this is a brand-voice-sensitive, judgment-heavy task (what's the real
topic, what's worth saying in 15 words), not a latency-sensitive one, and generation is a paid-credit
action (unlike free chat edits) so cost pressure matters less than getting it right the first time.
