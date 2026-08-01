import { createClient } from '@/backend/lib/supabase/server'
import DashboardGrid from '@/frontend/components/DashboardGrid'
import type { Carousel } from '@/backend/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Narrowed from select('*') -- the dashboard grid only ever renders id/title/updated_at and
  // slides[0].url, but '*' was pulling reference_images, brand_colors, brief, and every slide's
  // full `values` object (each carrying its own multi-KB caption/photo-brief text) for every
  // carousel on every dashboard load. angle/format dropped too (2026-07-31) once their card pills
  // were removed -- nothing else on this page reads them.
  const { data } = await supabase
    .from('carousels')
    .select('id, title, updated_at, slides')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false })

  return <DashboardGrid carousels={(data as Pick<Carousel, 'id' | 'title' | 'updated_at' | 'slides'>[]) ?? []} />
}
