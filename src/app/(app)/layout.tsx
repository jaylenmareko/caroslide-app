import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TopNav from '@/components/TopNav'

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
    <>
      <TopNav name={name} email={user.email!} />
      <main>{children}</main>
    </>
  )
}
