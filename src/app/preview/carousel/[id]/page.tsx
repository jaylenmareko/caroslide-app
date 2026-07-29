import Sidebar from '@/frontend/components/Sidebar'
import Viewer from '@/frontend/components/Viewer'
import type { Carousel } from '@/backend/lib/types'
import { blockInProduction } from '@/backend/lib/preview-guard'

const now = new Date().toISOString()

const MOCK: Carousel = {
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
  created_at: now,
  updated_at: now,
}

export default function PreviewCarouselPage() {
  blockInProduction()
  return (
    <div className="app-shell">
      <Sidebar name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main className="app-main">
        <Viewer carousel={MOCK} />
      </main>
    </div>
  )
}
