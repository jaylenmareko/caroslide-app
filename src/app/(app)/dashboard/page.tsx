import { createClient } from '@/lib/supabase/server'
import DashboardGrid from '@/components/DashboardGrid'
import type { Carousel } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('carousels')
    .select('*')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false })

  return <DashboardGrid carousels={(data as Carousel[]) ?? []} />
}
