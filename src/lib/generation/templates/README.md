# Bundled carousel templates

Copied from `.claude/skills/carousel/templates/*.html` in the root `DoWhatever` repo on 2026-07-20.
This copy is necessary, not just convenient — this app deploys as its own standalone repo and has
no access to the root repo's `.claude/skills/carousel/` directory at runtime (that directory only
exists on Jaylen's local machine, it's never published).

**These are the templates real generation actually renders from.** The root repo's copy remains the
canonical source used by the `/carousel` skill for manual/chat-driven generation and is where new
templates get designed first. When a template is fixed or a new one is added there, re-copy the
affected file(s) here too — there is currently no automated sync between the two locations.
