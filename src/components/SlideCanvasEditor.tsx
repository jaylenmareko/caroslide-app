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
export default function SlideCanvasEditor({
  carouselId,
  slideIndex,
  displayWidth,
  onSlidesUpdated,
}: {
  carouselId: string
  slideIndex: number
  displayWidth: number
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

  if (error) {
    return (
      <div className="slide-canvas-editor slide-canvas-editor-error" style={{ width: displayWidth }}>
        <p>{error}</p>
      </div>
    )
  }
  if (!data) {
    return <div className="slide-canvas-editor slide-canvas-editor-loading" style={{ width: displayWidth, aspectRatio: '4/5' }} />
  }

  const scale = displayWidth / 1080
  // Injected directly into the fetched document (not manipulated after the fact via
  // contentDocument) so it runs as the iframe's own inline script the moment the doc parses --
  // no cross-origin/timing issues waiting for a load event to reach in from outside.
  //
  // Move/resize (2026-07-24, Jaylen): text and circle-photo elements (f.movable) can be dragged to
  // a new position; text fields with f.sizeField also support shift+drag (vertical) to resize,
  // bounded to 60%-140% of whatever size the element is ALREADY rendering at (its real computed
  // font-size, not a guessed baseline) -- matches the same 60% shrink floor the automatic
  // guardrail system already uses, and avoids the exact "text this big might not even fit" guess
  // this codebase has repeatedly cautioned against elsewhere (character count alone isn't a
  // reliable fit proxy -- see templates-guide.md's wide-glyph-stat note). A plain click still
  // means "edit this text" / "swap this photo" -- a real drag (past a small pixel threshold)
  // suppresses that so dragging a caption doesn't also open contenteditable underneath the drag.
  // Position is a relative translate() offset (continuing from whatever offset a PRIOR drag
  // already saved -- sent down as a real number, f.posX/f.posY, resolved server-side from this
  // slide's own values; a baked-in translate() computes to an opaque matrix() string via
  // getComputedStyle, and the inline style attribute is empty since the offset came from a
  // template placeholder, not a prior JS write, so neither is a reliable source to read a plain
  // number back out of client-side), not an absolute coordinate -- works the same regardless of
  // the template's own default position for that field. Circle
  // fields move their `.circle-wrap` ancestor (the real positioned element), not the bare <img> the
  // selector points at, which is nested two levels inside the circle mask -- see editableFields.ts.
  // Both X and Y (or a resize) commit as ONE batched message on drag-release, not two -- two
  // separate saves would race against each other's read of the current values map.
  const injectedHtml = data.html.replace(
    '</body>',
    `<script>(function(){
  var fields = ${JSON.stringify(data.fields)};
  var SCALE = ${scale};
  var THRESH = 4;
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
          var dx = (ev.clientX - startX) / SCALE;
          var dy = (ev.clientY - startY) / SCALE;
          if (Math.abs(ev.clientX - startX) > THRESH || Math.abs(ev.clientY - startY) > THRESH) moved = true;
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
    } else {
      el.addEventListener('click', function(e){
        e.stopPropagation();
        if (justDragged) return;
        parent.postMessage({ type: 'caroslide-photo-click', field: f.field }, '*');
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
