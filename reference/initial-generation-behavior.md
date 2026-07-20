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
  placeholders directly, same as any `/carousel` skill brand config.
- `BrandKit.voice_description` — **exists in the type (`src/lib/types.ts`) but is never actually
  collected anywhere in real UI** (`SettingsForm.tsx` has no field for it; it only appears as a
  hardcoded string in `src/app/preview/settings/page.tsx`'s mock data). This is the direct
  equivalent of the skill's `carousel-brand.json` `context` field (`brand-config.md`) — real
  founder background/voice/audience-gap notes that shape topic and tone choices. **Add a text area
  for this to `SettingsForm.tsx` before relying on it in generation** — don't build the generation
  prompt around a field that's always null in practice.

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
  | Classic, Flipped | 3 (`BG_IMG` + 2 circle photos) |
  | Spotlight, Spotlight Left | 2 (`BG_IMG` + 1 circle photo) |
  | Side by Side, Split Flip, Overlay | 2 |
  | Photo Grid | 3 |
  | Photo Column, Editorial | 1 |
  | Plain Text | 0 — never triggers research |

  If the user uploaded 1 of the 3 a Classic carousel needs, research the other 2, not all 3 — don't
  discard a real user-supplied photo just because more are needed.
- No reference images at all → source illustrative photos yourself, no API key needed
  (`image-sourcing.md`'s technique — `fetch_og_image.py` against real article URLs, or equivalent,
  via a **capped** number of searches — see the cost section below, this is not open-ended research).
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
  **Budgets themselves still need to be measured empirically per template** (render a few real
  test strings at the boundary, see what actually clips) before this can be enforced — not yet
  done, flag as a prerequisite before building this step, don't guess safe character counts.
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
