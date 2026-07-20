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
  { href: '/hr',        key: 'nav.hr',       icon: '📅' },
  { href: '/utilities', key: 'nav.utility',  icon: '💡' },
  { href: '/licenses',  key: 'nav.licenses', icon: '📋' },
  { href: '/assets',    key: 'nav.assets',   icon: '💻' },
  { href: '/supplies',  key: 'nav.supplies', icon: '☕' },
  { href: '/admin',     key: 'nav.admin',    icon: '⚙️' },
]

// ── Utility company / location tree ──────────────────────────────────────────

interface CompanyNode {
  id: string
  label: string
  locations: string[]
}

const UTILITY_COMPANIES: CompanyNode[] = [
  { id: 'afs', label: 'AFS Trans Co',              locations: ['Surrey Office'] },
  { id: 'tnt', label: 'TNT Express Lines',          locations: ['Cambridge', 'Biscayne', 'Pickering'] },
  { id: 'zfs', label: 'Zenith Fortio Services Inc.', locations: ['Fontana'] },
]

function UtilitySidebar({ open }: { open: boolean }) {
  const router = useRouter()
  const path   = usePathname()
  const [expanded, setExpanded] = useState<string[]>([]) // all collapsed by default

  function toggle(id: string) {
    setExpanded(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  }

  return (
    <>
      {/* Back button */}
      <div className={`px-2 pt-3 pb-2 border-b border-gray-700 ${open ? '' : 'flex justify-center'}`}>
        <button
          onClick={() => router.push('/hr')}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition-colors w-full"
          title="Back to main menu"
        >
          <span className="shrink-0 text-base">←</span>
          {open && <span className="truncate">Back</span>}
        </button>
      </div>

      {/* Company / Location tree */}
      {open && (
        <div className="flex-1 overflow-y-auto py-3 px-2">
          <p className="px-2 mb-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            Company / Location
          </p>

          {/* All Companies */}
          <Link
            href="/utilities/overview"
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors mb-0.5 ${
              path === '/utilities/overview' && !path.includes('?')
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <span className="text-base shrink-0">🏢</span>
            <span className="truncate">All Companies</span>
          </Link>

          {/* Company nodes */}
          <div className="space-y-0.5 mt-1">
            {UTILITY_COMPANIES.map(co => {
              const isOpen = expanded.includes(co.id)
              return (
                <div key={co.id}>
                  <button
                    onClick={() => toggle(co.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors w-full text-left"
                  >
                    <span className={`text-[10px] shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                    <span className="truncate text-xs">{co.label}</span>
                  </button>

                  {isOpen && (
                    <div className="ml-5 mt-0.5 space-y-0.5">
                      {co.locations.map(loc => (
                        <div
                          key={loc}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-gray-400 hover:bg-gray-700 hover:text-white transition-colors cursor-default"
                        >
                          <span className="text-gray-600">›</span>
                          <span className="truncate">{loc}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Collapsed: just show icon */}
      {!open && (
        <div className="flex-1 flex flex-col items-center py-3 gap-1">
          <Link href="/utilities/overview"
            className="p-2 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-base"
            title="Overview">🏢</Link>
          {UTILITY_COMPANIES.map(co => (
            <button key={co.id}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-700 hover:text-white transition-colors text-xs"
              title={co.label}
            >
              {co.id === 'afs' ? 'A' : co.id === 'tnt' ? 'T' : 'Z'}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export default function Sidebar() {
  const [open, setOpen] = useState(true)
  const path            = usePathname()
  const router          = useRouter()
  const { user }        = useAuth()
  const { locale }      = useLocale()

  const isUtility = path.startsWith('/utilities')

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <aside className={`flex flex-col bg-gray-900 text-white transition-all duration-200 ${open ? 'w-52' : 'w-14'} shrink-0 h-screen sticky top-0`}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-700">
        {open && (
          <span className="font-bold text-sm tracking-wide text-gray-100">
            {isUtility ? 'Utility Bills' : t('sidebar.title', locale)}
          </span>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white ml-auto"
          title={open ? t('sidebar.collapse', locale) : t('sidebar.expand', locale)}
        >
          {open ? '◀' : '☰'}
        </button>
      </div>

      {/* Content: utility mode vs normal nav */}
      {isUtility ? (
        <UtilitySidebar open={open} />
      ) : (
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
      )}

      {/* Bottom: user + logout */}
      <div className="border-t border-gray-700 px-2 py-3 space-y-2">
        {open && user && (
          <div className="px-1 text-xs text-gray-500 truncate" title={user.email}>
            {user.email}
          </div>
        )}
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-700 hover:text-red-400 transition-colors"
          title={t('auth.logout', locale)}>
          <span className="shrink-0">↩</span>
          {open && <span>{t('auth.logout', locale)}</span>}
        </button>
      </div>
    </aside>
  )
}
