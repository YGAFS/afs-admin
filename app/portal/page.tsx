'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { employeeSlug, portalFetch } from '@/lib/employeePortal'

export default function PortalEntryPage() {
  const router = useRouter()
  useEffect(() => { portalFetch('/api/employee-portal/me').then(async r => { if (r.status === 401 || r.status === 403) { router.replace('/portal/login?next=/portal'); return } if (r.ok) router.replace('/portal/' + employeeSlug((await r.json()).employee.name)) }).catch(() => router.replace('/portal/login?next=/portal')) }, [router])
  return <div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading your portal…</div>
}
