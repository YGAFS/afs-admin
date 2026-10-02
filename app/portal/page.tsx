'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { employeeSlug, getPortalSession, portalFetch } from '@/lib/employeePortal'

export default function PortalEntryPage() {
  const router = useRouter()
  useEffect(() => { (async () => {
    const session = (await getPortalSession()).data.session
    if (!session) { router.replace('/portal/login?next=/portal'); return }
    const response = await portalFetch('/api/employee-portal/me')
    if (response.status === 401 || response.status === 403) { router.replace('/portal/login?next=/portal'); return }
    if (response.ok) router.replace('/portal/' + employeeSlug((await response.json()).employee.name))
  })().catch(() => router.replace('/portal/login?next=/portal')) }, [router])
  return <div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading your portal…</div>
}
