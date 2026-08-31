'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { employeeSlug, getPortalSession, portalFetch, type PtoResponse } from '@/lib/employeePortal'

const label: Record<string, string> = { L: 'Paid Leave', L1: 'Paid Leave (AM Half)', L2: 'Paid Leave (PM Half)', L3: 'Paid Leave (Hourly)', S: 'Sick Leave', S1: 'Sick Leave (AM Half)', S2: 'Sick Leave (PM Half)', S3: 'Sick Leave (Hourly)' }
const value = (obj: Record<string, number | boolean | null>, key: string) => obj[key] == null ? '—' : String(obj[key])

export default function MyPtoPage() {
  const router = useRouter(); const [data, setData] = useState<PtoResponse | null>(null); const [year, setYear] = useState(new Date().getFullYear()); const [status, setStatus] = useState<'loading' | 'error' | 'forbidden'>('loading')
  const load = useCallback(async (selectedYear: number) => {
    setStatus('loading')
    const session = (await getPortalSession()).data.session
    if (!session) { router.replace('/portal/login'); return }
    const cacheKey = `afs_portal_pto:${session.user.id}:${selectedYear}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      try {
        setData(JSON.parse(cached) as PtoResponse)
        setStatus('loading')
        return
      } catch { sessionStorage.removeItem(cacheKey) }
    }
    const r = await portalFetch(`/api/employee-portal/me/hr?year=${selectedYear}`)
    if (r.status === 401) { router.replace('/portal/login'); return }
    if (r.status === 403) { setStatus('forbidden'); return }
    if (!r.ok) { setStatus('error'); return }
    const next = await r.json() as PtoResponse
    sessionStorage.setItem(cacheKey, JSON.stringify(next))
    setData(next)
    setStatus('loading')
  }, [router])
  useEffect(() => { load(year) }, [load, year])
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 3 }, (_, i) => currentYear - i)
  if (status === 'forbidden') return <Message title="Employee portal unavailable" body="Your employee portal is not available for this account." />
  if (status === 'error') return <Message title="Unable to load your employee information." body="Please try again." action={() => load(year)} />
  if (!data) return <div className="mx-auto max-w-6xl p-6 md:p-10"><div className="h-8 w-48 animate-pulse rounded bg-line-soft" /><div className="mt-8 grid gap-5 md:grid-cols-2"><div className="h-48 animate-pulse rounded-3xl bg-white" /><div className="h-48 animate-pulse rounded-3xl bg-white" /></div></div>
  const canonical = employeeSlug(data.employee.name); if (typeof window !== 'undefined' && window.location.pathname.split('/')[2] !== canonical) router.replace(`/portal/${canonical}`)
  return <div className="mx-auto max-w-6xl p-6 md:p-10"><header className="mb-10 flex flex-wrap items-end justify-between gap-5"><div><p className="mb-2 text-sm font-medium text-signal-pos">{data.employee.company.name}</p><h1 className="text-3xl font-bold tracking-tight">My PTO</h1><p className="mt-2 text-sm text-ink-muted">{data.employee.name}{data.employee.position ? ` · ${data.employee.position}` : ''}</p></div><div className="relative"><select aria-label="Year" value={year} onChange={e => setYear(Number(e.target.value))} className="appearance-none rounded-xl border border-line bg-white py-3 pl-4 pr-11 text-sm font-semibold outline-none focus:ring-2 focus:ring-ink">{years.map(y => <option key={y}>{y}</option>)}</select><svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5l5 5 5-5" /></svg></div></header><div className="grid gap-5 md:grid-cols-2"><BalanceCard title="Vacation" primary="Remaining" data={data.vacation} keys={['remaining', 'accrued', 'used', 'entitlement']} /><BalanceCard title="Sick Leave" primary="Remaining" data={data.sick} keys={['remaining', 'paidAllowance', 'used', 'unpaid']} /></div><section className="mt-10"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold">Leave History</h2><span className="text-sm text-ink-muted">{data.year}</span></div><div className="overflow-hidden rounded-3xl border border-line-soft bg-white shadow-sm">{data.leaveHistory.length === 0 ? <p className="p-8 text-sm text-ink-muted">No leave recorded for this year.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-pill text-xs uppercase tracking-wider text-ink-muted"><tr><th className="px-6 py-4">Date</th><th className="px-6 py-4">Leave type</th><th className="px-6 py-4">Days</th><th className="px-6 py-4">Hours</th></tr></thead><tbody className="divide-y divide-line-soft">{data.leaveHistory.map(row => <tr key={row.id}><td className="px-6 py-4 font-medium">{new Date(`${row.date}T12:00:00`).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}</td><td className="px-6 py-4">{label[row.code] || row.code}</td><td className="px-6 py-4">{row.days}</td><td className="px-6 py-4 text-ink-muted">{row.hours ?? '—'}</td></tr>)}</tbody></table></div>}</div></section></div>
}

function BalanceCard({ title, primary, data, keys }: { title: string; primary: string; data: Record<string, number | boolean | null>; keys: string[] }) { const names: Record<string, string> = { remaining: 'Remaining', accrued: 'Accrued', used: 'Used', entitlement: 'Entitlement', paidAllowance: 'Paid allowance', unpaid: 'Unpaid / other' }; return <section className="rounded-3xl border border-line-soft bg-white p-7 shadow-sm"><div className="mb-7 flex items-center justify-between"><h2 className="font-semibold">{title}</h2><span className="rounded-full bg-pill px-3 py-1 text-xs text-ink-muted">As provided</span></div><div className="mb-7"><p className="text-sm text-ink-muted">{primary}</p><p className="mt-1 text-5xl font-bold tracking-tight">{value(data, 'remaining')}</p></div><div className="grid grid-cols-3 gap-4 border-t border-line-soft pt-5">{keys.filter(k => k !== 'remaining').map(k => <div key={k}><p className="text-xs text-ink-muted">{names[k] || k}</p><p className="mt-1 font-semibold">{value(data, k)}</p></div>)}</div></section> }
function Message({ title, body, action }: { title: string; body: string; action?: () => void }) { return <div className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md rounded-3xl border border-line-soft bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold">{title}</h1><p className="mt-3 text-sm text-ink-muted">{body}</p>{action && <button onClick={action} className="mt-6 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white">Try again</button>}</div></div> }
