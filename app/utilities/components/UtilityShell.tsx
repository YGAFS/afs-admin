'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const INNER_NAV = [
  { href: '/utilities/overview',  label: 'Overview' },
  { href: '/utilities/bills',     label: 'Utility Bills' },
  { href: '/utilities/vendors',   label: 'Vendors' },
  { href: '/utilities/locations', label: 'Contracts' },
]

export default function UtilityShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Utility &amp; Vendor Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Overview of utility bills and vendor information across all companies and locations.
          </p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Download Report
          </button>
          <button className="relative p-2 text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Utility Bill
          </button>
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {children}
      </div>
    </div>
  )
}
