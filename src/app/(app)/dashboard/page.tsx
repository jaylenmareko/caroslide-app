import { createClient } from '@/lib/supabase/server'
import DashboardGrid from '@/components/DashboardGrid'
import type { Carousel } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Narrowed from select('*') -- the dashboard grid only ever renders id/title/angle/format/
  // updated_at and slides[0].url, but '*' was pulling reference_images, brand_colors, brief, and
  // every slide's full `values` object (each carrying its own multi-KB caption/photo-brief text)
  // for every carousel on every dashboard load.
  const { data } = await supabase
    .from('carousels')
    .select('id, title, angle, format, updated_at, slides')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false })

  return <DashboardGrid carousels={(data as Pick<Carousel, 'id' | 'title' | 'angle' | 'format' | 'updated_at' | 'slides'>[]) ?? []} />
}
