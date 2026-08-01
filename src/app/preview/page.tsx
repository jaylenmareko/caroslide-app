// TEMPORARY — visual QA only, no auth/Supabase required. Delete once a real
// Supabase project is wired up and /dashboard can be checked directly.
import Link from 'next/link'
import DashboardGrid from '@/frontend/components/DashboardGrid'
import Sidebar from '@/frontend/components/Sidebar'
import type { Carousel } from '@/backend/lib/types'
import { blockInProduction } from '@/backend/lib/preview-guard'

const now = new Date().toISOString()

const MOCK: Carousel[] = [
  {
    id: 'mock-1',
    user_id: 'mock',
    title: 'Seed oil vs. tallow',
    angle: 'Value',
    format: 'Post',
    look: 'Bold Stat',
    template_variant: null,
    brief: null,
    brand_colors: ['#5B7A5E', '#F1E6D2', '#16130f'],
    logo_url: null,
    font: 'Inter Tight',
    slides: [1, 2, 3, 4, 5].map((i) => ({ url: `/mock/wagyuvalue-${i}.jpg` })),
    reference_images: [],
    status: 'ready',
    error_message: null,
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
    template_variant: null,
    brief: null,
    brand_colors: ['#5B7A5E', '#F1E6D2', '#16130f'],
    logo_url: null,
    font: 'Inter Tight',
    slides: [1, 2, 3, 4, 5].map((i) => ({ url: `/mock/growth-${i}.jpg` })),
    reference_images: [],
    status: 'ready',
    error_message: null,
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
    template_variant: 'Classic',
    brief: null,
    brand_colors: ['#5B7A5E', '#F1E6D2', '#16130f'],
    logo_url: null,
    font: 'Inter Tight',
    slides: [1, 2, 3, 4, 5].map((i) => ({ url: `/mock/education-${i}.jpg` })),
    reference_images: [],
    status: 'ready',
    error_message: null,
    created_at: now,
    updated_at: now,
  },
]

export default function PreviewPage() {
  blockInProduction()
  return (
    <div className="app-shell">
      <Sidebar name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main className="app-main">
        <DashboardGrid carousels={MOCK} />
        <p style={{ textAlign: 'center', margin: '0 0 40px' }}>
          <Link href="/preview/new">→ preview wizard</Link> &nbsp;|&nbsp;{' '}
          <Link href="/preview/carousel/mock-1">→ preview viewer</Link> &nbsp;|&nbsp;{' '}
          <Link href="/preview/settings">→ preview settings</Link>
        </p>
      </main>
    </div>
  )
}
