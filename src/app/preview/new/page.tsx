import TopNav from '@/components/TopNav'
import NewCarouselWizard from '@/components/NewCarouselWizard'

export default function PreviewNewPage() {
  return (
    <>
      <TopNav name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main>
        <NewCarouselWizard />
      </main>
    </>
  )
}
