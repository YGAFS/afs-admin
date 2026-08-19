'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { useAuth, type Role } from '../providers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const NAV: { href: string; label: { en: string; ko: string }; roles: Role[] }[] = [
  { href: '/', label: { en: 'Dashboard', ko: '대시보드' }, roles: ['requester', 'purchasing', 'operations', 'bookkeeping', 'admin'] },
  { href: '/requests/new', label: { en: 'New Request', ko: '새 요청 작성' }, roles: ['requester', 'purchasing', 'admin'] },
  { href: '/requests', label: { en: 'Purchase Requests', ko: '구매 요청' }, roles: ['requester', 'purchasing', 'operations', 'admin'] },
  { href: '/bookkeeping', label: { en: 'Bookkeeping Queue', ko: '경리 대기' }, roles: ['bookkeeping', 'admin'] },
  { href: '/admin', label: { en: 'Admin', ko: '관리자' }, roles: ['admin'] },
]

const ROLE_LABEL: Record<Role, { en: string; ko: string }> = {
  requester: { en: 'Requester', ko: '요청자' },
  purchasing: { en: 'Purchasing', ko: '구매 담당' },
  operations: { en: 'Operations', ko: '운영/실행' },
  bookkeeping: { en: 'Bookkeeping', ko: '경리' },
  admin: { en: 'Admin', ko: '관리자' },
}

export default function Shell({ role }: { role: Role }) {
  const path = usePathname()
  const router = useRouter()
  const { user, locale } = useAuth()
  const visibleNav = NAV.filter(n => n.roles.includes(role))

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  function isActive(href: string) {
    if (href === '/') return path === '/'
    if (href === '/requests/new') return path === '/requests/new'
    if (href === '/requests') return path === '/requests' || /^\/requests\/[^/]+$/.test(path)
    return path === href || path.startsWith(href + '/')
  }

  return (
    <aside className="w-56 shrink-0 h-screen flex flex-col bg-white border-r border-line-soft overflow-hidden">
      <div className="px-4 py-4 border-b border-line-soft">
        <div className="w-7 h-7 bg-ink rounded-md flex items-center justify-center mb-1">
          <span className="text-white text-xs font-bold">A</span>
        </div>
        <div className="font-bold text-sm text-ink">AFS Warehousing</div>
        <div className="text-xs text-ink-faint">{ROLE_LABEL[role][locale]}</div>
      </div>

      <nav className="px-2 py-3 flex-1 space-y-0.5">
        {visibleNav.map(({ href, label }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-ink text-white' : 'text-ink-muted hover:bg-pill hover:text-ink'
              }`}
            >
              {label[locale]}
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
          {locale === 'ko' ? '로그아웃' : 'Log out'}
        </button>
      </div>
    </aside>
  )
}
