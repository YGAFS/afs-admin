'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import { useAuth } from '../providers'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, allowedSections } = useAuth()
  const pathname = usePathname()
  const router   = useRouter()
  const isLogin  = pathname === '/login' || pathname.startsWith('/auth/')
  const isPortal = pathname === '/portal' || pathname.startsWith('/portal/')
  const section  = pathname.split('/')[1] ?? ''

  useEffect(() => {
    if (!loading && !user && !isLogin && !isPortal) {
      router.replace('/login')
      return
    }
    if (!loading && user && !isLogin && !isPortal && allowedSections && !allowedSections.includes(section)) {
      router.replace(`/${allowedSections[0]}`)
    }
  }, [user, loading, isLogin, allowedSections, section, router])

  // Login page — no sidebar, full screen
  if (isLogin || isPortal) {
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

  // Section not allowed for this user → blank while redirect fires
  if (allowedSections && !allowedSections.includes(section)) return null

  // Authenticated — normal layout
  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </>
  )
}
