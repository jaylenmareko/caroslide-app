import Sidebar from '@/frontend/components/Sidebar'
import NewCarouselWizard from '@/frontend/components/NewCarouselWizard'

export default function PreviewNewPage() {
  return (
    <div className="app-shell">
      <Sidebar name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main className="app-main">
        <NewCarouselWizard existingBrandKit={null} />
      </main>
    </div>
  )
}
