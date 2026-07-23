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

// A placeholder with no `|default` clause has nothing to fall back to -- fillTemplate leaves it
// as literal broken `{{FIELD}}` text if the model skips it. Real bug found live (2026-07-22,
// 12-hook-block.html's HEADLINE_HTML): the model kept treating a "valid key" as an optional one,
// since nothing distinguished required-with-no-fallback from merely-allowed. Scans the template's
// own real HTML rather than hand-maintaining a second list, so this can never drift from the
// template file itself.
export function requiredPlaceholderFields(templateHtml: string): Set<string> {
  const required = new Set<string>()
  const re = /\{\{([A-Z0-9_]+)(?:\|([^}]*))?\}\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(templateHtml))) {
    if (match[2] === undefined) required.add(match[1])
  }
  return required
}

const TEMPLATES_DIR = path.join(process.cwd(), 'src/lib/generation/templates')

export async function loadTemplate(templateFile: string): Promise<string> {
  return readFile(path.join(TEMPLATES_DIR, templateFile), 'utf-8')
}

export class RenderError extends Error {}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
// Cloudflare's own error code for "the headless browser navigation timed out" -- returned as a 422,
// which isn't in RETRYABLE_STATUS (422 usually means a permanently malformed request, not worth
// retrying). A navigation timeout is genuinely transient (slow page load, not a bad request) and
// found live 2026-07-22 hard-failing a whole carousel on its first and only occurrence -- check the
// body for this specific code rather than retrying every 422 blind, since a real malformed-HTML 422
// (if one ever occurs) should still fail fast, not burn 3 retries on something that can't succeed.
const RETRYABLE_CLOUDFLARE_ERROR_CODES = new Set([6002])

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

  const maxAttempts = 4
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

    let isRetryableTimeout = false
    try {
      const parsedBody = JSON.parse(body) as { errors?: Array<{ code?: number }> }
      isRetryableTimeout = parsedBody.errors?.some((e) => e.code !== undefined && RETRYABLE_CLOUDFLARE_ERROR_CODES.has(e.code)) ?? false
    } catch {
      // Non-JSON body -- leave isRetryableTimeout false, fall through to the status-only check.
    }

    if ((!RETRYABLE_STATUS.has(res.status) && !isRetryableTimeout) || attempt === maxAttempts) throw lastError

    // Real, repeated pattern (2026-07-21): a 429 on this endpoint consistently hit the LAST
    // (5th) render call of a carousel, 4 times in one night -- and manually waiting ~2 minutes
    // before a fresh retry cleared it every time, while an immediate retry never did. That rules
    // out the original "cold-start concurrency, clears in seconds" theory this backoff was tuned
    // for; a 429 specifically needs a real rate-limit window to pass, not a quick bounce. Respect
    // a real Retry-After header if Cloudflare sends one; otherwise back off far longer for 429
    // than for a transient 5xx (which the original 2s/4s schedule is still reasonable for).
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After')
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN
      const baseWaitMs = Number.isFinite(retryAfterSeconds)
        ? Math.min(retryAfterSeconds * 1000, 90000)
        : 15000 * 2 ** (attempt - 1) // 15s, 30s, 60s
      // Jitter added 2026-07-22: now that pipeline.ts renders multiple slides concurrently, a 429
      // can legitimately hit several of them within the same rate-limit window at once -- a fixed
      // backoff means they'd all retry at the exact same computed instant and likely re-collide
      // on the same window again. +/-20% random jitter spreads simultaneous retries apart without
      // meaningfully changing the real wait for any single one.
      await sleep(baseWaitMs * (0.8 + Math.random() * 0.4))
    } else {
      await sleep(2000 * 2 ** (attempt - 1)) // 2s, 4s, 8s
    }
  }

  throw lastError ?? new RenderError(`Cloudflare screenshot API failed for ${templateFile}`)
}
