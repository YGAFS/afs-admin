'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/hr',       label: 'HR 근태 캘린더', icon: '📅' },
  { href: '/licenses', label: '구독 관리',      icon: '📋' },
  { href: '/assets',   label: 'IT 자산',        icon: '💻' },
  { href: '/supplies', label: 'Coffee Order',   icon: '☕' },
  { href: '/admin',    label: 'Admin',          icon: '⚙️' },
]

export default function Sidebar() {
  const [open, setOpen] = useState(true)
  const path = usePathname()

  return (
    <aside
      className={`flex flex-col bg-gray-900 text-white transition-all duration-200 ${open ? 'w-52' : 'w-14'} shrink-0 h-screen sticky top-0`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-700">
        {open && <span className="font-bold text-sm tracking-wide text-gray-100">AFS Admin</span>}
        <button
          onClick={() => setOpen(o => !o)}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white ml-auto"
          title={open ? '접기' : '펼치기'}
        >
          {open ? '◀' : '☰'}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 py-3 px-2 flex-1">
        {NAV.map(({ href, label, icon }) => {
          const active = path === href || path.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
              title={!open ? label : undefined}
            >
              <span className="text-base shrink-0">{icon}</span>
              {open && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
