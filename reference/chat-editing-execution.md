# Chat-edit execution

Companion to `chat-editing-behavior.md`, which decides **which slide(s)** an edit touches. This doc
covers **what to actually do** once scope is known — currently unimplemented (`Viewer.tsx`'s
`chat-send-btn` has no `onClick` handler at all yet, not even a stub call).

## Blocking dependency: slides don't store how they were made

`Slide = { url: string }` (`src/lib/types.ts`) — a carousel's slides are only ever a rendered image
URL. There is no persisted template name, no filled placeholder values, no raw caption text. This
means **an edit request cannot be executed against the current data model at all** — there's
nothing to modify. "Make slide 3 punchier" has no target to act on beyond the flat image.

Fix this before wiring up the send button, not after: extend `Slide` (or add a parallel
per-slide table) to also store what generated it:

```ts
export type Slide = {
  url: string
  template: string        // e.g. "1-cover-circles.html" — which file this slide came from
  values: Record<string, string>  // the exact values.json used to fill it
}
```

`values` is the thing an edit actually rewrites (e.g. `CAPTION_HTML`, `STAT_NUMBER`, `BG_IMG`),
then the same fill+render step from `initial-generation-behavior.md` re-runs on just that one
slide's `template`+`values` to produce a new `url`. Without this, "editing" can only ever mean
"regenerate the whole carousel from the original brief and hope the new version is what they
wanted" — which is exactly the "no re-generating from scratch" promise (`MarketingPage.tsx`'s FAQ)
this product has already publicly committed to not doing.

## Edit-type taxonomy

Once scope (`chat-editing-behavior.md`) and the target slide's stored `template`+`values` are both
known, classify the instruction and touch only the matching fields:

| Instruction pattern | What changes | What stays untouched |
|---|---|---|
| "punchier hook", "different CTA", "make this sound more [X]" | Rewrite the relevant caption/headline `values` field via LLM, using the same brand voice context as generation (`BrandKit.voice_description`) | Template, image(s), colors, font, every other slide |
| "swap this photo", "use a different image" | Re-source or re-pick the `BG_IMG`/`IMG_LEFT`/etc. field for that slide only (same image-sourcing rules as initial generation) | Caption text, template, colors |
| "make this a stat instead", "use the other look for this slide" | Bigger operation: map the slide's existing caption/fact onto a *different* template's placeholder set (some fields won't carry over 1:1 — e.g. plain caption → `STAT_NUMBER`/`STAT_LABEL` needs the fact reframed as a number, not just copied) | Other slides, overall carousel angle/format |
| "change the brand colors" / anything about colors, logo, font | **Not a chat-edit at all** — this is what the Brand Kit modal (`brand-kit-chip` in `Viewer.tsx`) already exists for. Route the user there instead of trying to parse color changes out of free text. | — |
| Names multiple slides or "all slides" | Apply the same field-level change independently to each in-scope slide's `values`, respecting each slide's own template (they may differ) | Slides outside the stated scope |

Never touch a `values` field the instruction didn't ask about, even when regenerating a slide —
re-filling the *entire* template from scratch on every edit would silently drift colors/logo/font
away from the carousel's saved brand snapshot over repeated edits.

## After execution

- Write the new `url` (and updated `values`) back into that slide's record via the same
  `commitSlides` path `Viewer.tsx` already uses for delete/undo/redo — this gets the edit onto the
  existing undo/redo history stack for free, no separate mechanism needed.
- If the requested edit can't be mapped to a concrete field change (instruction is too vague even
  after the scope rule resolves *which* slide), ask a clarifying question in the chat rather than
  guessing at a rewrite — same "don't guess on ambiguity" posture as `chat-editing-behavior.md`'s
  scope rule.

## Render + model

Re-render only the touched slide(s) through the same pipeline as initial generation (see
`initial-generation-behavior.md`'s render-dependency section) — never the whole carousel. Use
`claude-opus-4-8` for both the instruction-classification step and any copy rewrite, matching
`chat-editing-behavior.md`'s reasoning (chat edits are free to the user, so there's no cost pressure
toward a cheaper model, and a wrong scope/edit call costs more in trust than it saves in latency).
