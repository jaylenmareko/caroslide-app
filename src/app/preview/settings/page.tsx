import Sidebar from '@/components/Sidebar'
import SettingsForm from '@/components/SettingsForm'

export default function PreviewSettingsPage() {
  return (
    <div className="app-shell">
      <Sidebar name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main className="app-main">
        <SettingsForm
          name="Jaylen Davis"
          email="jaylen@caroslide.com"
          brandKit={{
            user_id: 'mock',
            colors: ['#5B7A5E', '#F1E6D2', '#16130f'],
            logo_url: null,
            voice_description: 'Cream + forest-green earth tones. Minimal, confident, a little playful — never corporate-stiff.',
            font: 'Inter Tight',
            updated_at: new Date().toISOString(),
          }}
        />
      </main>
    </div>
  )
}
