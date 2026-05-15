'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import { useAuth } from '../providers'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const pathname = usePathname()
  const router   = useRouter()
  const isLogin  = pathname === '/login'

  useEffect(() => {
    if (!loading && !user && !isLogin) {
      router.replace('/login')
    }
  }, [user, loading, isLogin, router])

  // Login page — no sidebar, full screen
  if (isLogin) {
    return <div className="flex-1 overflow-auto">{children}</div>
  }

  // Auth check pending
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Loading…
      </div>
    )
  }

  // Not authenticated → blank while redirect fires
  if (!user) return null

  // Authenticated — normal layout
  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </>
  )
}
