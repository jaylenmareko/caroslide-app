# Caroslide — design.md

Single source of design truth for this codebase. Read this before generating or editing any UI. Verified directly against `src/app/globals.css` and `src/app/layout.tsx` on 2026-07-22 — not reconstructed from memory or notes.

## Colors

CSS vars, defined in `globals.css` `:root`. Use the vars, never hardcode hex.

| Var | Value | Use |
|---|---|---|
| `--bg` | `#FBFAF7` | page background |
| `--bg-alt` | `#F2F5F1` | secondary surface (inputs, plan card) |
| `--surface` | `#FFFFFF` | cards, sidebar |
| `--ink` | `#15140F` | primary text |
| `--ink-soft` | `#676054` | secondary text |
| `--ink-faint` | `#9C9585` | tertiary/placeholder text |
| `--green` | `#512888` | brand primary (K-State purple — var name is legacy, do not rename, live code depends on it) |
| `--green-bright` | `#38BDF8` | brand accent (sky blue) |
| `--green-pale` | `#EDE4F7` | tinted backgrounds for selected/active states |
| `--line` / `--line-strong` | `rgba(21,20,15,0.10)` / `0.16` | borders |
| `--cta-glow` | `0 10px 24px -8px rgba(81,40,136,0.4)` | shadow under gradient CTAs only |
| `--hero-gradient` | `linear-gradient(180deg, #1E1033 0%, #3B1F66 20%, #512888 40%, #4C6FB5 62%, #38BDF8 82%, #7DD3FC 100%)` | landing hero background only |

Primary CTA gradient (buttons, not the hero): `linear-gradient(135deg, var(--green-bright), var(--green))`.

## Fonts

Three different font contexts exist — do not mix them up:

1. **App interior** (dashboard, wizard, viewer, settings) and **auth pages** — Inter Tight (`--font-inter-tight`, loaded via `next/font/google`), falling back to `--font` (the system stack). Fixed 2026-07-22 — previously fell back to the system stack only, unlike the landing page.
2. **Landing page** (`.lp` scope) — same Inter Tight / `--font` fallback, applied first here originally.
3. **Brand wordmark** ("Caroslide" logotype, every screen) — Fraunces, italic, weight 600, `--font-brand`. Text-only, no icon mark in the live app (a separate tent-top SVG icon mark exists in `projects/business/caroslide/assets/` but is not wired into the app — legacy/unused).

User-selectable fonts (Brand Kit picker, applies to *generated carousel output only*, never the app UI itself): Poppins (600/700), Montserrat, Archivo Black (400), DM Sans.

## Shape & motion

- Buttons: pill (`border-radius: 100px`) for primary CTAs, `8px` for smaller inline buttons.
- Cards: `12px`–`18px` radius depending on size.
- Avatars: full circle.
- Content cards are deliberately **flat** — no box-shadow, no hover-lift. This was a direct rebuild decision (matching a real competitor's measured computed styles), not an oversight. Don't add shadow/lift back to cards.
- Buttons DO get hover feedback: `translateY(-1px)`/`scale(1.02)` + shadow, `0.25s` transition.
- Headings/static text: `cursor: default; user-select: none;` — text-select cursor is deliberately disabled outside real inputs (`.app-shell input/textarea` and `.lp input/textarea` are the only user-selectable text).
- No animation library is wired in for the app interior. If adding motion, default to CSS transitions matching the existing `0.15s–0.3s ease` pattern already in use — don't introduce a new animation dependency without checking here first.

## Do not

- Do not hardcode any color that already has a CSS var — always use `var(--...)`.
- Do not add box-shadow or hover-lift to `.dash-card` / content cards.
- Do not rename `--green` to something purple-accurate — it's load-bearing across the codebase as-is.

## Project folder

```
design/
  design.md       — this file, one system spec, kept up to date
  mocks/           — throwaway HTML mockups for exploring new screens before building them for real (gitignored, kept for local reference only)
```

Direction, not a rulebook — this file stays short on purpose. Over-prescriptive instructions degrade the model. Update it when a real design decision changes; don't pad it with restated CSS.
