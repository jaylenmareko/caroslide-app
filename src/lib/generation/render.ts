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

/**
 * Fills a template and renders it to a PNG via Cloudflare's Browser Rendering REST API
 * (raw HTML in, PNG bytes out -- no Worker deployment needed). Requires CLOUDFLARE_ACCOUNT_ID
 * and CLOUDFLARE_API_TOKEN (Browser Rendering - Edit scope) in the environment.
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
        gotoOptions: { waitUntil: 'networkidle0', timeout: 20000 },
        screenshotOptions: { type: 'png' },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new RenderError(
      `Cloudflare screenshot API returned ${res.status} for ${templateFile}: ${body.slice(0, 500)}`
    )
  }

  const png = Buffer.from(await res.arrayBuffer())
  return { png, filledHtml, unresolved }
}
