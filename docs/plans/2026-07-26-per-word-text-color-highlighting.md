# Per-Word Text Color Highlighting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a user highlight any word/phrase inside a text field in the click-in-place carousel editor and apply any color to just that selection, Canva-style.

**Architecture:** All new logic lives inside `SlideCanvasEditor.tsx`'s injected iframe script (the same self-contained script string that already handles drag, hover-delete, and contenteditable text editing). A shared `document`-level `selectionchange` listener shows a small floating toolbar near the current text selection whenever the active element is a field in edit mode; clicking a swatch wraps the selection in a new `<span style="color:#hex">` via `Range.extractContents()`/`insertNode()` (splits any existing `c1`/`c2`/`c3` span automatically). No new save path — the existing blur handler already sends whatever HTML is in the field, color span included.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, plain DOM APIs inside the injected iframe script (no new libraries). No test framework exists in this codebase (verified: no jest/vitest/playwright-test config) — verification throughout this project has always been `tsc --noEmit` + `eslint` + live browser testing (via Playwright MCP or the Claude-in-Chrome extension) against the real running app. This plan follows that same convention instead of a unit-test-first flow.

**Design doc:** `docs/plans/2026-07-26-per-word-text-color-design.md` — read it first if anything below is ambiguous.

---

## A real, recurring gotcha in this file — read before touching it

`SlideCanvasEditor.tsx` builds the injected iframe script as one big JS template literal
(`` data.html.replace('</body>', `<script>...</script></body>`) ``). **Any unescaped backtick
anywhere inside that literal — including inside a `//` comment — prematurely closes the outer
literal and breaks the build with a `TS1005` parse error.** This has happened at least 3 times
already in this codebase's history. When writing comments inside the injected-script region
(roughly the area between the `` `<script>(function(){ `` line and the matching
`` })();<\/script></body>` `` line near the bottom of the file), never use backticks — write
`field_name` or "field name", not `` `field_name` ``. After every edit in this region, run
`npx tsc --noEmit` immediately before moving on.

---

### Task 1: Expose the carousel's brand colors to the click-in-place editor

