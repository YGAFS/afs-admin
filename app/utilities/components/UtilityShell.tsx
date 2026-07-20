'use client'

import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useState, Suspense } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type CompanyId = 'all' | 'afs' | 'tnt' | 'zfs'

interface Location { id: string; label: string }
interface CompanyNode {
  id: CompanyId
  label: string
  locations: Location[]
}

const COMPANIES: CompanyNode[] = [
  { id: 'afs', label: 'AFS Transco (CA)',   locations: [{ id: 'afs-surrey',   label: 'Surrey Head Office' }, { id: 'afs-van', label: 'Vancouver Warehouse' }, { id: 'afs-cal', label: 'Calgary Warehouse' }] },
  { id: 'tnt', label: 'TNT (ON)',            locations: [{ id: 'tnt-tor',      label: 'Toronto DC' },         { id: 'tnt-mis', label: 'Mississauga WH' },       { id: 'tnt-ott', label: 'Ottawa WH' }] },
  { id: 'zfs', label: 'ZFS Trans Co (US)',   locations: [{ id: 'zfs-fontana',  label: 'Fontana DC' },         { id: 'zfs-ont', label: 'Ontario DC' }] },
]

const INNER_NAV = [
  { href: '/utilities/overview',   label: 'Overview' },
  { href: '/utilities/locations',  label: 'Locations' },
  { href: '/utilities/vendors',    label: 'Vendors' },
  { href: '/utilities/bills',      label: 'Bills' },
  { href: '/utilities/documents',  label: 'Documents' },
]

// ── Company sidebar (reads searchParams, must be wrapped in Suspense) ─────────

function CompanySidebarInner({ pathname }: { pathname: string }) {
  const searchParams  = useSearchParams()
  const router        = useRouter()
  const activeCompany = (searchParams.get('company') ?? 'all') as CompanyId
  const [expanded, setExpanded] = useState<CompanyId[]>(['afs', 'tnt', 'zfs'])

  function buildHref(co: CompanyId) {
    const params = new URLSearchParams(searchParams.toString())
    if (co === 'all') params.delete('company')
    else params.set('company', co)
    return `${pathname}?${params.toString()}`
  }

  function toggle(co: CompanyId) {
    setExpanded(e => e.includes(co) ? e.filter(x => x !== co) : [...e, co])
  }

  return (
    <div className="p-2 space-y-0.5">
      {/* All Companies */}
      <Link
        href={buildHref('all')}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors w-full ${
          activeCompany === 'all' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        🏢 All Companies
      </Link>

      {/* Company nodes */}
      {COMPANIES.map(co => {
        const isOpen   = expanded.includes(co.id)
        const isActive = activeCompany === co.id

        return (
          <div key={co.id}>
            <div className="flex items-center">
              <Link
                href={buildHref(co.id)}
                className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className={`text-xs ${isActive ? 'text-blue-500' : 'text-gray-400'}`}>▼</span>
                {co.label}
              </Link>
              <button
                onClick={() => toggle(co.id)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
              >
                <span className="text-xs">{isOpen ? '−' : '+'}</span>
              </button>
            </div>

            {isOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5">
                {co.locations.map(loc => (
                  <Link
                    key={loc.id}
                    href={buildHref(co.id)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                  >
                    › {loc.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Shell ────────────────────────────────────────────────────────────────────

export default function UtilityShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Company / Location sidebar ── */}
      <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Company / Location</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Suspense fallback={
            <div className="p-3 space-y-1">
              {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          }>
            <CompanySidebarInner pathname={pathname} />
          </Suspense>
        </div>
      </aside>

      {/* ── Right: Header + Inner nav + Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Page header */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Utility & Vendor Management</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Overview of utility bills and vendor information across all companies and locations.
            </p>
          </div>
        </div>

        {/* Inner nav tabs */}
        <div className="bg-white border-b border-gray-200 px-6 flex">
          {INNER_NAV.map(nav => {
            const active = pathname.startsWith(nav.href)
            return (
              <Link
                key={nav.href}
                href={nav.href}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {nav.label}
              </Link>
            )
          })}
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-auto bg-gray-50">
          {children}
        </div>
      </div>
    </div>
  )
}
