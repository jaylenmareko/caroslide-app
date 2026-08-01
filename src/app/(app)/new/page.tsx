import Link from 'next/link'
import { getCarouselLimitStatus } from '@/backend/lib/actions'
import NewCarouselWizard from '@/frontend/components/NewCarouselWizard'

export default async function NewCarouselPage(props: PageProps<'/new'>) {
  const { topic } = await props.searchParams
  const initialBrief = typeof topic === 'string' ? topic : undefined

  // Proactive gate -- catches an exhausted free/paid account before they sink time into the
  // whole wizard, rather than only after they click Generate on the last step. The atomic RPC
  // in createCarousel is still the real enforcement; this is a UI courtesy check only.
  const { atLimit, message } = await getCarouselLimitStatus()
  if (atLimit) {
    return (
      <section className="new-section wrap">
        <h1>You&apos;re out of carousels</h1>
        <p className="lede">{message}</p>
        <Link href="/settings" className="settings-save">
          Go to Settings
        </Link>
      </section>
    )
  }

  return <NewCarouselWizard initialBrief={initialBrief} />
}
