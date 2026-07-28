'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { getSlideEditorHtml, type SlideEditorData } from '@/backend/lib/actions'
import { createClient } from '@/backend/lib/supabase/client'

// Click-in-place editor (2026-07-22). Renders the slide's REAL filled template HTML live in an
// iframe (not the flat PNG the rest of the app shows) so individual fields are real, clickable DOM
// nodes -- see editableFields.ts for the selector map this depends on.
//
// Explicit-Save build (2026-07-28, Jaylen: "remove instant updating... makes it feel like a lag
// when there isn't"). Every field edit used to call updateSlideField() immediately -- a real
// Cloudflare render + Storage upload round trip, a few real seconds every single time, PLUS a
// fully separate, redundant updateCarouselSlides() DB write on top of that (found while
// investigating this: Viewer.tsx's commitSlides() always re-persisted the same result a second
// time). Field edits no longer touch the network at all here -- they update the live DOM directly
// (already how every edit worked, that part isn't new) and report the changed fields up to
// Viewer.tsx via onFieldsChanged, which just merges them into local React state (no
// render/upload/DB-write) until the user hits the new topbar Save button, which does exactly ONE
// render+upload per touched slide and exactly ONE final DB write for the whole carousel.
//
// No separate "edit mode" toggle (2026-07-24, Jaylen: cut the friction, no visible mode-switch --
// just click a thing and it becomes editable) -- this is now the ONLY thing the stage renders, no
// button gates it. previewUrl (the slide's already-rendered flat image, same one the rest of the
// app already shows) is what actually appears the instant a slide loads -- getSlideEditorHtml is a
// real server round-trip (loads the template file, re-fills it), and showing an empty loading box
// while that resolves would undo the exact "clicking into a project feels slow" fix from earlier
// today. The live iframe silently replaces it once ready; since it's rendering the same real
// values, the swap should be visually imperceptible, not a loading-to-content flash. previewUrl now
// only ever changes from a real external event (chat-editing, or the Save button finishing) --
// never from a field edit made in THIS component, since those no longer touch the server at all.
export type SlideCanvasEditorHandle = {
  setField: (field: string, value: string) => void
}

const SlideCanvasEditor = forwardRef<
  SlideCanvasEditorHandle,
  {
    carouselId: string
    slideIndex: number
    displayWidth: number
    previewUrl?: string
    // The CURRENT local values for this slide, as Viewer.tsx's in-memory state sees them right
    // now -- may already include unsaved edits from earlier in this session. Only read at load
    // time (mount, or a real previewUrl change), not on every keystroke -- see the load() callback
    // below for why this is captured via a ref instead of a dependency.
    currentValues: Record<string, string>
    // Replaces the old onSlidesUpdated -- fires on every local field edit (typed text, a color/
    // font pick, a drag-move/resize commit, a delete, a photo swap) with just the field(s) that
    // changed. Viewer.tsx merges these into its own local state; nothing here waits on or knows
    // about the network.
    onFieldsChanged: (fields: Record<string, string>) => void
    // Bumped by Viewer.tsx ONLY inside undo()/redo() -- see the load-effect's own comment below for
    // why this needs to exist at all (a local-only edit never changes previewUrl, but Undo/Redo
    // still need to force a real reload since they're reverting content the live DOM already shows).
    forceReloadKey: number
    // Real bug found live 2026-07-26 (Jaylen: "still having the same issue" after the divider-
    // specific fix): this used to collapse "a circle/logo is selected" into the exact same null
    // signal as "nothing is selected" (deletable-only), so the shared Delete button still silently
    // fell back to deleting the whole slide for any selected object that isn't the divider. Passing
    // deletable as its own argument lets Viewer.tsx tell "selected, nothing to delete about it" (no-
    // op) apart from "nothing selected at all" (slide-delete is the deliberate fallback).
    //
    // `mode` added same day, second real bug from the same class: text fields never called
    // selectThis() at all (they go straight to contenteditable), so entering edit mode left
    // `selectedField` null from the outer page's point of view -- clicking the topbar Delete button
    // while a caption was mid-edit fell through to whole-SLIDE delete instead of clearing the text.
    // 'text' tells Viewer.tsx to clear the field to '' (the hover-X button's own save path);
    // 'display' (move-only fields: divider/logo) tells it to toggle the field's `_DISPLAY` placeholder
    // instead -- no `_DISPLAY` placeholder exists for text fields, so that toggle would silently do
    // nothing to a caption.
    onSelectionChange?: (field: string | null, deletable: boolean, mode?: 'text' | 'display') => void
  }
