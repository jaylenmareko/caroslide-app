import { createClient } from '@/lib/supabase/server'
import NewCarouselWizard from '@/components/NewCarouselWizard'
import type { BrandKit } from '@/lib/types'

export default async function NewCarouselPage(props: PageProps<'/new'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: brandKit } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { topic } = await props.searchParams
  const initialBrief = typeof topic === 'string' ? topic : undefined

  return <NewCarouselWizard existingBrandKit={brandKit as BrandKit | null} initialBrief={initialBrief} />
}
