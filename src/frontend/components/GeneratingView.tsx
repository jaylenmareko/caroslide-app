'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getCarouselGenerationStatus } from '@/backend/lib/actions'

// Real generation runs in the background after the wizard redirects here (see actions.ts's
// createCarousel comment) -- this page can load before the slides exist yet. Polls every few
// seconds and, once status flips away from 'generating', calls router.refresh() so the parent
// server component re-fetches the now-finished carousel row and swaps this out for the real
// Viewer -- no need to duplicate slide-loading logic here.
const POLL_INTERVAL_MS = 4000

export default function GeneratingView({
  carouselId,
  initialStatus,
  initialErrorMessage,
}: {
  carouselId: string
  initialStatus: 'generating' | 'failed'
  initialErrorMessage: string | null
}) {
  const router = useRouter()
  const stoppedRef = useRef(initialStatus === 'failed')

  useEffect(() => {
    if (stoppedRef.current) return
    const interval = setInterval(async () => {
      const result = await getCarouselGenerationStatus(carouselId)
      if (result.status !== 'generating') {
        stoppedRef.current = true
        clearInterval(interval)
        router.refresh()
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [carouselId, router])

  if (initialStatus === 'failed') {
    return (
      <section className="new-section wrap">
        <h1>Something went wrong</h1>
        <p className="attach-limit-error" style={{ fontSize: 14, margin: '0 0 20px' }}>
          {initialErrorMessage || 'This carousel failed to generate. Try again.'}
        </p>
        <Link href="/new" className="settings-save">
          Try again
        </Link>
      </section>
    )
  }

  return (
    <section className="new-section wrap" style={{ alignItems: 'center', textAlign: 'center' }}>
      <div className="composer-spinner" style={{ width: 32, height: 32, borderWidth: 3, borderColor: 'rgba(0,0,0,0.12)', borderTopColor: 'var(--green)', margin: '40px 0 22px' }} />
      <h1>Writing and rendering your carousel</h1>
      <p className="lede" style={{ margin: 0 }}>
        This usually takes 2-3 minutes -- feel free to leave this page, it&apos;ll keep going in the
        background. It&apos;ll be ready here when you come back.
      </p>
    </section>
  )
}
