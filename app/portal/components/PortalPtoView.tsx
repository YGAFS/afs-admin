'use client'

import { useMemo } from 'react'
import type { PtoResponse } from '@/lib/employeePortal'

const label: Record<string, string> = { L: 'Paid Leave', L1: 'Paid Leave (AM Half)', L2: 'Paid Leave (PM Half)', L3: 'Paid Leave (Hourly)', S: 'Sick Leave', S1: 'Sick Leave (AM Half)', S2: 'Sick Leave (PM Half)', S3: 'Sick Leave (Hourly)', W: 'WFH', T: 'Unpaid Leave', T1: 'Unpaid Leave (AM Half)', T2: 'Unpaid Leave (PM Half)', T3: 'Unpaid Leave (Hourly)' }
const value = (obj: Record<string, number | boolean | null>, key: string) => obj[key] == null ? '—' : String(obj[key])

export default function PortalPtoView({ data, year, years, onYearChange, adminView = false }: {
  data: PtoResponse
  year: number
  years: number[]
  onYearChange: (year: number) => void
  adminView?: boolean
}) {
  const monthly = useMemo(() => {
    const result = Array.from({ length: 12 }, () => ({ vacation: 0, sick: 0, wfh: 0, unpaid: 0 }))
    for (const row of data.leaveHistory) {
      const month = Number(row.date.slice(5, 7)) - 1
      if (month < 0 || month > 11) continue
      if (row.code.startsWith('L')) result[month].vacation += row.days
      else if (row.code.startsWith('S')) result[month].sick += row.days
      else if (row.code === 'W') result[month].wfh += 1
      else if (row.code.startsWith('T')) result[month].unpaid += row.days
    }
    return result
  }, [data.leaveHistory])

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthlyRows = [
    { key: 'vacation', label: 'Leave', className: 'text-ink font-semibold' },
    { key: 'sick', label: 'Sick', className: 'font-semibold text-signal-neg' },
    { key: 'wfh', label: 'WFH', className: 'font-semibold text-ink-muted' },
    { key: 'unpaid', label: 'Unpaid', className: 'font-semibold text-ink-muted' },
  ] as const

  return <div className="mx-auto max-w-6xl p-6 md:p-10">
    {adminView && <div className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4"><p className="font-bold tracking-wide text-amber-900">ADMIN VIEW — READ ONLY</p><p className="mt-1 text-sm text-amber-800">Viewing portal for: {data.employee.name} ({data.employee.id})</p><p className="mt-1 text-xs text-amber-700">Your administrator identity remains active. No employee Portal session or mutation access is created.</p></div>}
    <header className="mb-10 flex flex-wrap items-end justify-between gap-5"><div><p className="mb-2 text-sm font-medium text-signal-pos">{data.employee.company.name}</p><h1 className="text-3xl font-bold tracking-tight">{adminView ? 'Employee PTO' : 'My PTO'}</h1><p className="mt-2 text-sm text-ink-muted">{data.employee.name}{data.employee.position ? ` · ${data.employee.position}` : ''}</p></div><div className="relative"><select aria-label="Year" value={year} onChange={e => onYearChange(Number(e.target.value))} className="appearance-none rounded-xl border border-line bg-white py-3 pl-4 pr-11 text-sm font-semibold outline-none focus:ring-2 focus:ring-ink">{years.map(y => <option key={y}>{y}</option>)}</select><svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5l5 5 5-5" /></svg></div></header>
    <div className="grid gap-5 md:grid-cols-2"><BalanceCard title="Vacation" primary="Remaining" data={data.vacation} keys={['remaining', 'accrued', 'used', 'entitlement']} /><BalanceCard title="Sick Leave" primary="Remaining" data={data.sick} keys={['remaining', 'paidAllowance', 'used', 'unpaid']} /></div>
    <section className="mt-10 overflow-hidden rounded-3xl border border-line-soft bg-white shadow-sm"><div className="flex items-center justify-between border-b border-line-soft bg-pill px-4 py-3"><h2 className="font-semibold text-ink">Monthly Overview</h2><span className="text-sm font-semibold text-ink-muted">{data.year}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-b border-line-soft bg-white"><tr><th className="w-24 px-4 py-3 font-semibold text-ink-muted">Type</th>{months.map(month => <th key={month} className="px-2 py-3 text-center font-semibold text-ink-muted">{month}</th>)}</tr></thead><tbody>{monthlyRows.map(row => <tr key={row.key} className="border-t border-line-soft"><td className="px-4 py-3 text-ink-muted">{row.label}</td>{monthly.map((month, index) => { const count = month[row.key]; return <td key={index} className={`px-2 py-3 text-center ${count > 0 ? row.className : 'text-ink-faint'}`}>{count > 0 ? count : '·'}</td> })}</tr>)}</tbody></table></div></section>
    <section className="mt-5"><details className="overflow-hidden rounded-3xl border border-line-soft bg-white shadow-sm"><summary className="cursor-pointer select-none bg-pill px-5 py-4 font-semibold text-ink">Leave History · detailed usage</summary><div className="border-t border-line-soft">{data.leaveHistory.length === 0 ? <p className="p-8 text-sm text-ink-muted">No leave recorded for this year.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-white text-xs uppercase tracking-wider text-ink-muted"><tr><th className="px-6 py-4">Date</th><th className="px-6 py-4">Leave type</th><th className="px-6 py-4">Days</th><th className="px-6 py-4">Hours</th></tr></thead><tbody className="divide-y divide-line-soft">{data.leaveHistory.map(row => <tr key={row.id}><td className="px-6 py-4 font-medium">{new Date(`${row.date}T12:00:00`).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}</td><td className="px-6 py-4">{label[row.code] || row.code}</td><td className="px-6 py-4">{row.days}</td><td className="px-6 py-4 text-ink-muted">{row.hours ?? '—'}</td></tr>)}</tbody></table></div>}</div></details></section>
  </div>
}

function BalanceCard({ title, primary, data, keys }: { title: string; primary: string; data: Record<string, number | boolean | null>; keys: string[] }) {
  const names: Record<string, string> = { remaining: 'Remaining', accrued: 'Accrued', used: 'Used', entitlement: 'Entitlement', paidAllowance: 'Paid allowance', unpaid: 'Unpaid / other' }
  return <section className="rounded-3xl border border-line-soft bg-white p-7 shadow-sm"><div className="mb-7 flex items-center justify-between"><h2 className="font-semibold">{title}</h2><span className="rounded-full bg-pill px-3 py-1 text-xs text-ink-muted">As provided</span></div><div className="mb-7"><p className="text-sm text-ink-muted">{primary}</p><p className="mt-1 text-5xl font-bold tracking-tight">{value(data, 'remaining')}</p></div><div className="grid grid-cols-3 gap-4 border-t border-line-soft pt-5">{keys.filter(k => k !== 'remaining').map(k => <div key={k}><p className="text-xs text-ink-muted">{names[k] || k}</p><p className="mt-1 font-semibold">{value(data, k)}</p></div>)}</div></section>
}

export function PortalMessage({ title, body, action }: { title: string; body: string; action?: () => void }) {
  return <div className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md rounded-3xl border border-line-soft bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold">{title}</h1><p className="mt-3 text-sm text-ink-muted">{body}</p>{action && <button onClick={action} className="mt-6 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white">Try again</button>}</div></div>
}
