# `reference/`

Two kinds of files here:

- `initial-generation-behavior.md`, `chat-editing-behavior.md`, `chat-editing-execution.md` —
  written for this app specifically, live only here, edit freely.
- `content-strategies.md`, `templates-guide.md` — **synced copies** of the root `DoWhatever`
  repo's `.claude/skills/carousel/reference/*.md` (copied 2026-07-20, same reason as
  `src/lib/generation/templates/README.md`: this app deploys standalone and has no runtime access
  to the root repo). The real generation pipeline reads these at request time to ground the
  caption-writing call in the same rules the `/carousel` skill itself follows. If either changes in
  the root repo, re-copy it here too — no automated sync exists.
