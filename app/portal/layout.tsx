'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { portalSupabase } from '@/lib/employeePortal'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const router = useRouter(); const [menu, setMenu] = useState(false)
  if (path === '/portal/login') return <>{children}</>
  const slug = path.split('/')[2]
  const home = slug ? `/portal/${slug}` : '/portal'
  async function logout() { await portalSupabase.auth.signOut(); router.replace('/portal/login') }
  return <div className="min-h-screen bg-[#f7f8fa] text-ink md:flex">
    <button aria-label="Open menu" onClick={() => setMenu(!menu)} className="fixed right-4 top-4 z-30 rounded-xl bg-white p-3 shadow md:hidden">☰</button>
    <aside className={`${menu ? 'block' : 'hidden'} fixed inset-y-0 left-0 z-20 w-72 border-r border-line-soft bg-white p-6 md:static md:block md:w-64 md:shrink-0`}>
      <Link href={home} className="mb-12 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink text-xs font-bold text-white">AFS</span><span className="text-sm font-semibold">Employee Portal</span></Link>
      <p className="mb-3 text-[11px] font-bold tracking-[.18em] text-ink-faint">MY LEAVE</p>
      <nav className="space-y-1">
        <Link href={home} className={`block rounded-xl px-4 py-3 text-sm font-medium ${path === home ? 'bg-ink text-white' : 'text-ink-muted hover:bg-pill'}`}>My PTO</Link>
        <Link href={`${home}/policy`} className={`block rounded-xl px-4 py-3 text-sm font-medium ${path.endsWith('/policy') ? 'bg-ink text-white' : 'text-ink-muted hover:bg-pill'}`}>PTO Policy</Link>
      </nav>
      <button onClick={logout} className="absolute bottom-6 left-6 flex items-center gap-2 rounded-xl px-2 py-2 text-sm text-ink-muted transition-colors hover:bg-pill hover:text-ink">
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 6l-4 4 4 4M4 10h9M12 4h2a2 2 0 012 2v8a2 2 0 01-2 2h-2" /></svg>
        <span>Logout</span>
      </button>
    </aside>
    <main className="min-w-0 flex-1">{children}</main>
  </div>
}