**Files:**
- Modify: `src/lib/actions.ts:280` (`SlideEditorData` type), `src/lib/actions.ts:320` (`getSlideEditorHtml`'s return statement)

**Step 1: Read the current state**

```
Read src/lib/actions.ts lines 278-321
```
Confirm `SlideEditorData = { html: string; canvasH: number; fields: SlideEditorField[] }` and the
return statement `return { html, canvasH: Number(slide.values.CANVAS_H) || 1350, fields }`.

**Step 2: Add `primaryColor`/`secondaryColor` to the type**

Change:
```ts
export type SlideEditorData = { html: string; canvasH: number; fields: SlideEditorField[] }
```
to:
```ts
// primaryColor/secondaryColor: this carousel's own brand colors, already baked into slide.values
// as PRIMARY/SECONDARY by pipeline.ts at generation time -- exposed here so the click-in-place
// editor's per-word color toolbar can offer them as one-click swatches (2026-07-26).
export type SlideEditorData = {
  html: string
  canvasH: number
  fields: SlideEditorField[]
  primaryColor: string
  secondaryColor: string
}
```

**Step 3: Populate them in the return statement**

Change:
```ts
return { html, canvasH: Number(slide.values.CANVAS_H) || 1350, fields }
```
to:
```ts
return {
  html,
  canvasH: Number(slide.values.CANVAS_H) || 1350,
  fields,
  primaryColor: slide.values.PRIMARY || '#D97757',
  secondaryColor: slide.values.SECONDARY || '#F4C95D',
}
```
(Same fallback hex values `pipeline.ts:85-86` already uses, so a pre-brand-colors-existing slide
still gets a sane default instead of `undefined`.)

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: clean, no errors (this is a pure additive type/return change, nothing else reads
`SlideEditorData` destructively).

**Step 5: Commit**

```bash
git add src/lib/actions.ts
git commit -m "Expose carousel brand colors through the click-in-place editor's data"
```

---

### Task 2: Add the selection → colored-span DOM helper inside the injected script

**Files:**
- Modify: `src/components/SlideCanvasEditor.tsx` (inside the injected-script template literal — find the `deselect()`/`document.addEventListener('click', deselect)` block, this goes right after it)

**Step 1: Read the current injected-script structure**

```
Grep "function deselect" src/components/SlideCanvasEditor.tsx
```
Find the exact line — this new code is inserted immediately after the existing keydown Delete/Backspace
listener block (the one checking `selectedDeleteField`), before the `fields.forEach(function(f){` loop
starts.

**Step 2: Add the color-wrap helper and the shared toolbar**

Insert this block (adjust exact surrounding whitespace to match the file's existing style):

```js
// Per-word text color highlighting (2026-07-26). Wraps the current browser selection in a new
// colored span -- Range.extractContents()/insertNode() naturally splits any existing wrapping
// span (an AI-written c1/c2/c3 span, or an earlier manual color span) at the selection boundary,
// so only the highlighted portion changes and the untouched parts keep their original color.
// No new save path: this only edits the DOM. Whatever's in the field when its own blur handler
// fires (already wired up per text field, see the 'text' branch below) is what gets saved --
// same path a normal typed edit already uses.
function applyColorToSelection(color){
  var sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  var range = sel.getRangeAt(0);
  var span = document.createElement('span');
  span.style.color = color;
  span.appendChild(range.extractContents());
  range.insertNode(span);
  sel.removeAllRanges();
  var after = document.createRange();
  after.setStartAfter(span);
  after.collapse(true);
  sel.addRange(after);
}

// One shared floating toolbar, repositioned/reused for whichever field currently has an active
// selection -- built once here rather than per-field, since selectionchange is a document-level
// event, not a per-element one.
var colorToolbar = document.createElement('div');
colorToolbar.style.cssText = 'position:absolute;display:none;z-index:60;background:rgba(20,20,20,0.95);border-radius:10px;padding:6px;gap:6px;display:none;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
document.body.appendChild(colorToolbar);

function makeSwatch(color){
  var s = document.createElement('div');
  s.style.cssText = 'width:22px;height:22px;border-radius:50%;cursor:pointer;border:2px solid rgba(255,255,255,0.5);background:' + color + ';display:inline-block;margin-right:6px;';
  // mousedown, not click -- click fires after the field has already blurred/selection has
  // collapsed in some browsers; mousedown fires while the selection is still live. Same class of
  // fix as the topbar Delete button's own e.preventDefault() (see Viewer.tsx).
  s.addEventListener('mousedown', function(e){
    e.preventDefault();
    applyColorToSelection(color);
    colorToolbar.style.display = 'none';
  });
  return s;
}

colorToolbar.appendChild(makeSwatch(BRAND_PRIMARY));
colorToolbar.appendChild(makeSwatch(BRAND_SECONDARY));
colorToolbar.appendChild(makeSwatch('#ffffff'));
colorToolbar.appendChild(makeSwatch('#000000'));

var customColorInput = document.createElement('input');
customColorInput.type = 'color';
customColorInput.style.cssText = 'width:24px;height:24px;border:none;padding:0;cursor:pointer;background:none;';
customColorInput.addEventListener('mousedown', function(e){ e.stopPropagation(); });
customColorInput.addEventListener('input', function(){
  applyColorToSelection(customColorInput.value);
});
colorToolbar.appendChild(customColorInput);

document.addEventListener('selectionchange', function(){
  var active = document.activeElement;
  var sel = document.getSelection();
  if (!active || active.getAttribute('contenteditable') !== 'true' || !sel || sel.isCollapsed || sel.rangeCount === 0) {
    colorToolbar.style.display = 'none';
    return;
  }
  var rect = sel.getRangeAt(0).getBoundingClientRect();
  colorToolbar.style.display = 'flex';
  colorToolbar.style.left = (rect.left + rect.width / 2 - 60) + 'px';
  colorToolbar.style.top = (rect.top - 40) + 'px';
});
```

Two placeholders (`BRAND_PRIMARY`, `BRAND_SECONDARY`) need real values interpolated into this
template-literal script from the outer component — see Task 3, Step 2 for exactly where.

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: will still show errors until Task 3 wires `BRAND_PRIMARY`/`BRAND_SECONDARY` (undefined
names) — that's expected at this point, move directly to Task 3 before trying to verify standalone.

---

### Task 3: Wire brand colors into the script + verify the whole file compiles

**Files:**
- Modify: `src/components/SlideCanvasEditor.tsx` (the outer component, where `data` from
  `getSlideEditorHtml` is destructured/used to build the injected script string)

**Step 1: Find where the script string is built**

```
Grep "data.html.replace" src/components/SlideCanvasEditor.tsx
```
This is the template literal that starts with `` `<script>(function(){ ``. It already interpolates
other outer-scope values (e.g. `${scale}`) into the injected script via `${...}`.

**Step 2: Interpolate the two brand colors**

Near the top of the injected script (right after the opening `(function(){`), add:
```js
var BRAND_PRIMARY = ${JSON.stringify(data.primaryColor)};
var BRAND_SECONDARY = ${JSON.stringify(data.secondaryColor)};
```
Using `JSON.stringify` (not a raw string interpolation) so the hex value is safely quoted as a
real JS string literal regardless of its exact format.

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean. If a `TS1005` error appears pointing at a line inside the injected-script region,
it's almost certainly a stray backtick in a comment (see the gotcha note at the top of this plan) —
grep that exact line for a `` ` `` character and remove it.

Run: `npx eslint src/components/SlideCanvasEditor.tsx`
Expected: clean.

**Step 4: Commit**

```bash
git add src/components/SlideCanvasEditor.tsx
git commit -m "Add per-word text color highlighting toolbar to the click-in-place editor"
```

---

### Task 4: Verify live against the real running app

No unit test framework exists in this codebase — verification is live, against the real dev
server, matching how every other feature in this app has been verified.

**Step 1: Start the dev server**

Run: `npm run dev` (runs the template generator, then `next dev`)
Expected: `✓ Ready` with no errors, server responds 200 at `http://localhost:3000`.

**Step 2: Live-test via Playwright or the Claude-in-Chrome extension**

Navigate to a real carousel with an AI-generated slide (one with real `template`/`values`, not a
pre-click-in-place-editor carousel). Click into a caption to enter edit mode, drag-select a word,
confirm the floating toolbar appears near the selection with 4 swatches + a color input. Click the
custom color input, pick a color, confirm the selected word visibly changes to that color
immediately (no save round-trip needed to see it, since this only touches the DOM). Click elsewhere
to blur the field, then reload the page and confirm the color persisted (proves it saved through the
existing blur handler correctly).

Also verify: selecting a word that's already inside an AI-written `c1`/`c2`/`c3` colored span, then
applying a new custom color to just PART of that span's text — confirm the untouched part of the
original span keeps its original color (proves the split-on-wrap behavior works, not just the
simple no-existing-span case).

**Step 3: Restore any test carousel to its original state**

If a real carousel was used for this test (not a disposable one), restore the original caption HTML
via the same direct `postMessage`-based reset technique used earlier this session, or via the
Undo button (confirmed reliable when NOT navigating away immediately afterward — wait at least 2
full seconds after clicking Undo before navigating/reloading, per the real gotcha found earlier
today). Confirm pristine on a fresh reload.

---

### Task 5: Deploy to production

**Files:** none (deploy-only step)

**Step 1: Deploy**

```bash
mv .dev.vars .dev.vars.bak
CLOUDFLARE_API_TOKEN=<the deploy-scoped token> CLOUDFLARE_ACCOUNT_ID=4f2787f250e16d9e861d68fd74147cd3 npm run deploy
mv .dev.vars.bak .dev.vars
```
Expected: `Deployed caroslide-app triggers ... caroslide.com (custom domain)`.

**Step 2: Confirm live**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://caroslide.com/ --max-time 15
```
Expected: `200`.

Repeat the same live-selection test from Task 4, Step 2 against `https://caroslide.com` itself
(not just localhost) before considering this done — this codebase's established convention this
session has been "verify on the real production domain, not just a local dev server claim."

**Step 3: Log to the session file**

Append a new dated entry to `sessions/business/caroslide/session.md` describing what shipped, any
real bugs found/fixed during implementation, and what's still deferred (font-per-word, preserving
manual colors across a chat-edit rewrite) — matching every other entry's existing format and level
of detail in that file.
