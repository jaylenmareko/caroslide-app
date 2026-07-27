import { redirect } from 'next/navigation'
import { createClient } from '@/backend/lib/supabase/server'
import MarketingPage from '@/frontend/components/MarketingPage'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return <MarketingPage />
}
