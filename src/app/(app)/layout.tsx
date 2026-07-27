import { redirect } from 'next/navigation'
import { createClient } from '@/backend/lib/supabase/server'
import Sidebar from '@/frontend/components/Sidebar'

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const name = (user.user_metadata?.name as string | undefined) || user.email!.split('@')[0]

  return (
    <div className="app-shell">
      <Sidebar name={name} email={user.email!} />
      <main className="app-main">{children}</main>
    </div>
  )
}
