import { createClient } from '@/lib/supabase/server'
import SettingsForm from '@/components/SettingsForm'
import type { BrandKit } from '@/lib/types'
import type { Subscription } from '@/lib/stripe'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: brandKit } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end')
    .eq('user_id', user!.id)
    .maybeSingle()

  const name = (user!.user_metadata?.name as string | undefined) || user!.email!.split('@')[0]

  return (
    <SettingsForm
      name={name}
      email={user!.email!}
      brandKit={brandKit as BrandKit | null}
      subscription={subscription as Subscription | null}
    />
  )
}
