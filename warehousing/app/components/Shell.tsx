'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { useAuth, type Role } from '../providers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: '/',             label: '대시보드',    roles: ['requester', 'purchasing', 'operations', 'bookkeeping', 'admin'] },
  { href: '/requests/new', label: '새 요청 작성', roles: ['requester', 'purchasing', 'admin'] },
  { href: '/requests',     label: '구매 요청',    roles: ['requester', 'purchasing', 'operations', 'admin'] },
  { href: '/bookkeeping',  label: '경리 대기',    roles: ['bookkeeping', 'admin'] },
  { href: '/admin',        label: '관리자',       roles: ['admin'] },
]

const ROLE_LABEL: Record<Role, string> = {
  requester: '요청자',
  purchasing: '구매 담당',
  operations: '운영/실행',
  bookkeeping: '경리',
  admin: '관리자',
}

export default function Shell({ role }: { role: Role }) {
  const path = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const visibleNav = NAV.filter(n => n.roles.includes(role))

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <aside className="w-56 shrink-0 h-screen flex flex-col bg-white border-r border-line-soft overflow-hidden">
      <div className="px-4 py-4 border-b border-line-soft">
        <div className="w-7 h-7 bg-ink rounded-md flex items-center justify-center mb-1">
          <span className="text-white text-xs font-bold">A</span>
        </div>
        <div className="font-bold text-sm text-ink">AFS Warehousing</div>
        <div className="text-xs text-ink-faint">{ROLE_LABEL[role]}</div>
      </div>

      <nav className="px-2 py-3 flex-1 space-y-0.5">
        {visibleNav.map(({ href, label }) => {
          const active = path === href || (href !== '/' && path.startsWith(href + '/'))
          return (
            <Link
              key={href}
              href={href}
              className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-ink text-white' : 'text-ink-muted hover:bg-pill hover:text-ink'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-line-soft px-3 py-3 space-y-2">
        {user && (
          <div className="text-xs text-ink-faint truncate" title={user.email}>
            {user.email}
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-ink-muted hover:bg-pill hover:text-signal-neg transition-colors"
        >
          로그아웃
        </button>
      </div>
    </aside>
  )
}
