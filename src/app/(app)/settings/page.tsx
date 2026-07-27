import { createClient } from '@/backend/lib/supabase/server'
import SettingsForm from '@/frontend/components/SettingsForm'
import type { BrandKit } from '@/backend/lib/types'
import type { Subscription } from '@/backend/lib/stripe'

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

  // Balance is always sum(delta), never a stored counter -- see migration 009.
  const { data: ledgerRows } = await supabase.from('credit_ledger').select('delta').eq('user_id', user!.id)
  const creditBalance = (ledgerRows ?? []).reduce((sum, row) => sum + row.delta, 0)

  const name = (user!.user_metadata?.name as string | undefined) || user!.email!.split('@')[0]

  return (
    <SettingsForm
      name={name}
      email={user!.email!}
      brandKit={brandKit as BrandKit | null}
      subscription={subscription as Subscription | null}
      creditBalance={creditBalance}
    />
  )
}
