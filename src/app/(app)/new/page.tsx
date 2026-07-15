import { createClient } from '@/lib/supabase/server'
import NewCarouselWizard from '@/components/NewCarouselWizard'
import type { BrandKit } from '@/lib/types'

export default async function NewCarouselPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: brandKit } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', user!.id)
    .maybeSingle()

  return <NewCarouselWizard existingBrandKit={brandKit as BrandKit | null} />
}
