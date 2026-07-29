import Sidebar from '@/frontend/components/Sidebar'
import NewCarouselWizard from '@/frontend/components/NewCarouselWizard'
import { blockInProduction } from '@/backend/lib/preview-guard'

export default function PreviewNewPage() {
  blockInProduction()
  return (
    <div className="app-shell">
      <Sidebar name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main className="app-main">
        <NewCarouselWizard existingBrandKit={null} />
      </main>
    </div>
  )
}
