'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSlideEditorHtml, updateSlideField, type SlideEditorData } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'
import type { Slide } from '@/lib/types'

// Click-in-place editor (2026-07-22). Renders the slide's REAL filled template HTML live in an
// iframe (not the flat PNG the rest of the app shows) so individual fields are real, clickable DOM
// nodes -- see editableFields.ts for the selector map this depends on. A saved edit re-renders
// server-side via updateSlideField and this component just reloads the fresh HTML + tells the
// parent about the new slides array (same commitSlides()/undo-redo path chat-editing already uses).
//
// No separate "edit mode" toggle (2026-07-24, Jaylen: cut the friction, no visible mode-switch --
// just click a thing and it becomes editable) -- this is now the ONLY thing the stage renders, no
// button gates it. previewUrl (the slide's already-rendered flat image, same one the rest of the
// app already shows) is what actually appears the instant a slide loads -- getSlideEditorHtml is a
// real server round-trip (loads the template file, re-fills it), and showing an empty loading box
// while that resolves would undo the exact "clicking into a project feels slow" fix from earlier
// today. The live iframe silently replaces it once ready; since it's rendering the same real
// values, the swap should be visually imperceptible, not a loading-to-content flash.
export default function SlideCanvasEditor({
  carouselId,
  slideIndex,
  displayWidth,
  previewUrl,
  onSlidesUpdated,
}: {
  carouselId: string
  slideIndex: number
  displayWidth: number
  previewUrl?: string
  onSlidesUpdated: (slides: Slide[]) => void
}) {
  const [data, setData] = useState<SlideEditorData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingPhotoField = useRef<string | null>(null)

  const load = useCallback(async () => {
    const result = await getSlideEditorHtml(carouselId, slideIndex)
    if ('error' in result) {
      setError(result.error)
      setData(null)
      return
    }
    setError(null)
    setData(result)
  }, [carouselId, slideIndex])

  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [load])

  const save = useCallback(
    async (fields: Record<string, string>) => {
      setSaving(true)
      setError(null)
      try {
        const result = await updateSlideField(carouselId, slideIndex, fields)
        if (result.type === 'updated') {
          onSlidesUpdated(result.slides)
          await load()
        } else {
          setError(result.message)
        }
      } finally {
        setSaving(false)
      }
    },
    [carouselId, slideIndex, onSlidesUpdated, load]
  )

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'caroslide-field-edit') {
        save({ [msg.field]: msg.value })
      } else if (msg.type === 'caroslide-fields-edit') {
        save(msg.fields)
      } else if (msg.type === 'caroslide-photo-click') {
        pendingPhotoField.current = msg.field
        fileInputRef.current?.click()
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [save])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const field = pendingPhotoField.current
    e.target.value = ''
    if (!file || !field) return
    setSaving(true)
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
      await save({ [field]: pub.publicUrl })
    } finally {
      setSaving(false)
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
  // comes from Brand Kit settings, not click-in-place). Deletable fields (the divider) also get a
  // small hover-revealed "x" button, positioned from the element's own offsetTop/Left/Width (both
  // are elements in the SAME iframe document, so plain offset geometry is enough -- no
  // getBoundingClientRect/cross-frame math needed) that sets a real `{FIELD}_DISPLAY` value, the
  // same kind of on/off toggle CIRCLES_DISPLAY already uses -- reversible via the existing
  // undo-stack, not a special-cased "restore" control.
  const injectedHtml = data.html.replace(
    '</body>',
    `<script>(function(){
  var fields = ${JSON.stringify(data.fields)};
  var THRESH = 8;
  fields.forEach(function(f){
    var el = document.querySelector(f.selector);
    if (!el) return;
    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', function(){ if (el.getAttribute('contenteditable') !== 'true') el.style.outline = '3px dashed rgba(124,58,237,0.85)'; });
    el.addEventListener('mouseleave', function(){ if (el.getAttribute('contenteditable') !== 'true') el.style.outline = ''; });

    var justDragged = false;
    if (f.movable) {
      var moveTarget = f.kind === 'photo-img' ? (el.closest('.circle-wrap') || el) : el;
      moveTarget.style.cursor = 'grab';
      moveTarget.addEventListener('mousedown', function(e){
        e.preventDefault();
        e.stopPropagation();
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
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
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
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }

    if (f.kind === 'text') {
      el.addEventListener('click', function(e){
        e.stopPropagation();
        if (justDragged) return;
        el.setAttribute('contenteditable', 'true');
        el.style.outline = '3px solid #7C3AED';
        el.focus();
      });
      el.addEventListener('blur', function(){
        el.removeAttribute('contenteditable');
        el.style.outline = '';
        parent.postMessage({ type: 'caroslide-field-edit', field: f.field, value: el.innerHTML.trim() }, '*');
      });
    } else if (f.kind === 'photo-img' && f.movable) {
      // Circles: drag moves (handled above), double-click swaps, plain click does nothing --
      // no competing action to guess between on a single click.
      el.addEventListener('dblclick', function(e){
        e.stopPropagation();
        if (justDragged) return;
        parent.postMessage({ type: 'caroslide-photo-click', field: f.field }, '*');
      });
    } else if (f.kind === 'photo-img' || f.kind === 'photo-bg') {
      // Main/background photos: no move action exists, so a single click still swaps, unchanged.
      el.addEventListener('click', function(e){
        e.stopPropagation();
        if (justDragged) return;
        parent.postMessage({ type: 'caroslide-photo-click', field: f.field }, '*');
      });
    }
    // 'move-only' fields (logo, divider): no click/dblclick handler at all -- drag-to-move above
    // is the only interaction.

    if (f.deletable) {
      // A 3px-tall divider is ~1 real screen pixel at this component's typical display scale --
      // relying on native hover directly over the element itself is nearly impossible to land on
      // (for a real cursor, not just automation). Widen the effective hover zone with a proximity
      // check on document-level mousemove instead of native mouseenter/mouseleave on the thin
      // element itself -- doesn't touch the divider's own rendered size/appearance at all.
      var MARGIN = 16;
      var btn = document.createElement('div');
      btn.textContent = '\\u00d7';
      btn.style.cssText = 'position:absolute;width:22px;height:22px;line-height:20px;text-align:center;border-radius:50%;background:rgba(10,10,10,0.85);color:#fff;font-size:15px;font-family:sans-serif;cursor:pointer;z-index:50;display:none;';
      btn.style.top = (el.offsetTop - 26) + 'px';
      btn.style.left = (el.offsetLeft + el.offsetWidth - 22) + 'px';
      el.parentNode.appendChild(btn);
      function showBtn(){ btn.style.display = 'block'; }
      function hideBtn(){ btn.style.display = 'none'; }
      document.addEventListener('mousemove', function(ev){
        if (btn.matches(':hover')) return;
        var near = ev.clientX >= el.offsetLeft - MARGIN && ev.clientX <= el.offsetLeft + el.offsetWidth + MARGIN
          && ev.clientY >= el.offsetTop - MARGIN && ev.clientY <= el.offsetTop + el.offsetHeight + MARGIN;
        if (near) showBtn(); else hideBtn();
      });
      btn.addEventListener('mouseleave', hideBtn);
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        hideBtn();
        parent.postMessage({ type: 'caroslide-field-edit', field: f.field + '_DISPLAY', value: 'hidden' }, '*');
      });
    }
  });
})();<\/script></body>`
  )

  return (
    <div className="slide-canvas-editor" style={{ width: displayWidth, height: data.canvasH * scale }}>
      <iframe
        key={slideIndex}
        srcDoc={injectedHtml}
        title="Slide editor"
        style={{ width: 1080, height: data.canvasH, transform: `scale(${scale})`, transformOrigin: 'top left', border: 'none' }}
      />
      <input ref={fileInputRef} type="file" accept="image/*" className="slide-canvas-editor-file-input" onChange={handleFileSelected} />
      {saving && <div className="slide-canvas-editor-saving">Saving…</div>}
    </div>
  )
}
