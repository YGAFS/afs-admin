'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
type PolicyRow = { company: { id: string; code: string; name: string }; policy: { metadata: { title: string; version: string; effectiveDate: string; lastUpdated: string }; markdown: string } | null }

export default function AdminPtoPolicyPage() {
  const [rows, setRows] = useState<PolicyRow[]>([])
  const [error, setError] = useState('')
  useEffect(() => { (async () => {
    const session = (await supabase.auth.getSession()).data.session
    const response = await fetch('/api/admin/pto-policy', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }, cache: 'no-store' })
    if (!response.ok) { setError('Unable to load Git policy status.'); return }
    setRows((await response.json()).policies)
  })() }, [])
  return <div className="max-w-4xl p-6 md:p-10"><h1 className="text-2xl font-bold">PTO / Attendance Policies</h1><p className="mt-2 text-sm text-ink-muted">Read-only status. Policies are reviewed and deployed from <code>content/policies/&lt;company&gt;/pto-attendance-policy.md</code>.</p>{error && <p className="mt-6 text-sm text-red-600">{error}</p>}<div className="mt-8 space-y-5">{rows.map(row => <section key={row.company.id} className="rounded-2xl border border-line-soft bg-white p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="font-bold">{row.company.name}</h2><p className="text-xs text-ink-muted">{row.company.code}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.policy ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{row.policy ? 'Published in Git' : 'Not published'}</span></div>{row.policy && <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-ink-muted">Version</p><p className="font-semibold">{row.policy.metadata.version}</p></div><div><p className="text-xs text-ink-muted">Effective</p><p className="font-semibold">{row.policy.metadata.effectiveDate}</p></div><div><p className="text-xs text-ink-muted">Last updated</p><p className="font-semibold">{row.policy.metadata.lastUpdated}</p></div></div>}</section>)}</div></div>
}
