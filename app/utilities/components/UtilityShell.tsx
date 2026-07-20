'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const INNER_NAV = [
  { href: '/utilities/overview',   label: 'Overview' },
  { href: '/utilities/locations',  label: 'Locations' },
  { href: '/utilities/vendors',    label: 'Vendors' },
  { href: '/utilities/bills',      label: 'Bills' },
]

export default function UtilityShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">Utility & Vendor Management</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Overview of utility bills and vendor information across all companies and locations.
        </p>
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {children}
      </div>
    </div>
  )
}
