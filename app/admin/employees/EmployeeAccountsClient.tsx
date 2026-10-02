'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
type Account = { authUserId: string; loginEmail: string | null; portalStatus: 'pending' | 'active' | 'disabled'; passwordSetupRequired: boolean; profileStatus: string | null; archivedLoginEmail: string | null }
type EmployeeRow = { id: string; name: string; work_email: string | null; is_active: boolean; end_date: string | null; companies: { code: string; name: string } | null; account: Account | null }

export default function EmployeeAccountsClient() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')

  async function call(path: string, init?: RequestInit) {
    const session = (await supabase.auth.getSession()).data.session
    return fetch(path, { ...init, headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json', ...(init?.headers || {}) }, cache: 'no-store' })
  }
  async function load() {
    const response = await call('/api/admin/employee-accounts')
    if (!response.ok) { setMessage('Unable to load Employee Portal accounts.'); return }
    setEmployees((await response.json()).employees)
  }
  useEffect(() => { load() }, [])

  async function action(employee: EmployeeRow, actionName: 'create' | 'reset' | 'disable' | 'enable' | 'archive', extra: Record<string, unknown> = {}) {
    if (['disable', 'archive'].includes(actionName) && !window.confirm(`${actionName === 'archive' ? 'Archive login email for' : 'Disable'} ${employee.name}?`)) return
    let email: string | undefined
    if (actionName === 'create') {
      email = window.prompt(`Login email for ${employee.name}`, employee.work_email ?? '')?.trim()
      if (!email) return
    }
    setBusy(`${employee.id}:${actionName}`); setMessage('')
    const response = await call('/api/admin/employee-accounts', { method: 'POST', body: JSON.stringify({ action: actionName, employeeId: employee.id, email, ...extra }) })
    const body = await response.json().catch(() => ({}))
    setBusy('')
    if (!response.ok) { setMessage(body.error || 'Request failed.'); return }
    if (body.actionLink) {
      await navigator.clipboard.writeText(body.actionLink).catch(() => null)
      setMessage('One-time recovery link generated and copied. Do not store it in email notes or audit logs.')
    } else setMessage('Account action completed.')
    await load()
  }

  return <div className="p-6 md:p-10"><h1 className="text-2xl font-bold">Employee Portal Accounts</h1><p className="mt-2 text-sm text-ink-muted">Provision pilot accounts, reset access, or open the read-only Admin View. No bulk provisioning is available.</p>{message && <div className="mt-5 rounded-xl bg-pill px-4 py-3 text-sm text-ink-muted">{message}</div>}<div className="mt-8 overflow-x-auto rounded-2xl border border-line-soft bg-white"><table className="w-full text-left text-sm"><thead className="bg-pill text-xs uppercase text-ink-muted"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Employment</th><th className="px-4 py-3">Portal</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-line-soft">{employees.map(employee => <tr key={employee.id}><td className="px-4 py-4"><p className="font-semibold">{employee.name}</p><p className="text-xs text-ink-muted">{employee.companies?.code} · {employee.work_email || 'No work email'}</p></td><td className="px-4 py-4">{employee.is_active ? 'Active' : 'Inactive'}{employee.end_date ? ` · ends ${employee.end_date}` : ''}</td><td className="px-4 py-4">{employee.account ? <><p className="font-medium">{employee.account.portalStatus}{employee.account.passwordSetupRequired ? ' · password setup required' : ''}</p><p className="text-xs text-ink-muted">{employee.account.loginEmail || 'Archived login'}</p></> : <span className="text-ink-muted">Not provisioned</span>}</td><td className="px-4 py-4"><div className="flex min-w-72 flex-wrap gap-2"><Link href={`/admin/employees/${employee.id}/portal`} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">View Portal</Link>{!employee.account ? <button disabled={!!busy} onClick={() => action(employee, 'create')} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Invite</button> : <><button disabled={!!busy || employee.account.portalStatus === 'disabled'} onClick={() => action(employee, 'reset', { delivery: 'email' })} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-40">Reset by email</button><button disabled={!!busy || employee.account.portalStatus === 'disabled'} onClick={() => action(employee, 'reset', { delivery: 'link' })} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-40">Recovery link</button>{employee.account.portalStatus === 'disabled' ? <button disabled={!!busy} onClick={() => action(employee, 'enable')} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700">Enable</button> : <button disabled={!!busy} onClick={() => action(employee, 'disable')} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Disable</button>}{!employee.is_active && !employee.account.archivedLoginEmail && <button disabled={!!busy} onClick={() => action(employee, 'archive')} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800">Archive login</button>}</>}</div></td></tr>)}</tbody></table></div></div>
}
