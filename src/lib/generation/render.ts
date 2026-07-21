import { readFile } from 'fs/promises'
import path from 'path'

// Direct port of .claude/skills/carousel/scripts/fill_template.py's regex logic. A placeholder
// with no matching key falls back to its inline "|default"; with no default either, it's left as
// literal {{KEY}} text on purpose -- a visible mistake in the rendered output beats a silently
// wrong/missing value. Callers must check `unresolvedPlaceholders` before trusting a render.
const PLACEHOLDER = /\{\{([A-Z0-9_]+)(?:\|([^}]*))?\}\}/g

export function fillTemplate(templateHtml: string, values: Record<string, string>): string {
  return templateHtml.replace(PLACEHOLDER, (match, key: string, defaultValue?: string) => {
    if (key in values) return values[key]
    if (defaultValue !== undefined) return defaultValue
    return match
  })
}

export function unresolvedPlaceholders(filledHtml: string): string[] {
  const found = filledHtml.match(/\{\{[A-Z0-9_]+\}\}/g)
  return found ? Array.from(new Set(found)) : []
}

const TEMPLATES_DIR = path.join(process.cwd(), 'src/lib/generation/templates')

export async function loadTemplate(templateFile: string): Promise<string> {
  return readFile(path.join(TEMPLATES_DIR, templateFile), 'utf-8')
}

export class RenderError extends Error {}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fills a template and renders it to a PNG via Cloudflare's Browser Rendering REST API
 * (raw HTML in, PNG bytes out -- no Worker deployment needed). Requires CLOUDFLARE_ACCOUNT_ID
 * and CLOUDFLARE_API_TOKEN (Browser Rendering - Edit scope) in the environment.
 *
 * Retries up to 3 times with exponential backoff on 429/5xx (rate-limited or transiently down) --
 * unlike Anthropic API calls elsewhere in this pipeline (the SDK retries those automatically),
 * this is a plain fetch() with no built-in retry, so a real 429 would otherwise fail the whole
 * slide outright.
 */
export async function renderSlide(
  templateFile: string,
  values: Record<string, string>
): Promise<{ png: Buffer; filledHtml: string; unresolved: string[] }> {
  const canvasH = values.CANVAS_H
  if (!canvasH) throw new RenderError(`values for ${templateFile} must set CANVAS_H`)

  const templateHtml = await loadTemplate(templateFile)
  const filledHtml = fillTemplate(templateHtml, values)
  const unresolved = unresolvedPlaceholders(filledHtml)

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !apiToken) {
    throw new RenderError('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set')
  }

  const maxAttempts = 3
  let lastError: RenderError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          html: filledHtml,
          viewport: { width: 1080, height: Number(canvasH) },
          // Real bug found live (2026-07-21): 'networkidle0' waits for zero network connections
          // for 500ms, but the sourced photo's third-party origin server (or a keep-alive CDN
          // connection) can hold a connection open indefinitely with nothing left to actually
          // load -- Cloudflare's own error pointed at gotoOptions/waitForTimeout, and their docs
          // confirm 'load' (fires once every resource referenced in the initial HTML, including
          // the photo <img>, has finished) is a supported alternative that doesn't wait on
          // unrelated background connections. 'load' can in principle fire before Google Fonts
          // (fetched via the <link> tag in fonts.ts) finishes rendering, so a short explicit
          // waitForTimeout after load gives the font time to swap in before the screenshot.
          gotoOptions: { waitUntil: 'load', timeout: 20000 },
          waitForTimeout: 1000,
          screenshotOptions: { type: 'png' },
        }),
      }
    )

    if (res.ok) {
      const png = Buffer.from(await res.arrayBuffer())
      return { png, filledHtml, unresolved }
    }

    const body = await res.text().catch(() => '')
    lastError = new RenderError(
      `Cloudflare screenshot API returned ${res.status} for ${templateFile}: ${body.slice(0, 500)}`
    )
    if (!RETRYABLE_STATUS.has(res.status) || attempt === maxAttempts) throw lastError
    // 500ms/1s was measured too short for a real 429 seen twice live: the first Browser
    // Rendering call in a fresh sequence bounces, but an isolated retry moments later always
    // succeeds -- looks like a cold-start concurrency limit that clears in a few seconds, not
    // a token-bucket that refills in under a second.
    await sleep(2000 * 2 ** (attempt - 1)) // 2s, 4s, ...
  }

  throw lastError ?? new RenderError(`Cloudflare screenshot API failed for ${templateFile}`)
}
