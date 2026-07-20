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

## Model: Claude Opus 4.8

Use `claude-opus-4-8` for the edit-parsing + copy-rewrite call, not a cheaper tier. Reasons:

- Scope decisions (this doc) and brand-voice-matched copywriting both benefit more from raw
  capability than from shaving latency/cost — a wrong scope call or off-voice rewrite costs more
  in user trust than a few cents saved per call.
- Chat edits are already priced as free to the user (see `MarketingPage.tsx`'s pricing footnote:
  "Chat edits and iterations are always free — credits are only spent on new carousels"), so
  there's no per-message cost pressure pushing toward a cheaper model.
- Matches Anthropic's own default guidance: use Opus 4.8 unless there's a specific reason not to.
