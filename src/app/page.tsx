import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/backend/lib/supabase/server'
import MarketingPage from '@/frontend/components/MarketingPage'

// SEO audit fix (2026-08-01): homepage-specific canonical (was missing site-wide, confirmed live)
// and a real og:image -- a genuine Caroslide-generated carousel cover (the "Odyssey" example also
// used in the marquee, not a stock photo or a placeholder), so a shared link actually shows what
// the product produces rather than rendering as a bare text link.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: {
    images: [
      {
        url: 'https://egpbdcgaydmlfthqlkvb.supabase.co/storage/v1/object/public/carousel-slides/55e27047-6a04-4e3b-95ce-d265f19da75f/14f9778d-6399-4bd6-846e-55d972086dd8/slide-1.jpg',
        width: 1080,
        height: 1350,
      },
    ],
  },
}

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
