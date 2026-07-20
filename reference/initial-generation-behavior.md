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
- No reference images → source illustrative photos yourself, no API key needed
  (`image-sourcing.md`'s technique — `fetch_og_image.py` against real article URLs, or equivalent).
  This is the default case, not a fallback — most users won't attach photos.
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
