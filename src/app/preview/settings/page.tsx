import TopNav from '@/components/TopNav'
import SettingsForm from '@/components/SettingsForm'

export default function PreviewSettingsPage() {
  return (
    <>
      <TopNav name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main>
        <SettingsForm
          name="Jaylen Davis"
          email="jaylen@caroslide.com"
          brandKit={{
            user_id: 'mock',
            colors: ['#5B7A5E', '#F1E6D2', '#16130f'],
            logo_url: null,
            voice_description: 'Cream + forest-green earth tones. Minimal, confident, a little playful — never corporate-stiff.',
            updated_at: new Date().toISOString(),
          }}
        />
      </main>
    </>
  )
}
