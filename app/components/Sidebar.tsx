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

// ── Utility sidebar ───────────────────────────────────────────────────────────

interface CompanyNode {
  id: string
  label: string
  tag: string  // e.g. "(CA)"
  locations: string[]
}

const UTILITY_COMPANIES: CompanyNode[] = [
  {
    id: 'afs',
    label: 'AFS Transco',
    tag: '(CA)',
    locations: ['Surrey Head Office', 'Vancouver Warehouse', 'Calgary Warehouse'],
  },
  {
    id: 'tnt',
    label: 'TNT',
    tag: '(ON)',
    locations: ['Toronto DC', 'Mississauga WH', 'Ottawa WH'],
  },
  {
    id: 'zfs',
    label: 'ZFS Trans Co',
    tag: '(US)',
    locations: ['Fontana DC', 'Ontario DC'],
  },
]

const UTILITY_NAV = [
  { href: '/utilities/overview',   label: 'Overview',      icon: HomeIcon },
  { href: '/utilities/bills',      label: 'Utility Bills', icon: FileIcon },
  { href: '/utilities/vendors',    label: 'Vendors',       icon: BuildingIcon },
  { href: '/utilities/calendar',   label: 'Calendar',      icon: CalendarIcon },
  { href: '/utilities/reports',    label: 'Reports',       icon: ChartIcon },
  { href: '/utilities/settings',   label: 'Settings',      icon: GearIcon },
]

function HomeIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  )
}
function FileIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  )
}
function BuildingIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
    </svg>
  )
}
function CalendarIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
    </svg>
  )
}
function ChartIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  )
}
function FolderIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}
function BellIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
    </svg>
  )
}
function GearIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  )
}
function ChevronIcon({ down }: { down: boolean }) {
  return (
    <svg className={`w-3 h-3 transition-transform ${down ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  )
}

function UtilitySidebar() {
  const path = usePathname()
  const [expanded, setExpanded] = useState<string[]>(['zfs'])
  const [selectedLocation, setSelectedLocation] = useState<string | null>('Fontana DC')
  const [locationSearch, setLocationSearch] = useState('')

  function toggle(id: string) {
    setExpanded(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  }

  return (
    <aside className="w-56 shrink-0 h-screen flex flex-col bg-white border-r border-gray-200 overflow-hidden">

      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
            <span className="text-white text-xs font-bold">AFS</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-2 py-3 border-b border-gray-100 space-y-0.5">
        {UTILITY_NAV.map(({ href, label, icon: Icon, badge }) => {
          const active = path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className={active ? 'text-blue-600' : 'text-gray-400'}>
                <Icon />
              </span>
              <span className="flex-1">{label}</span>
              {badge != null && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Company / Location */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <p className="px-2 mb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Company / Location
        </p>

        {/* All Companies dropdown-style button */}
        <button className="w-full flex items-center justify-between px-3 py-2 mb-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 transition-colors">
          <span>All Companies</span>
          <ChevronIcon down={true} />
        </button>

        {/* Location search */}
        <div className="relative mb-2">
          <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            placeholder="Search location..."
            value={locationSearch}
            onChange={e => setLocationSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Company tree */}
        <div className="space-y-0.5">
          {UTILITY_COMPANIES.map(co => {
            const isOpen = expanded.includes(co.id)
            const filteredLocs = locationSearch
              ? co.locations.filter(l => l.toLowerCase().includes(locationSearch.toLowerCase()))
              : co.locations
            if (locationSearch && filteredLocs.length === 0) return null
            return (
              <div key={co.id}>
                <button
                  onClick={() => toggle(co.id)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors w-full text-left"
                >
                  <ChevronIcon down={isOpen} />
                  <span className="font-medium text-xs">{co.label}</span>
                  <span className="text-xs text-gray-400">{co.tag}</span>
                </button>

                {isOpen && (
                  <div className="ml-4 mt-0.5 space-y-0.5">
                    {filteredLocs.map(loc => {
                      const sel = selectedLocation === loc
                      return (
                        <button
                          key={loc}
                          onClick={() => setSelectedLocation(loc)}
                          className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-xs text-left transition-colors ${
                            sel
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                          }`}
                        >
                          <span className="text-gray-300">›</span>
                          <span>{loc}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </aside>
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

  // ── Utility: white light sidebar ──────────────────────────────────────────
  if (isUtility) {
    return <UtilitySidebar />
  }

  // ── Default: dark sidebar ─────────────────────────────────────────────────
  return (
    <aside className={`flex flex-col bg-gray-900 text-white transition-all duration-200 ${open ? 'w-52' : 'w-14'} shrink-0 h-screen sticky top-0`}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-700">
        {open && (
          <span className="font-bold text-sm tracking-wide text-gray-100">
            {t('sidebar.title', locale)}
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
