# Chat-edit scoping rule

Governs how the carousel-viewer chat box (`src/components/Viewer.tsx`'s `chat-box`) edits slides once
real AI editing is wired up (currently stubbed — see `TODO` in `src/lib/actions.ts`). Whoever builds
that edit endpoint must follow this contract exactly.

## Default: exactly one slide

An edit request touches **only the slide the user is currently viewing** (the frontend's `current`
slide index — pass it as context with every request) unless the message explicitly says otherwise.

"Make it punchier," "change the CTA," "swap this photo" with no slide reference → edit the one slide
in view. Never re-render slides the user didn't ask about.

## Expanding scope requires explicit language

Only touch more than the current slide when the user's message names slides directly:

- **Specific number(s):** "slide 3", "slides 2 and 4"
- **A range:** "slides 3-5", "the last two"
- **Everything:** "all slides", "the whole carousel", "every slide", "regenerate all of it"

If the request is ambiguous about scope, treat it as scoped to the current slide — never default to
"all slides" on a guess. Under-scoping is recoverable (the user asks again); over-scoping destroys
slides they didn't want touched.

## Why

Matches the app's own copy (see the chat-box hint in `MarketingPage.tsx`'s FAQ: "No re-generating
from scratch"). Regenerating the whole carousel on every chat message would silently discard
approved slides and undermine the one-slide undo/redo history already built in `Viewer.tsx`.

## Model: split by step, not one tier for the whole edit

**Revised 2026-07-20** — the original reasoning here ("chat edits are free to the user, so no cost
pressure toward a cheaper model") missed something: free-to-the-user is not free-to-Caroslide, and
unlike generation (capped by credits), chat edits are **unlimited** — a user can send as many as
they want, forever, on one carousel. Every edit that runs an unnecessary Opus call is unbounded cost
exposure with no product lever (credits) to offset it. The fix isn't rate-limiting edits (that breaks
the "always free" promise `MarketingPage.tsx` already makes publicly) — it's making each individual
edit cheap by construction, same bounded-steps philosophy as
`initial-generation-behavior.md`'s "Cost-conscious generation pipeline":

- **Scope classification** (which slide(s) this message touches, per the rules above) — a cheaper
  model is fine. This is a narrow, mechanical classification task against a short fixed rule set,
  not open-ended judgment.
- **Copy rewrite** (the actual brand-voice-sensitive rewriting of a caption/headline field) —
  `claude-opus-4-8`, unchanged from the original reasoning. This is the one part of an edit that's
  genuinely judgment-heavy (does this sound like the brand, is it actually punchier) and worth
  paying for.
- **Photo-swap edits** — no copywriting judgment involved at all. Reuse the same capped
  photo-research step from `initial-generation-behavior.md` (cheaper model, 2-3 search cap), not a
  fresh Opus call.
- No retry loop on edits, same as generation — one classify, one execute, done. If the result isn't
  right, that's what the *next* chat message is for; don't burn a second AI pass trying to
  self-correct within a single edit request.
