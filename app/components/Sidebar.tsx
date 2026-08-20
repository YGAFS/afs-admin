'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { useAuth, useLocale } from '../providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

type NavItem = {
  href: string
  key: string
  icon: () => React.ReactElement
}

const NAV: NavItem[] = [
  { href: '/hr',        key: 'nav.hr',       icon: CalendarIcon },
  { href: '/utilities', key: 'nav.utility',  icon: BoltIcon },
  { href: '/licenses',  key: 'nav.licenses', icon: FileIcon },
  { href: '/assets',    key: 'nav.assets',   icon: FolderIcon },
  { href: '/supplies',  key: 'nav.supplies', icon: CupIcon },
  { href: '/admin',     key: 'nav.admin',    icon: GearIcon },
]

const UTILITY_NAV: { href: string; label: string; icon: () => React.ReactElement; badge?: number }[] = [
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

function GearIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M11 0L3 11h5l-1 9 8-11h-5l1-9z" />
    </svg>
  )
}

function CupIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M3 4a1 1 0 011-1h9a1 1 0 011 1v2h2a2 2 0 010 4h-1.126A5.002 5.002 0 0110 15H7a5 5 0 01-4.874-4H2a2 2 0 010-4h1V4zm11 3v1a3 3 0 002-3h-2v2zM5 17a1 1 0 100 2h7a1 1 0 100-2H5z" />
    </svg>
  )
}

function SidebarShell({
  children,
  canSeeHr = false,
}: {
  children: React.ReactNode
  canSeeHr?: boolean
}) {
  return (
    <aside className="w-56 shrink-0 h-screen flex flex-col bg-white border-r border-line overflow-hidden">
      <div className="px-4 py-4 border-b border-line-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-ink flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold">AFS</span>
            </div>
            <span className="font-semibold text-sm text-ink truncate">AFS Admin</span>
          </div>
          {canSeeHr && (
            <Link
              href="/hr"
              title="Back to HR Dashboard"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-faint hover:bg-pill hover:text-ink transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15l-5-5 5-5M8 10h9" />
              </svg>
            </Link>
          )}
        </div>
      </div>
      {children}
    </aside>
  )
}

function UtilitySidebar() {
  const path = usePathname()
  const { allowedSections } = useAuth()
  const canSeeHr = !allowedSections || allowedSections.includes('hr')

  return (
    <SidebarShell canSeeHr={canSeeHr}>
      <nav className="px-2 py-3 border-b border-line-soft space-y-1">
        {UTILITY_NAV.map(({ href, label, icon: Icon, badge }) => {
          const active = path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active
                  ? 'bg-pill text-ink'
                  : 'text-ink-muted hover:bg-pill hover:text-ink'
              }`}
            >
              <span className={active ? 'text-ink' : 'text-ink-faint'}>
                <Icon />
              </span>
              <span className="flex-1">{label}</span>
              {badge != null && (
                <span className="bg-signal-neg text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
    </SidebarShell>
  )
}

export default function Sidebar() {
  const [open, setOpen] = useState(true)
  const path = usePathname()
  const router = useRouter()
  const { user, allowedSections } = useAuth()
  const { locale } = useLocale()

  const isUtility = path.startsWith('/utilities')
  const visibleNav = allowedSections
    ? NAV.filter(n => allowedSections.includes(n.href.slice(1)))
    : NAV

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (isUtility) return <UtilitySidebar />

  return (
    <aside className={`flex flex-col bg-[#111318] text-white border-r border-white/6 transition-all duration-200 ${open ? 'w-56' : 'w-20'} shrink-0 h-screen sticky top-0`}>
      <div className="px-4 py-4 border-b border-white/8">
        <div className="flex items-center justify-between gap-2">
          {open ? (
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center shrink-0 ring-1 ring-white/8">
                <span className="text-white text-xs font-bold">AFS</span>
              </div>
              <span className="font-semibold text-sm text-white truncate">{t('sidebar.title', locale)}</span>
            </div>
          ) : (
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center shrink-0 ring-1 ring-white/8">
              <span className="text-white text-xs font-bold">AFS</span>
            </div>
          )}
          <button
            onClick={() => setOpen(o => !o)}
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-white/6 hover:bg-white/12 text-white/60 hover:text-white transition-colors"
            title={open ? t('sidebar.collapse', locale) : t('sidebar.expand', locale)}
          >
            {open ? '‹' : '›'}
          </button>
        </div>
      </div>

      <nav className="flex flex-col gap-1 py-3 px-2 flex-1">
        {visibleNav.map(({ href, key, icon: Icon }) => {
          const active = path === href || path.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-[#111318] shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                  : 'text-white/64 hover:bg-white/6 hover:text-white'
              }`}
              title={!open ? t(key, locale) : undefined}
            >
              <span className={`shrink-0 ${active ? 'text-[#111318]' : 'text-white/50'}`}>
                <Icon />
              </span>
              {open && <span className="truncate">{t(key, locale)}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/8 px-3 py-3 space-y-2">
        {open && user && (
          <div className="px-1 text-xs text-white/42 truncate" title={user.email}>
            {user.email}
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-sm text-white/64 hover:bg-white/6 hover:text-white transition-colors"
          title={t('auth.logout', locale)}
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 6l-4 4 4 4" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 10h9" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4h2a2 2 0 012 2v8a2 2 0 01-2 2h-2" />
          </svg>
          {open && <span>{t('auth.logout', locale)}</span>}
        </button>
      </div>
    </aside>
  )
}
