// Google Fonts mapping for BRAND_FONTS (types.ts). The rendered slide is a standalone HTML
// document (Cloudflare's browser fetches it fresh, not part of the Next.js app), so it can't
// reuse next/font's locally-bundled files -- it needs a real <link> tag, same as any other
// external site loading a Google Font. Always set FONT_FAMILY/FONT_LINK_HTML from the carousel's
// chosen font, even when it's DEFAULT_BRAND_FONT -- the template's own fallback is Segoe UI, not
// Inter Tight, so skipping this for the "default" choice would silently render the wrong font.
// Exported (2026-07-28, chat-editing font-change build) -- the same curated whitelist Brand Kit
// and the click-in-place font picker already use, so a chat "make it Poppins" request is
// constrained to the exact same 5 real, tested fonts instead of a second, drifted list.
export const FONT_LINKS: Record<string, { family: string; googleFontsParam: string }> = {
  'Inter Tight': { family: "'Inter Tight', sans-serif", googleFontsParam: 'Inter+Tight:wght@400;700;900' },
  Poppins: { family: "'Poppins', sans-serif", googleFontsParam: 'Poppins:wght@400;700;900' },
  Montserrat: { family: "'Montserrat', sans-serif", googleFontsParam: 'Montserrat:wght@400;700;900' },
  'Archivo Black': { family: "'Archivo Black', sans-serif", googleFontsParam: 'Archivo+Black' },
  'DM Sans': { family: "'DM Sans', sans-serif", googleFontsParam: 'DM+Sans:wght@400;700;900' },
}

export function fontValues(fontName: string): { FONT_FAMILY: string; FONT_LINK_HTML: string } {
  const entry = FONT_LINKS[fontName]
  if (!entry) return { FONT_FAMILY: '', FONT_LINK_HTML: '' }
  return {
    FONT_FAMILY: entry.family,
    FONT_LINK_HTML: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${entry.googleFontsParam}&display=swap">`,
  }
}
