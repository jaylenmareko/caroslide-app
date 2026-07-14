import Sidebar from '@/components/Sidebar'
import NewCarouselWizard from '@/components/NewCarouselWizard'

export default function PreviewNewPage() {
  return (
    <div className="app-shell">
      <Sidebar name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main className="app-main">
        <NewCarouselWizard hasBrandKit={false} />
      </main>
    </div>
  )
}
