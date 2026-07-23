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
    async (field: string, value: string) => {
      setSaving(true)
      setError(null)
      try {
        const result = await updateSlideField(carouselId, slideIndex, field, value)
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
        save(msg.field, msg.value)
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
      await save(field, pub.publicUrl)
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
  const injectedHtml = data.html.replace(
    '</body>',
    `<script>(function(){
  var fields = ${JSON.stringify(data.fields)};
  fields.forEach(function(f){
    var el = document.querySelector(f.selector);
    if (!el) return;
    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', function(){ if (el.getAttribute('contenteditable') !== 'true') el.style.outline = '3px dashed rgba(124,58,237,0.85)'; });
    el.addEventListener('mouseleave', function(){ if (el.getAttribute('contenteditable') !== 'true') el.style.outline = ''; });
    if (f.kind === 'text') {
      el.addEventListener('click', function(e){
        e.stopPropagation();
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