>(function SlideCanvasEditor(
  { carouselId, slideIndex, displayWidth, previewUrl, currentValues, forceReloadKey, onFieldsChanged, onSelectionChange },
  ref
) {
  const [data, setData] = useState<SlideEditorData | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Real bug found live (2026-07-28): mutating an existing iframe's srcDoc attribute does NOT
  // reliably reload its content in Chromium -- confirmed directly: after Undo, the iframe element's
  // OWN srcdoc attribute held the correct, reverted HTML, but contentDocument kept showing the
  // stale pre-undo content regardless of how long it waited. This affects every reload path, not
  // just Undo/Redo (chat-editing, Save finishing) -- the only fully reliable fix is forcing React to
  // throw away the old iframe DOM node and create a fresh one, which always parses its srcdoc at
  // creation time. Bumped every time load() actually lands new data; folded into the iframe's own
  // key below so React remounts it on every real reload, not just the first one.
  const [loadGeneration, setLoadGeneration] = useState(0)
  // Only ever true during a photo upload now -- the one remaining action here that genuinely still
  // needs a network call (getting a Storage URL for the picked file) before it can even apply
  // locally. Every other edit is instant, no network, no loading state.
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingPhotoField = useRef<string | null>(null)
  // Read inside load() via .current, deliberately NOT a dependency of that useCallback -- Viewer.tsx
  // passes a new currentValues object on every single local edit (its own state just changed), and
  // if load() depended on it directly, the effect below (keyed on [load, previewUrl]) would fire
  // load() again -- a full iframe reload -- on every keystroke/drag/color pick. currentValues only
  // needs to be correct at the moment of an actual (re)load: first mount, or switching back to a
  // slide that already has unsaved local edits from earlier in this session.
  const currentValuesRef = useRef(currentValues)
  useEffect(() => {
    currentValuesRef.current = currentValues
  }, [currentValues])

  const load = useCallback(async () => {
    // A fresh document is about to load (first mount, or an externally-triggered re-render) -- any
    // selection from the previous document is about to stop existing, so tell the parent before
    // it goes stale (its "Delete" button would otherwise keep targeting a field that no longer
    // has a live selection listener behind it).
    onSelectionChange?.(null, false)
    const result = await getSlideEditorHtml(carouselId, slideIndex, currentValuesRef.current)
    if ('error' in result) {
      setError(result.error)
      setData(null)
      return
    }
    setError(null)
    setData(result)
    setLoadGeneration((g) => g + 1)
  }, [carouselId, slideIndex, onSelectionChange])

  // previewUrl in the dependency list re-runs load() whenever this slide's rendered image changes
  // for a REAL external reason -- chat-editing's editSlide(), or the Save button finishing a
  // render. A field edit made in THIS component never changes previewUrl at all anymore (see the
  // top-of-file comment), so this effect no longer fires on every keystroke/drag/color pick the
  // way it briefly needed a self-save skip-check to avoid -- that check is gone; there's nothing
  // self-authored left to skip.
  //
  // forceReloadKey (2026-07-28, real bug found live): Undo/Redo change Viewer.tsx's `slides` state
  // (and therefore `currentValues`) WITHOUT ever touching previewUrl, by design -- they're local-
  // only now, same as every other edit. But that meant clicking Undo correctly reverted React
  // state (confirmed live: dirty/past/future all updated correctly) while the iframe's own live DOM
  // -- already showing whatever was undone -- never got told to reload and reflect the reverted
  // values, so Undo looked like it silently did nothing. Viewer.tsx bumps this number ONLY inside
  // undo()/redo(), never on a regular field edit, so this effect reloads exactly when it needs to
  // and no more often than that.
  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [load, previewUrl, forceReloadKey])

  // Local-only field edit (2026-07-28) -- no network call, just tells Viewer.tsx what changed so
  // it can merge it into local state (for undo/redo + the eventual Save). The actual DOM update for
  // the edit already happened at each call site before this fires (typing, a color/font pick, a
  // drag commit) -- this function's only job is reporting it upward.
  const applyFields = useCallback(
    (fields: Record<string, string>) => {
      onFieldsChanged(fields)
    },
    [onFieldsChanged]
  )

  // Lets Viewer.tsx's topbar Delete button clear/hide a field the same way the hover-X button and
  // keyboard Delete already do -- applies the optimistic local DOM update itself (this field's
  // value/visibility wouldn't otherwise reflect the delete until some later reload), then reports
  // it up through the same applyFields every other edit uses.
  const setField = useCallback(
    (field: string, value: string) => {
      const doc = iframeRef.current?.contentDocument
      const isDisplay = field.endsWith('_DISPLAY')
      const baseField = isDisplay ? field.slice(0, -'_DISPLAY'.length) : field
      const fieldDef = data?.fields.find((f) => f.field === baseField)
      if (doc && fieldDef) {
        const el = doc.querySelector(fieldDef.selector) as HTMLElement | null
        if (el) {
          if (isDisplay) el.style.visibility = value
          else el.innerHTML = value
        }
      }
      applyFields({ [field]: value })
    },
    [data, applyFields]
  )

  useImperativeHandle(ref, () => ({ setField }), [setField])

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'caroslide-field-edit') {
        applyFields({ [msg.field]: msg.value })
      } else if (msg.type === 'caroslide-fields-edit') {
        applyFields(msg.fields)
      } else if (msg.type === 'caroslide-photo-click') {
        pendingPhotoField.current = msg.field
        fileInputRef.current?.click()
      } else if (msg.type === 'caroslide-field-selected') {
        // Pass all three through -- Viewer.tsx needs to tell "selected, but this field has no
        // delete action" (a circle/logo -- no-op) apart from "nothing selected at all" (slide-
        // delete is the deliberate fallback), and (mode) "clear this text field's value" apart
        // from "toggle this move-only field's _DISPLAY placeholder" -- conflating either pair was
        // a real bug that silently fell back to whole-slide delete instead of the intended action.
        onSelectionChange?.(msg.field, !!msg.deletable, msg.mode)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [applyFields, onSelectionChange])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const field = pendingPhotoField.current
    e.target.value = ''
    if (!file || !field) return
    setUploading(true)
    setError(null)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const path = `${user?.id}/${crypto.randomUUID()}-${file.name}`
      const { data: uploaded, error: uploadError } = await supabase.storage.from('carousel-uploads').upload(path, file)
      if (uploadError || !uploaded) {
        setError('Upload failed -- try again.')
        return
      }
      const { data: pub } = supabase.storage.from('carousel-uploads').getPublicUrl(uploaded.path)
      // Optimistic local update (2026-07-28) -- didn't need one before, since the old save() path
      // always forced a real reload right after, which was what actually showed the new photo.
      // Now that field edits never trigger a reload, this needs to show the new photo itself, same
      // as every other edit already does.
      const doc = iframeRef.current?.contentDocument
      const fieldDef = data?.fields.find((f) => f.field === field)
      if (doc && fieldDef) {
        const el = doc.querySelector(fieldDef.selector) as HTMLElement | null
        if (el) {
          if (fieldDef.kind === 'photo-img') (el as HTMLImageElement).src = pub.publicUrl
          else el.style.backgroundImage = `url('${pub.publicUrl}')`
        }
      }
      applyFields({ [field]: pub.publicUrl })
    } finally {
      setUploading(false)
    }
  }

  // Real fallback, not an empty box: a carousel created before click-in-place editing existed (no
  // stored template/values) hits this same "error" path on every load, and previously left the
  // stage permanently blank. Showing the real image everyone already sees elsewhere in the app
  // means an older carousel just can't be edited in place -- it isn't broken or empty-looking.
  if (error || !data) {
    return previewUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="slide-canvas-editor slide-canvas-editor-fallback" style={{ width: displayWidth }} src={previewUrl} alt="Carousel slide" />
    ) : (
      <div className="slide-canvas-editor slide-canvas-editor-loading" style={{ width: displayWidth, aspectRatio: '4/5' }} />
    )
  }

  const scale = displayWidth / 1080
  // Injected directly into the fetched document (not manipulated after the fact via
  // contentDocument) so it runs as the iframe's own inline script the moment the doc parses --
  // no cross-origin/timing issues waiting for a load event to reach in from outside.
  //
  // Move/resize (2026-07-24, Jaylen). Real bug found and fixed the same day, live feedback ("the
  // movement isn't 100% at the same time as the mouse"): mousemove listeners here are attached
  // INSIDE the iframe's own document, and the browser already reports event coordinates in the
  // iframe's native (unscaled, 1080-wide) space for content inside a CSS-`transform:scale()`d
  // element -- it does the screen-to-local conversion once, automatically. Dividing by SCALE again
  // here was applying that same conversion a SECOND time, inflating every drag by roughly 1/scale
  // on top of the correct 1/scale the browser already did -- at this component's typical ~0.3
  // display scale, that's a real ~3x amplification, not a rounding error. Fixed by using the raw
  // event delta directly; no SCALE division anywhere in the drag math anymore.
  //
  // Text fields with f.sizeField also support shift+drag (vertical) to resize, bounded to 60%-140%
  // of whatever size the element is ALREADY rendering at (its real computed font-size, not a
  // guessed baseline) -- matches the same 60% shrink floor the automatic guardrail system already
  // uses, and avoids the exact "text this big might not even fit" guess this codebase has
  // repeatedly cautioned against elsewhere.
  //
  // Circle click semantics (2026-07-24, real feedback: "I can only update the picture, it's not
  // letting me move the circle... I didn't realize I could move it until I held down on it").
  // Movable photo fields (circles) used to have BOTH a drag-to-move handler AND a plain-click-to-
  // swap handler on the same element -- nothing distinguished "trying to drag" from "trying to
  // click" except whether the browser's own click event fired, which happens for ANY mousedown+up
  // pair that doesn't move far enough, drag-in-progress or not. Split the same way Canva does it:
  // drag moves, a plain click on a movable circle does nothing (no competing action to guess
  // between), and double-click opens the photo picker. Non-movable photos (the main/background
  // image) have no move action to conflict with, so a single click still swaps them, unchanged.
  //
  // Position is a relative translate() offset (continuing from whatever offset a PRIOR drag
  // already saved -- sent down as a real number, f.posX/f.posY, resolved server-side from this
  // slide's own values; a baked-in translate() computes to an opaque matrix() string via
  // getComputedStyle, and the inline style attribute is empty since the offset came from a
  // template placeholder, not a prior JS write, so neither is a reliable source to read a plain
  // number back out of client-side), not an absolute coordinate -- works the same regardless of
  // the template's own default position for that field. Circle fields move their `.circle-wrap`
  // ancestor (the real positioned element), not the bare <img> the selector points at, which is
  // nested two levels inside the circle mask -- see editableFields.ts. Both X and Y (or a resize)
  // commit as ONE batched message on drag-release, not two -- two separate saves would race
  // against each other's read of the current values map.
  //
  // 'move-only' fields (logo, divider -- 2026-07-24) get no click/dblclick handler of any kind,
  // just drag-to-move -- there's no text to edit and no photo to swap (the logo's actual image
  // comes from Brand Kit settings, not click-in-place).
  //
  // Hit-target widening (2026-07-24, real bug: divider reported "not moveable, deletable, or
  // touchable"). Root cause -- the divider renders at 3px tall (~1 real screen px at this
  // component's typical ~0.3 display scale), so EVERY native mouse interaction aimed directly at
  // the element itself (hover-outline, mousedown-to-drag, the old delete button) was nearly
  // impossible to land with a real cursor; 1-cover-circles.html additionally stacks `.caption`
  // (same top offset, no z-index) over the divider's row, blocking it outright regardless of
  // precision. Fixed generically, not divider-specifically: any field whose rendered box is under
  // 20px on either axis gets an invisible padded proxy div (`hit`) sized to its real bounds + 14px
  // margin, given an explicit z-index so it always wins stacking over an unrelated same-position
  // sibling, and EVERY listener below (hover outline, drag-start, click/dblclick, delete-hover)
  // attaches to `hit` instead of the tiny real element -- so a normal-sized field (text, circles,
  // logo) is completely unaffected (`hit` just falls back to `el` itself), while a thin one
  // becomes as easy to hit as everything else. This replaces the earlier per-feature workarounds
  // (a one-off document-level mousemove proximity check that only fixed the delete button's hover,
  // leaving drag-start and the outline itself still broken) with one fix that covers all of it.
  const injectedHtml = data.html.replace(
    '</body>',
    `<script>(function(){
  var BRAND_PRIMARY = ${JSON.stringify(data.primaryColor)};
  var BRAND_SECONDARY = ${JSON.stringify(data.secondaryColor)};
  var fields = ${JSON.stringify(data.fields)};
  // Per-word font (2026-07-27) -- same curated 5-font set Brand Kit already offers
  // (fonts.ts's FONT_LINKS), hand-duplicated here since this injected script has no
  // bundler/import system to share that table with directly. Each rendered slide only loads ONE
  // Google Font up front (the carousel's own chosen brand font) -- picking a DIFFERENT one here
  // needs its own <link> injected on the spot (see ensureFontLoaded below), or it would silently
  // fall back to a generic sans-serif instead of visibly changing.
  var FONTS = [
    { name: 'Inter Tight', family: "'Inter Tight', sans-serif", param: 'Inter+Tight:wght@400;700;900' },
    { name: 'Poppins', family: "'Poppins', sans-serif", param: 'Poppins:wght@400;700;900' },
    { name: 'Montserrat', family: "'Montserrat', sans-serif", param: 'Montserrat:wght@400;700;900' },
    { name: 'Archivo Black', family: "'Archivo Black', sans-serif", param: 'Archivo+Black' },
    { name: 'DM Sans', family: "'DM Sans', sans-serif", param: 'DM+Sans:wght@400;700;900' }
  ];
  function ensureFontLoaded(param){
    var existing = document.querySelector('link[data-caroslide-font="' + param + '"]');
    if (existing) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + param + '&display=swap';
    link.setAttribute('data-caroslide-font', param);
    document.head.appendChild(link);
  }
  // Real bug found live 2026-07-27, caught during this feature's own first deploy verification: a
  // previously-applied per-word font persists fine in the saved HTML (it's just an inline
  // font-family style), but only the ACT of picking a font calls ensureFontLoaded -- a fresh page
  // load never re-scans for fonts already baked into the saved content, so a carousel reopened
  // later would silently render that span in the browser's fallback font until someone reopened
  // the picker and re-picked the same font. Scans every element with an inline font-family the
  // instant this script runs (the DOM already has the saved spans parsed in by this point) and
  // re-requests each one actually used, not just the one the carousel's own Brand Kit chose.
  (function ensureSavedFontsLoaded(){
    var used = document.querySelectorAll('[style*="font-family"]');
    for (var i = 0; i < used.length; i++) {
      // Not a strict equality check against FONTS[j].family -- browsers normalize serialized
      // style values (quotes around a single-word font name like 'Poppins' get silently dropped
      // on read-back), so the saved HTML's font-family string doesn't byte-for-byte match what was
      // originally assigned. Stripping quotes and matching by plain name instead is robust to that.
      var fam = used[i].style.fontFamily.replace(/['"]/g, '').toLowerCase();
      for (var j = 0; j < FONTS.length; j++) {
        if (fam.indexOf(FONTS[j].name.toLowerCase()) === 0) { ensureFontLoaded(FONTS[j].param); break; }
      }
    }
  })();
  // Real bug found live 2026-07-26 (Jaylen: selecting an object then pressing Delete kept
  // deleting the whole slide): a fixed 8-native-unit threshold measures a real click's natural
  // mouse jitter as more native units at this component's typical ~0.3 display scale (native
  // deltas are the REAL screen delta divided by scale, same reasoning as the earlier drag-
  // precision fix) -- meaning most real clicks on a movable field were being misclassified as
  // drags, silently setting justDragged and skipping selectThis() entirely. Confirmed by
  // replaying the actual mousedown/mousemove/mouseup/click sequence a real click goes through
  // (not just a bare click dispatch, which never exercises this path at all -- how this went
  // uncaught through every earlier test). Expressing the threshold as a real-pixel budget divided
  // by scale keeps "how far is a click, not a drag" constant in real screen pixels regardless of
  // how small or large this preview is currently rendered.
  //
  // First pass used 6 real px and still failed live -- a sweep across jitter amounts (real mouse
  // hardware, not just a trackpad, can jitter more than a trackpad does) showed 6px selected fine
  // but 8px already broke it, with nothing telling us where real-world clicks actually land in
  // between. 16px gives real headroom above ordinary click imprecision; an intentional drag needs
  // to visibly relocate something, which is inherently a much larger movement than this, so this
  // doesn't trade away real drag detection to get it.
  var THRESH = 16 / ${scale};
  var PAD = 14;

  // Selection state (2026-07-24, real feedback: "when I select text it stays selected and I can
  // do whatever -- other objects don't do anything"). Text already had an obvious selected state
  // (contenteditable + solid outline, persists until you click away). Circles/logo/divider had NO
  // click reaction at all -- by design, since a plain click was freed up to do nothing so drag
  // (move) and dblclick (swap) wouldn't collide -- but that also meant clicking one gave zero
  // feedback that anything happened. Fixed by giving every non-text editable field the same kind
  // of persistent "selected" outline text already gets: click selects (solid outline, delete
  // button shown immediately if the field has one, not just on hover), stays selected until you
  // click somewhere else -- same object permanence Canva gives any selected element, not just text.
  var selectedEl = null;
  var selectedHide = null;
  var selectedDeleteField = null;
  function deselect(){
    if (!selectedEl) return;
    if (selectedEl.getAttribute('contenteditable') !== 'true') selectedEl.style.outline = '';
    if (selectedHide) selectedHide();
    selectedEl = null;
    selectedHide = null;
    selectedDeleteField = null;
    parent.postMessage({ type: 'caroslide-field-selected', field: null, deletable: false }, '*');
  }
  document.addEventListener('click', deselect);
  // Delete/Backspace on a selected deletable object (2026-07-26, Jaylen: "the object should
  // delete, not the page"). selectedDeleteField is only ever set for fields selectThis() marks
  // deletable (the divider) -- never for text (its own contenteditable/blur flow never touches
  // this), so this can never fire mid-caption-edit and eat a real Backspace keystroke. Same
  // postMessage the delete button's own click already sends, just triggered by keyboard here.
  document.addEventListener('keydown', function(e){
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDeleteField) {
      e.preventDefault();
      // Optimistic local hide (2026-07-26, same latency fix as the hover-X button above) -- without
      // this, the save-skips-reload optimization means nothing visually reflects the delete until
      // some unrelated later reload happens to catch up. selectedEl here is always the same element
      // selectedDeleteField names (selectThis() sets both together), so this is safe.
      if (selectedEl) selectedEl.style.visibility = 'hidden';
      parent.postMessage({ type: 'caroslide-field-edit', field: selectedDeleteField + '_DISPLAY', value: 'hidden' }, '*');
      deselect();
    }
  });

  // Per-word text color highlighting (2026-07-26). Wraps the current browser selection in a new
  // colored span -- Range.extractContents()/insertNode() naturally splits any existing wrapping
  // span (an AI-written c1/c2/c3 span, or an earlier manual color span) at the selection boundary,
  // so only the highlighted portion changes and the untouched parts keep their original color.
  // No new save path: this only edits the DOM. Whatever's in the field when its own blur handler
  // fires (already wired up per text field, see the 'text' branch below) is what gets saved --
  // same path a normal typed edit already uses.
  // A descendant element's own explicit color (an AI-written c1/c2/c3 class, or an earlier manual
  // color span) always wins over an ancestor's color -- wrapping colored content in a new outer
  // span does nothing visually unless the inner color/class is stripped first. Also handles
  // re-coloring text the user already manually colored earlier, not just c1/c2/c3.
  function stripInnerColors(node){
    if (node.nodeType === 1) {
      node.style.color = '';
      node.classList.remove('c1', 'c2', 'c3');
    }
    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) stripInnerColors(children[i]);
  }

  // containerEl lets a caller pass the field explicitly instead of relying on document.activeElement
  // at call time. Swatch clicks call this with no second argument -- activeElement is still
  // genuinely live and contenteditable then, since preventDefault kept focus on the field. But the
  // custom color input's restore flow (below) can't rely on that: by the time its 'input' event
  // fires, the field has already blurred (its own blur handler already stripped its contenteditable
  // attribute) and activeElement is the color input itself, not the field -- a live activeElement
  // re-check would reject a legitimate restore every time. So that flow captures the field reference
  // at mousedown, while it's still genuinely valid, and passes it through here explicitly.
  function applyColorToSelection(color, containerEl){
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    // Guard against a cross-field drag-select (or a stale/foreign selection) wrapping unrelated
    // sibling DOM -- only apply when the selection is actually contained within the field.
    var container = containerEl;
    if (!container) {
      var active = document.activeElement;
      if (!active || active.getAttribute('contenteditable') !== 'true') return null;
      container = active;
    }
    if (!container.contains(range.commonAncestorContainer)) return null;
    var span = document.createElement('span');
    span.style.color = color;
    var contents = range.extractContents();
    stripInnerColors(contents);
    span.appendChild(contents);
    range.insertNode(span);
    sel.removeAllRanges();
    var after = document.createRange();
    after.setStartAfter(span);
    after.collapse(true);
    sel.addRange(after);
    // Returned so a live-adjustable picker (the custom color board) can keep recoloring THIS same
    // span directly on every drag step, instead of re-running the whole wrap/extract logic each
    // time -- the selection collapses right above, so a second call here would find nothing to
    // wrap and silently no-op.
    return span;
  }

  // Per-word font (2026-07-27) -- same wrap-and-strip mechanism as applyColorToSelection, just for
  // font-family instead of color. Deliberately independent of stripInnerColors/applyColorToSelection
  // (clears only font-family, never touches color or the c1/c2/c3 classes) so a font change and a
  // color change can both apply to the same selection without either one clobbering the other.
  function stripInnerFonts(node){
    if (node.nodeType === 1) node.style.fontFamily = '';
    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) stripInnerFonts(children[i]);
  }

  function applyFontToSelection(family, containerEl){
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var container = containerEl;
    if (!container) {
      var active = document.activeElement;
      if (!active || active.getAttribute('contenteditable') !== 'true') return null;
      container = active;
    }
    if (!container.contains(range.commonAncestorContainer)) return null;
    var span = document.createElement('span');
    span.style.fontFamily = family;
    var contents = range.extractContents();
    stripInnerFonts(contents);
    span.appendChild(contents);
    range.insertNode(span);
    sel.removeAllRanges();
    var after = document.createRange();
    after.setStartAfter(span);
    after.collapse(true);
    sel.addRange(after);
    return span;
  }

  // One shared floating toolbar, repositioned/reused for whichever field currently has an active
  // selection -- built once here rather than per-field, since selectionchange is a document-level
  // event, not a per-element one.
  var colorToolbar = document.createElement('div');
  colorToolbar.style.cssText = 'position:absolute;display:none;z-index:60;background:rgba(20,20,20,0.95);border-radius:18px;padding:14px;gap:16px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
  document.body.appendChild(colorToolbar);

  function makeSwatch(color){
    var s = document.createElement('div');
    s.style.cssText = 'width:80px;height:80px;border-radius:50%;cursor:pointer;border:5px solid rgba(255,255,255,0.6);background:' + color + ';display:inline-block;flex-shrink:0;touch-action:manipulation;';
    // pointerdown, not click -- click fires after the field has already blurred/selection may have
    // collapsed in some browsers; pointerdown fires while the selection is still live (and covers
    // touch too, unlike mousedown, which never fires on a real tap). Same class of fix as the
    // topbar Delete button's own e.preventDefault() in Viewer.tsx.
    s.addEventListener('pointerdown', function(e){
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

  // Full custom color picker (2026-07-27, Jaylen: "the color picker is way too small and its
  // limited... it should have the color picker board and the inputs for color numbers") -- the
  // native <input type="color"> this replaces just opened the OS's own tiny native dialog. Built
  // entirely by hand (no library -- this injected script has no bundler/import system to pull one
  // in) as a standard HSV picker: a saturation/value gradient square for the current hue, a hue
  // slider, and a hex text input, all kept in sync.
  function hsvToHex(h, s, v){
    var c = v * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    function toHex(n){ var v2 = Math.round((n + m) * 255); return (v2 < 16 ? '0' : '') + v2.toString(16); }
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }
  function hexToHsv(hex){
    hex = hex.replace('#', '');
    var r = parseInt(hex.substr(0, 2), 16) / 255;
    var g = parseInt(hex.substr(2, 2), 16) / 255;
    var b = parseInt(hex.substr(4, 2), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var s = max === 0 ? 0 : d / max;
    return { h: h, s: s, v: max };
  }

  var pickerTrigger = document.createElement('div');
  pickerTrigger.style.cssText = 'width:80px;height:80px;border-radius:50%;cursor:pointer;border:5px solid rgba(255,255,255,0.6);background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);display:inline-block;flex-shrink:0;touch-action:manipulation;';

  var pickerPanel = document.createElement('div');
  pickerPanel.style.cssText = 'position:absolute;display:none;z-index:61;background:#1a1a1a;border-radius:14px;padding:16px;box-shadow:0 4px 20px rgba(0,0,0,0.5);width:340px;';

  var svSquare = document.createElement('div');
  svSquare.style.cssText = 'position:relative;width:340px;height:220px;border-radius:8px;cursor:crosshair;margin-bottom:16px;touch-action:none;background-image:linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);';
  var svCursor = document.createElement('div');
  svCursor.style.cssText = 'position:absolute;width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.8);transform:translate(-11px,-11px);pointer-events:none;';
  svSquare.appendChild(svCursor);

  var hueSlider = document.createElement('div');
  hueSlider.style.cssText = 'position:relative;width:340px;height:24px;border-radius:12px;cursor:pointer;margin-bottom:16px;touch-action:none;background:linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);';
  var hueCursor = document.createElement('div');
  hueCursor.style.cssText = 'position:absolute;top:-3px;width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.8);transform:translateX(-15px);';
  hueSlider.appendChild(hueCursor);

  var hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.style.cssText = 'width:100%;box-sizing:border-box;padding:12px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111;color:#fff;font-size:20px;font-family:monospace;';

  pickerPanel.appendChild(svSquare);
  pickerPanel.appendChild(hueSlider);
  pickerPanel.appendChild(hexInput);
  document.body.appendChild(pickerPanel);

  var pickerHue = 0, pickerSat = 1, pickerVal = 1;
  // The span currently being live-recolored this picker session -- null until the first color
  // actually gets applied (via a drag on the square/slider, or typing a valid hex), then reused
  // directly for every subsequent adjustment in the SAME session so dragging around doesn't
  // re-wrap the text in a fresh nested span on every single mousemove.
  var pickerTargetSpan = null;
  // Only the hex input needs a saved range to restore -- it's a real <input>, so clicking/typing
  // into it steals focus and collapses the live selection before its 'input' event fires (same
  // class of problem the old native color input had). The square/slider are plain, non-focusable
  // divs with their own e.preventDefault() on mousedown, so focus (and the live selection) never
  // leaves the text field for those two -- no restore dance needed there.
  var pickerSavedRange = null, pickerSavedField = null;

  function updateSquareHue(){ svSquare.style.backgroundColor = 'hsl(' + pickerHue + ', 100%, 50%)'; }
  function updatePickerCursors(){
    svCursor.style.left = (pickerSat * 340) + 'px';
    svCursor.style.top = ((1 - pickerVal) * 220) + 'px';
    hueCursor.style.left = (pickerHue / 360 * 340 - 15) + 'px';
  }
  function applyLivePickerColor(){
    var hex = hsvToHex(pickerHue, pickerSat, pickerVal);
    hexInput.value = hex;
    if (pickerTargetSpan) {
      pickerTargetSpan.style.color = hex;
      return;
    }
    if (pickerSavedRange && pickerSavedField) {
      var sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(pickerSavedRange);
    }
    pickerTargetSpan = applyColorToSelection(hex, pickerSavedField);
  }

  // Pointer Events here too (2026-07-27) -- same mobile gap as the drag-to-move handler above: a
  // real touch drag across the square/slider never fired mousemove, so the picker was undraggable
  // on a phone even though tapping the trigger to open it worked fine.
  svSquare.addEventListener('pointerdown', function(e){
    e.preventDefault();
    svSquare.setPointerCapture(e.pointerId);
    function fromEvent(ev){
      var rect = svSquare.getBoundingClientRect();
      pickerSat = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      pickerVal = 1 - Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      updatePickerCursors();
      applyLivePickerColor();
    }
    fromEvent(e);
    function onMove(ev){ fromEvent(ev); }
    function onUp(){ svSquare.removeEventListener('pointermove', onMove); svSquare.removeEventListener('pointerup', onUp); svSquare.removeEventListener('pointercancel', onUp); }
    svSquare.addEventListener('pointermove', onMove);
    svSquare.addEventListener('pointerup', onUp);
    svSquare.addEventListener('pointercancel', onUp);
  });

  hueSlider.addEventListener('pointerdown', function(e){
    e.preventDefault();
    hueSlider.setPointerCapture(e.pointerId);
    function fromEvent(ev){
      var rect = hueSlider.getBoundingClientRect();
      pickerHue = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * 360;
      updateSquareHue();
      updatePickerCursors();
      applyLivePickerColor();
    }
    fromEvent(e);
    function onMove(ev){ fromEvent(ev); }
    function onUp(){ hueSlider.removeEventListener('pointermove', onMove); hueSlider.removeEventListener('pointerup', onUp); hueSlider.removeEventListener('pointercancel', onUp); }
    hueSlider.addEventListener('pointermove', onMove);
    hueSlider.addEventListener('pointerup', onUp);
    hueSlider.addEventListener('pointercancel', onUp);
  });

  hexInput.addEventListener('pointerdown', function(e){
    e.stopPropagation();
    // Same capture-before-focus-steals-it pattern the old native color input used -- only matters
    // if no span has been created yet this session (see applyLivePickerColor).
    var sel = document.getSelection();
    var activeAtMousedown = document.activeElement;
    if (!pickerTargetSpan && sel && sel.rangeCount > 0 && !sel.isCollapsed && activeAtMousedown && activeAtMousedown.getAttribute('contenteditable') === 'true') {
      pickerSavedRange = sel.getRangeAt(0).cloneRange();
      pickerSavedField = activeAtMousedown;
    }
  });
  hexInput.addEventListener('input', function(){
    var v = hexInput.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
      if (v.charAt(0) !== '#') v = '#' + v;
      var hsv = hexToHsv(v);
      pickerHue = hsv.h; pickerSat = hsv.s; pickerVal = hsv.v;
      updateSquareHue();
      updatePickerCursors();
      applyLivePickerColor();
    }
  });

  function closePicker(){
    pickerPanel.style.display = 'none';
    pickerTargetSpan = null;
    pickerSavedRange = null;
    pickerSavedField = null;
  }
  pickerTrigger.addEventListener('pointerdown', function(e){
    e.preventDefault();
    e.stopPropagation();
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    closeFontPanel();
    pickerHue = 0; pickerSat = 0; pickerVal = 1;
    updateSquareHue();
    updatePickerCursors();
    hexInput.value = hsvToHex(pickerHue, pickerSat, pickerVal);
    var triggerRect = pickerTrigger.getBoundingClientRect();
    var panelLeft = Math.min(triggerRect.left, document.documentElement.clientWidth - 340 - 8);
    pickerPanel.style.left = Math.max(4, panelLeft) + 'px';
    pickerPanel.style.top = (triggerRect.bottom + 8) + 'px';
    pickerPanel.style.display = 'block';
  });
  document.addEventListener('pointerdown', function(e){
    if (pickerPanel.style.display !== 'none' && e.target !== pickerTrigger && !pickerPanel.contains(e.target)) {
      closePicker();
    }
  });

  // Per-word font trigger + panel (2026-07-27) -- same interaction shape as the color picker
  // trigger/panel above, but simpler: no live drag-adjust needed, just discrete buttons. fontTrigger
  // and each row are plain, non-focusable divs with their own preventDefault() on pointerdown, so
  // (like the SV square/hue slider, and unlike the hex input) focus and the live selection never
  // leave the text field across opening the panel and picking a font -- no saved-range restore
  // dance needed here.
  var fontTrigger = document.createElement('div');
  fontTrigger.style.cssText = 'width:80px;height:80px;border-radius:50%;cursor:pointer;border:5px solid rgba(255,255,255,0.6);background:#1a1a1a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;flex-shrink:0;touch-action:manipulation;';
  fontTrigger.textContent = 'Aa';

  var fontPanel = document.createElement('div');
  fontPanel.style.cssText = 'position:absolute;display:none;z-index:61;background:#1a1a1a;border-radius:14px;padding:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);width:340px;';
  FONTS.forEach(function(f){
    // Each option previewed in its own real typeface (Canva-style) so picking one shows exactly
    // what it'll look like before committing, not just a plain text label. Real bug found live on
    // an actual phone (2026-07-27): every row rendered in the same generic fallback font, because
    // ensureFontLoaded only ran at the moment of PICKING a font -- the other 4 options' font files
    // were never fetched just to browse the list, so their font-family CSS had nothing to apply.
    // Loading all 5 up front here (not lazily) makes the live preview actually true.
    ensureFontLoaded(f.param);
    var row = document.createElement('div');
    row.style.cssText = 'padding:16px 18px;border-radius:8px;cursor:pointer;color:#fff;font-size:30px;line-height:1.2;font-family:' + f.family + ';touch-action:manipulation;';
    row.textContent = f.name;
    row.addEventListener('pointerdown', function(e){
      e.preventDefault();
      e.stopPropagation();
      // Real bug found live on an actual phone (2026-07-28, Jaylen: "the text unhighlight but the
      // font choices still show up. i click one and it doesn't work"): unlike a color swatch (one
      // tap, applies to whatever's selected at that same tap), picking a font is a TWO-tap flow --
      // tap the trigger to open this panel, then tap a row here. On mobile, iOS's native text-
      // selection UI can collapse the actual Selection object between those two taps (even though
      // the field itself never loses focus), so re-reading document.getSelection() here can find
      // nothing left to apply to. Same class of problem the hex color input already solved -- save
      // the range at trigger-tap time (still reliably live then) and restore it here before
      // applying, instead of trusting whatever the live selection happens to be by now.
      if (fontSavedRange && fontSavedField) {
        var sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(fontSavedRange);
      }
      applyFontToSelection(f.family, fontSavedField);
      closeFontPanel();
    });
    row.addEventListener('mouseenter', function(){ row.style.background = 'rgba(255,255,255,0.1)'; });
    row.addEventListener('mouseleave', function(){ row.style.background = ''; });
    fontPanel.appendChild(row);
  });
  document.body.appendChild(fontPanel);

  var fontSavedRange = null, fontSavedField = null;
  function closeFontPanel(){
    fontPanel.style.display = 'none';
    fontSavedRange = null;
    fontSavedField = null;
  }
  fontTrigger.addEventListener('pointerdown', function(e){
    e.preventDefault();
    e.stopPropagation();
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var active = document.activeElement;
    if (active && active.getAttribute('contenteditable') === 'true') {
      fontSavedRange = sel.getRangeAt(0).cloneRange();
      fontSavedField = active;
    }
    closePicker();
    var triggerRect = fontTrigger.getBoundingClientRect();
    var panelLeft = Math.min(triggerRect.left, document.documentElement.clientWidth - 340 - 8);
    fontPanel.style.left = Math.max(4, panelLeft) + 'px';
    fontPanel.style.top = (triggerRect.bottom + 8) + 'px';
    fontPanel.style.display = 'block';
  });
  document.addEventListener('pointerdown', function(e){
    if (fontPanel.style.display !== 'none' && e.target !== fontTrigger && !fontPanel.contains(e.target)) {
      closeFontPanel();
    }
  });

  colorToolbar.appendChild(pickerTrigger);
  colorToolbar.appendChild(fontTrigger);

  document.addEventListener('selectionchange', function(){
    var active = document.activeElement;
    var sel = document.getSelection();
    if (!active || active.getAttribute('contenteditable') !== 'true' || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      colorToolbar.style.display = 'none';
      return;
    }
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    colorToolbar.style.display = 'flex';
    // Offset widened 174->208 (2026-07-27) -- the toolbar gained a 6th circle (the font trigger),
    // recompute: padding 10*2 + 6*56 circles + 5*12 gaps = 416px total, half = 208.
    // Offset widened again 208->294 (2026-07-28, Jaylen: circles "really small" on both phone and
    // desktop) -- recompute: padding 14*2 + 6*80 circles + 5*16 gaps = 588px total, half = 294.
    colorToolbar.style.left = Math.max(4, rect.left + rect.width / 2 - 294) + 'px';
    colorToolbar.style.top = Math.max(4, rect.top - 112) + 'px';
  });

  fields.forEach(function(f){
    var el = document.querySelector(f.selector);
    if (!el) return;

    var hit = el;
    if (el.offsetHeight < 20 || el.offsetWidth < 20) {
      hit = document.createElement('div');
      hit.style.cssText = 'position:absolute;z-index:40;background:transparent;';
      hit.style.left = (el.offsetLeft - PAD) + 'px';
      hit.style.top = (el.offsetTop - PAD) + 'px';
      hit.style.width = (el.offsetWidth + PAD * 2) + 'px';
      hit.style.height = (el.offsetHeight + PAD * 2) + 'px';
      el.parentNode.appendChild(hit);
    }

    hit.style.cursor = 'pointer';
    hit.addEventListener('mouseenter', function(){ if (el.getAttribute('contenteditable') !== 'true' && el !== selectedEl) el.style.outline = '3px dashed rgba(124,58,237,0.85)'; });
    hit.addEventListener('mouseleave', function(){ if (el.getAttribute('contenteditable') !== 'true' && el !== selectedEl) el.style.outline = ''; });

    var justDragged = false;
    if (f.movable) {
      var moveTarget = f.kind === 'photo-img' ? (el.closest('.circle-wrap') || el) : el;
      hit.style.cursor = 'grab';
      // touch-action:none (2026-07-27, real bug: "can't highlight text on mobile") -- without this,
      // a touch-drag on a movable field is ambiguous to the browser (page pan vs. our own drag), and
      // it can hijack the gesture as a scroll before our pointerdown handler ever sees a pointermove.
      // Text fields flip this to 'auto' the moment they actually become contenteditable (see the
      // click handler below) so native touch text-selection isn't blocked once you're editing --
      // move-dragging and text-selecting are mutually exclusive states for the same field, same as
      // the existing contenteditable-guard just below already assumes.
      hit.style.touchAction = 'none';
      // Real bug found live on an actual phone (2026-07-27): a long-press on a movable circle photo
      // (a real <img>) triggered iOS Safari's own native image callout (Share.../Save to Photos/
      // Copy/Look Up) instead of starting our drag -- a separate Safari-specific gesture that
      // touch-action:none doesn't cover at all. -webkit-touch-callout only suppresses that specific
      // long-press-on-image-or-link menu; it doesn't affect the native text-selection context menu
      // (Cut/Copy/Paste), which already worked correctly and should keep working once a text field
      // is actually in edit mode.
      hit.style.webkitTouchCallout = 'none';
      // Pointer Events (2026-07-27), not mouse-only -- unifies mouse/touch/pen so the same drag-to-
      // move/drag-to-select logic works on a real phone, not just a desktop cursor. Real bug found
      // live: this whole interaction was wired exclusively to mousedown/mousemove/mouseup, which
      // never fire during an actual touch drag (only a single synthetic click fires after touchend,
      // with no intervening move events) -- so touch could tap into a field but never drag it or
      // select text inside it. setPointerCapture keeps move/up events targeting hit directly even
      // if the finger/cursor leaves its bounds mid-drag, replacing the old window-listener approach
      // (which only worked because real mouse input bubbles to window; touch's implicit capture
      // target is less consistent across browsers without this).
      hit.addEventListener('pointerdown', function(e){
        // Real bug found live 2026-07-26 (video evidence: dragging across text never produced a
        // selection, so the color-highlighting toolbar never appeared): this handler's own
        // e.preventDefault() unconditionally blocks the browser's native "start a text selection"
        // behavior on mousedown -- including while the field is already being edited, where a
        // drag is supposed to mean "select this text," not "reposition the box." Move/resize only
        // makes sense BEFORE you've clicked in to edit -- once contenteditable is on, let the
        // native default proceed so text selection (and the color toolbar it drives) can work.
        if (f.kind === 'text' && el.getAttribute('contenteditable') === 'true') return;
        e.preventDefault();
        e.stopPropagation();
        hit.setPointerCapture(e.pointerId);
        var startX = e.clientX, startY = e.clientY, moved = false;
        var baseX = f.posX || 0;
        var baseY = f.posY || 0;
        var resizing = e.shiftKey && f.kind === 'text' && !!f.sizeField;
        var baseSize = resizing ? parseFloat(getComputedStyle(el).fontSize) : 0;
        var liveSize = baseSize, finalX = baseX, finalY = baseY;

        function onMove(ev){
          var dx = ev.clientX - startX;
          var dy = ev.clientY - startY;
          if (Math.abs(dx) > THRESH || Math.abs(dy) > THRESH) moved = true;
          if (!moved) return;
          if (resizing) {
            liveSize = Math.max(baseSize * 0.6, Math.min(baseSize * 1.4, baseSize - dy * 0.5));
            el.style.fontSize = liveSize + 'px';
          } else {
            finalX = Math.round(baseX + dx);
            finalY = Math.round(baseY + dy);
            moveTarget.style.transform = 'translate(' + finalX + 'px, ' + finalY + 'px)';
          }
        }
        function onUp(){
          hit.removeEventListener('pointermove', onMove);
          hit.removeEventListener('pointerup', onUp);
          hit.removeEventListener('pointercancel', onUp);
          if (!moved) return;
          justDragged = true;
          setTimeout(function(){ justDragged = false; }, 0);
          if (resizing) {
            parent.postMessage({ type: 'caroslide-field-edit', field: f.sizeField, value: Math.round(liveSize) + 'px' }, '*');
          } else {
            var payload = {};
            payload[f.field + '_POS_X'] = finalX + 'px';
            payload[f.field + '_POS_Y'] = finalY + 'px';
            parent.postMessage({ type: 'caroslide-fields-edit', fields: payload }, '*');
          }
        }
        hit.addEventListener('pointermove', onMove);
        hit.addEventListener('pointerup', onUp);
        hit.addEventListener('pointercancel', onUp);
      });
    }

    // Deletable elements' button is built before the click handlers below so selectThis() can
    // show it immediately on select, not just on hover. Positioned INSIDE hit's own padded bounds
    // (not floating above it) so moving the cursor from hit onto the button never crosses a gap
    // outside hit's box -- that gap would fire hit's mouseleave (hiding the button) before the
    // cursor ever reached it.
    var showBtn = null, hideBtn = null;
    if (f.deletable) {
      var btn = document.createElement('div');
      btn.textContent = '\\u00d7';
      btn.style.cssText = 'position:absolute;width:22px;height:22px;line-height:20px;text-align:center;border-radius:50%;background:rgba(10,10,10,0.85);color:#fff;font-size:15px;font-family:sans-serif;cursor:pointer;z-index:50;display:none;';
      btn.style.top = (el.offsetTop - 10) + 'px';
      btn.style.left = (el.offsetLeft + el.offsetWidth - 26) + 'px';
      el.parentNode.appendChild(btn);
      showBtn = function(){
        // Text fields have no separate "selected" state (click goes straight to contenteditable)
        // -- never reveal the delete button while actively editing, so it can't sit in the way of
        // a real typing cursor or get clicked by accident mid-edit.
        if (f.kind === 'text' && el.getAttribute('contenteditable') === 'true') return;
        btn.style.display = 'block';
      };
      hideBtn = function(){ btn.style.display = 'none'; };
      hit.addEventListener('mouseenter', showBtn);
      hit.addEventListener('mouseleave', function(){ if (el !== selectedEl) hideBtn(); });
      btn.addEventListener('mouseleave', function(){ if (el !== selectedEl) hideBtn(); });
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        hideBtn();
        // Text fields have no FIELD_DISPLAY placeholder in any template (unlike the divider) --
        // clearing the field's own value to empty is enough to make the box disappear visually,
        // via the exact same save path a normal text edit already uses.
        //
        // Real latency bug found live 2026-07-26: this button-driven delete never updated el
        // itself, unlike a normal typed edit (where the user's own typing already shows the new
        // value before any save). The save-skips-reload optimization added earlier today means
        // nothing ever visually reflected this delete until some UNRELATED later reload happened
        // to catch up -- clearing el here directly (same as a real edit already does) makes this
        // delete feel exactly as instant as typing does, instead of paying the full render round-
        // trip before anything visibly changes.
        if (f.kind === 'text') {
          el.innerHTML = '';
          parent.postMessage({ type: 'caroslide-field-edit', field: f.field, value: '' }, '*');
        } else {
          el.style.visibility = 'hidden';
          parent.postMessage({ type: 'caroslide-field-edit', field: f.field + '_DISPLAY', value: 'hidden' }, '*');
        }
      });
    }

    function selectThis(){
      deselect();
      selectedEl = el;
      selectedHide = hideBtn;
      selectedDeleteField = f.deletable ? f.field : null;
      el.style.outline = '3px solid #7C3AED';
      if (showBtn) showBtn();
      parent.postMessage({ type: 'caroslide-field-selected', field: f.field, deletable: !!f.deletable, mode: 'display' }, '*');
    }

    if (f.kind === 'text') {
      hit.addEventListener('click', function(e){
        e.stopPropagation();
        if (justDragged) return;
        deselect();
        if (hideBtn) hideBtn();
        el.setAttribute('contenteditable', 'true');
        el.style.outline = '3px solid #7C3AED';
        // Let native touch text-selection through now that this field is actually editable -- see
        // the touch-action:none default set above, next to the pointerdown handler this pairs with.
        el.style.touchAction = 'auto';
        el.focus();
        // Real bug found live 2026-07-26: entering edit mode never told the outer topbar Delete
        // button anything was selected (text has no selectThis() call, unlike move-only fields) --
        // so clicking that shared button while a caption was mid-edit silently fell through to
        // deleting the WHOLE SLIDE instead of the text, since selectedField was still null from the
        // outer page's point of view. mode:'text' tells Viewer.tsx to clear this field to '' (the
        // same save path the hover-X button already uses) instead of the '_DISPLAY' toggle move-only
        // fields use -- no FIELD_DISPLAY placeholder exists for text, so that toggle would silently
        // do nothing to a caption.
        parent.postMessage({ type: 'caroslide-field-selected', field: f.field, deletable: true, mode: 'text' }, '*');
      });
      el.addEventListener('blur', function(){
        el.removeAttribute('contenteditable');
        el.style.outline = '';
        el.style.touchAction = 'none';
        parent.postMessage({ type: 'caroslide-field-edit', field: f.field, value: el.innerHTML.trim() }, '*');
        parent.postMessage({ type: 'caroslide-field-selected', field: null, deletable: false }, '*');
      });
    } else if (f.kind === 'photo-img' && f.movable) {
      // Circles: click selects (same persistent outline as everything else, no competing action
      // to guess between), drag moves (handled above), double-click swaps.
      hit.addEventListener('click', function(e){
        e.stopPropagation();
        if (justDragged) return;
        selectThis();
      });
      hit.addEventListener('dblclick', function(e){
        e.stopPropagation();
        if (justDragged) return;
        parent.postMessage({ type: 'caroslide-photo-click', field: f.field }, '*');
      });
    } else if (f.kind === 'photo-img' || f.kind === 'photo-bg') {
      // Main/background photos: no move action exists, so a single click still swaps, unchanged.
      hit.addEventListener('click', function(e){
        e.stopPropagation();
        if (justDragged) return;
        deselect();
        parent.postMessage({ type: 'caroslide-photo-click', field: f.field }, '*');
      });
    } else if (f.kind === 'move-only') {
      // Logo, divider: no text to edit, no photo to swap -- click selects (persistent outline +
      // delete button if this field has one), drag moves.
      hit.addEventListener('click', function(e){
        e.stopPropagation();
        if (justDragged) return;
        selectThis();
      });
    }
  });
})();<\/script></body>`
  )

  return (
    <div className="slide-canvas-editor" style={{ width: displayWidth, height: data.canvasH * scale }}>
      <iframe
        key={`${slideIndex}-${loadGeneration}`}
        ref={iframeRef}
        srcDoc={injectedHtml}
        title="Slide editor"
        style={{ width: 1080, height: data.canvasH, transform: `scale(${scale})`, transformOrigin: 'top left', border: 'none' }}
      />
      <input ref={fileInputRef} type="file" accept="image/*" className="slide-canvas-editor-file-input" onChange={handleFileSelected} />
      {uploading && <div className="slide-canvas-editor-saving">Uploading…</div>}
    </div>
  )
})

export default SlideCanvasEditor
