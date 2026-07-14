import { createClient } from '@/lib/supabase/server'
import NewCarouselWizard from '@/components/NewCarouselWizard'

export default async function NewCarouselPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: brandKit } = await supabase
    .from('brand_kits')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  return <NewCarouselWizard hasBrandKit={!!brandKit} />
}
