// TEMPORARY — visual QA only, no auth/Supabase required. Delete once a real
// Supabase project is wired up and /dashboard can be checked directly.
import Link from 'next/link'
import DashboardGrid from '@/components/DashboardGrid'
import TopNav from '@/components/TopNav'
import type { Carousel } from '@/lib/types'

const now = new Date().toISOString()

const MOCK: Carousel[] = [
  {
    id: 'mock-1',
    user_id: 'mock',
    title: 'Seed oil vs. tallow',
    angle: 'Value',
    format: 'Post',
    look: 'Bold Stat',
    brief: null,
    slides: [1, 2, 3, 4, 5].map((i) => ({ url: `/mock/wagyuvalue-${i}.jpg` })),
    created_at: now,
    updated_at: now,
  },
  {
    id: 'mock-2',
    user_id: 'mock',
    title: "Dating apps weren't the problem",
    angle: 'Growth',
    format: 'Post',
    look: 'Plain Text',
    brief: null,
    slides: [1, 2, 3, 4, 5].map((i) => ({ url: `/mock/growth-${i}.jpg` })),
    created_at: now,
    updated_at: now,
  },
  {
    id: 'mock-3',
    user_id: 'mock',
    title: 'Tallow & clogged pores',
    angle: 'Education',
    format: 'Post',
    look: 'Circles + Photo',
    brief: null,
    slides: [1, 2, 3, 4, 5].map((i) => ({ url: `/mock/education-${i}.jpg` })),
    created_at: now,
    updated_at: now,
  },
]

export default function PreviewPage() {
  return (
    <>
      <TopNav name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main>
        <DashboardGrid carousels={MOCK} />
        <p style={{ textAlign: 'center', margin: '0 0 40px' }}>
          <Link href="/preview/new">→ preview wizard</Link> &nbsp;|&nbsp;{' '}
          <Link href="/preview/carousel/mock-1">→ preview viewer</Link> &nbsp;|&nbsp;{' '}
          <Link href="/preview/settings">→ preview settings</Link>
        </p>
      </main>
    </>
  )
}
