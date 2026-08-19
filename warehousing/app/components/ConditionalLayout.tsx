'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Shell from './Shell'
import { useAuth } from '../providers'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, role } = useAuth()
  const pathname = usePathname()
  const router   = useRouter()
  const isLogin  = pathname === '/login' || pathname.startsWith('/auth/')

  useEffect(() => {
    if (!loading && !user && !isLogin) {
      router.replace('/login')
    }
  }, [user, loading, isLogin, router])

  // Login page — no shell, full screen
  if (isLogin) {
    return <div className="flex-1 overflow-auto">{children}</div>
  }

  // Auth check pending
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-faint text-sm">
        불러오는 중…
      </div>
    )
  }

  // Not authenticated → blank while redirect fires
  if (!user) return null

  // Signed in, but no role for this app — no fallback section to redirect
  // into (unlike HR's allowedSections[0]), so show an explicit access-needed
  // screen instead of silently blocking. `role` is only ever null while
  // `loading` is true (see providers.tsx), so this also narrows it to
  // `Role` for the render below without an unsafe cast.
  if (role === 'none' || role === null) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-2">
          <div className="text-ink font-semibold">아직 접근 권한이 없습니다</div>
          <p className="text-sm text-ink-muted">
            AFS Warehousing 이용 권한이 필요합니다. 관리자에게 문의해 주세요.
          </p>
          <p className="text-xs text-ink-faint">{user.email}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Shell role={role} />
      <main className="flex-1 overflow-auto">{children}</main>
    </>
  )
}
