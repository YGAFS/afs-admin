'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import PortalPtoView, { PortalMessage } from '@/app/portal/components/PortalPtoView'
import type { PtoResponse } from '@/lib/employeePortal'
import { supabase } from '@/lib/supabase'

export default function AdminEmployeePortalPage() {
  const { employeeId } = useParams<{ employeeId: string }>()
  const [year, setYear] = useState(new Date().getFullYear())
  const [data, setData] = useState<PtoResponse | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    const session = (await supabase.auth.getSession()).data.session
    if (!session) { setError('Sign in as super administrator.'); return }
    const response = await fetch(`/api/admin/employees/${employeeId}/portal?year=${year}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
    })
    if (!response.ok) { setError(response.status === 404 ? 'Admin View is not enabled or the employee was not found.' : 'Unable to load Admin View.'); return }
    setData(await response.json() as PtoResponse)
  }, [employeeId, year])
  useEffect(() => { load() }, [load])
  if (error) return <PortalMessage title="Admin View unavailable" body={error} action={load} />
  if (!data) return <div className="p-10 text-sm text-ink-muted">Loading read-only Portal view…</div>
  const currentYear = new Date().getFullYear()
  return <div><div className="px-6 pt-6 md:px-10"><Link href="/admin/employees" className="text-sm text-ink-muted hover:text-ink">← Employee accounts</Link></div><PortalPtoView data={data} year={year} years={[currentYear, currentYear - 1, currentYear - 2]} onYearChange={setYear} adminView /></div>
}
