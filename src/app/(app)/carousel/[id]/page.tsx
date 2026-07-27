import { notFound } from 'next/navigation'
import { createClient } from '@/backend/lib/supabase/server'
import Viewer from '@/frontend/components/Viewer'
import type { Carousel } from '@/backend/lib/types'

export default async function CarouselPage(props: PageProps<'/carousel/[id]'>) {
  const { id } = await props.params
  const supabase = await createClient()

  const { data } = await supabase.from('carousels').select('*').eq('id', id).single()

  if (!data) notFound()

  return <Viewer carousel={data as Carousel} />
}
