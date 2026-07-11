import TopNav from '@/components/TopNav'
import Viewer from '@/components/Viewer'
import type { Carousel } from '@/lib/types'

const now = new Date().toISOString()

const MOCK: Carousel = {
  id: 'mock-1',
  user_id: 'mock',
  title: 'Seed oil vs. tallow',
  angle: 'Value',
  format: 'Post',
  look: 'Bold Stat',
  brief: null,
  slides: [1, 2, 3, 4, 5].map((i) => ({ url: `/mock/wagyuvalue-${i}.jpg` })),
  reference_images: [],
  created_at: now,
  updated_at: now,
}

export default function PreviewCarouselPage() {
  return (
    <>
      <TopNav name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main>
        <Viewer carousel={MOCK} />
      </main>
    </>
  )
}
