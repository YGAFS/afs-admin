'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { useAuth, useLocale } from '../providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const NAV = [
  { href: '/hr',       key: 'nav.hr',       icon: '📅' },
  { href: '/utility',  key: 'nav.utility',  icon: '💡' },
  { href: '/licenses', key: 'nav.licenses',  icon: '📋' },
  { href: '/assets',   key: 'nav.assets',    icon: '💻' },
  { href: '/supplies', key: 'nav.supplies',  icon: '☕' },
  { href: '/admin',    key: 'nav.admin',     icon: '⚙️' },
]

export default function Sidebar() {
  const [open, setOpen] = useState(true)
  const path            = usePathname()
  const router          = useRouter()
  const { user }        = useAuth()
  const { locale, setLocale } = useLocale()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <aside className={`flex flex-col bg-gray-900 text-white transition-all duration-200 ${open ? 'w-52' : 'w-14'} shrink-0 h-screen sticky top-0`}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-700">
        {open && <span className="font-bold text-sm tracking-wide text-gray-100">{t('sidebar.title', locale)}</span>}
        <button
          onClick={() => setOpen(o => !o)}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white ml-auto"
          title={open ? t('sidebar.collapse', locale) : t('sidebar.expand', locale)}>
          {open ? '◀' : '☰'}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 py-3 px-2 flex-1">
        {NAV.map(({ href, key, icon }) => {
          const active = path === href || path.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
              title={!open ? t(key, locale) : undefined}>
              <span className="text-base shrink-0">{icon}</span>
              {open && <span className="truncate">{t(key, locale)}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Bottom: user + logout */}
      <div className="border-t border-gray-700 px-2 py-3 space-y-2">
        {/* User email */}
        {open && user && (
          <div className="px-1 text-xs text-gray-500 truncate" title={user.email}>
            {user.email}
          </div>
        )}

        {/* Logout */}
        <button onClick={handleLogout}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-700 hover:text-red-400 transition-colors`}
          title={t('auth.logout', locale)}>
          <span className="shrink-0">↩</span>
          {open && <span>{t('auth.logout', locale)}</span>}
        </button>
      </div>
    </aside>
  )
}
