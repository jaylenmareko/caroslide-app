import { notFound } from 'next/navigation'
import { createClient } from '@/backend/lib/supabase/server'
import Viewer from '@/frontend/components/Viewer'
import GeneratingView from '@/frontend/components/GeneratingView'
import type { Carousel } from '@/backend/lib/types'

export default async function CarouselPage(props: PageProps<'/carousel/[id]'>) {
  const { id } = await props.params
  const supabase = await createClient()

  const { data } = await supabase.from('carousels').select('*').eq('id', id).single()

  if (!data) notFound()

  const carousel = data as Carousel

  // Real generation runs in the background after redirect (see actions.ts's createCarousel) --
  // this page can load before the slides exist yet. GeneratingView polls until status flips to
  // 'ready'/'failed', then this server component re-runs and renders the real Viewer.
  if (carousel.status === 'generating' || carousel.status === 'failed') {
    return <GeneratingView carouselId={carousel.id} initialStatus={carousel.status} initialErrorMessage={carousel.error_message} />
  }

  return <Viewer carousel={carousel} />
}
