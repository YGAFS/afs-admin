'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PortalPtoView, { PortalMessage } from '@/app/portal/components/PortalPtoView'
import { employeeSlug, getPortalSession, portalFetch, type PtoResponse } from '@/lib/employeePortal'

export default function MyPtoPage() {
  const router = useRouter()
  const [data, setData] = useState<PtoResponse | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [status, setStatus] = useState<'loading' | 'error' | 'forbidden'>('loading')
  const load = useCallback(async (selectedYear: number) => {
    setStatus('loading')
    const session = (await getPortalSession()).data.session
    if (!session) { router.replace('/portal/login'); return }
    const cacheKey = `afs_portal_pto:${session.user.id}:${selectedYear}`
    const response = await portalFetch(`/api/employee-portal/me/hr?year=${selectedYear}`)
    if (response.status === 401) { router.replace('/portal/login'); return }
    if (response.status === 403) {
      sessionStorage.removeItem(cacheKey)
      setData(null); setStatus('forbidden'); return
    }
    if (!response.ok) { setStatus('error'); return }
    const next = await response.json() as PtoResponse
    sessionStorage.setItem(cacheKey, JSON.stringify(next))
    setData(next); setStatus('loading')
  }, [router])
  useEffect(() => { load(year) }, [load, year])
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 3 }, (_, index) => currentYear - index)
  if (status === 'forbidden') return <PortalMessage title="Employee portal unavailable" body="Your session or employee Portal access is no longer active." />
  if (status === 'error') return <PortalMessage title="Unable to load your employee information." body="Please try again." action={() => load(year)} />
  if (!data) return <div className="mx-auto max-w-6xl p-6 md:p-10"><div className="h-8 w-48 animate-pulse rounded bg-line-soft" /><div className="mt-8 grid gap-5 md:grid-cols-2"><div className="h-48 animate-pulse rounded-3xl bg-white" /><div className="h-48 animate-pulse rounded-3xl bg-white" /></div></div>
  const canonical = employeeSlug(data.employee.name)
  if (typeof window !== 'undefined' && window.location.pathname.split('/')[2] !== canonical) router.replace(`/portal/${canonical}`)
  return <PortalPtoView data={data} year={year} years={years} onYearChange={setYear} />
}
