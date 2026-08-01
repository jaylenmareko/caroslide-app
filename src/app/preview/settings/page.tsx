import Sidebar from '@/frontend/components/Sidebar'
import SettingsForm from '@/frontend/components/SettingsForm'
import { blockInProduction } from '@/backend/lib/preview-guard'

export default function PreviewSettingsPage() {
  blockInProduction()
  return (
    <div className="app-shell">
      <Sidebar name="Jaylen Davis" email="jaylen@caroslide.com" />
      <main className="app-main">
        <SettingsForm
          name="Jaylen Davis"
          email="jaylen@caroslide.com"
          subscription={null}
          creditBalance={0}
        />
      </main>
    </div>
  )
}
