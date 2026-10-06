'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { PortalLoginMode } from '@/lib/portalAccess'

type Account = {
  authUserId: string
  loginMode: PortalLoginMode
  loginId: string | null
  loginEmail: string | null
  portalStatus: 'pending' | 'active' | 'disabled'
  passwordSetupRequired: boolean
  profileStatus: string | null
  archivedLoginEmail: string | null
}
type EmployeeRow = {
  id: string
  name: string
  work_email: string | null
  is_active: boolean
  end_date: string | null
  employment_type: string | null
  companies: { code: string; name: string } | null
  account: Account | null
}
type ProvisionDialog = { employee: EmployeeRow; mode: PortalLoginMode; email: string }
type EmailEditDialog = { employee: EmployeeRow; email: string }
type OneTimeCredentials = { employeeName: string; loginId: string; temporaryPassword: string }

type CompanyTab = 'all' | 'AFS' | 'TNT' | 'ZFS'
type StatusTab = 'active' | 'terminated'

const COMPANY_TABS: Array<{ value: CompanyTab; label: string }> = [
  { value: 'all', label: 'All companies' },
  { value: 'AFS', label: 'AFS' },
  { value: 'TNT', label: 'TNT' },
  { value: 'ZFS', label: 'ZFS' },
]

function isNonPayrollEmploymentType(value?: string | null) {
  return value === 'non_payroll' || !!value?.endsWith('_non_payroll')
}

function isTerminated(employee: EmployeeRow) {
  return !employee.is_active || !!employee.end_date
}

export default function EmployeeAccountsClient() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [provision, setProvision] = useState<ProvisionDialog | null>(null)
  const [emailEdit, setEmailEdit] = useState<EmailEditDialog | null>(null)
  const [credentials, setCredentials] = useState<OneTimeCredentials | null>(null)
  const [companyTab, setCompanyTab] = useState<CompanyTab>('all')
  const [statusTab, setStatusTab] = useState<StatusTab>('active')

  async function call(path: string, init?: RequestInit) {
    const session = (await supabase.auth.getSession()).data.session
    return fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${session?.access_token ?? ''}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    })
  }

  async function load() {
    const response = await call('/api/admin/employee-accounts')
    if (!response.ok) { setMessage('Unable to load Employee Portal accounts.'); return }
    setEmployees((await response.json()).employees)
  }
  useEffect(() => { load() }, [])

  async function perform(
    employee: EmployeeRow,
    actionName: 'create' | 'reset' | 'change_email' | 'disable' | 'enable' | 'archive',
    extra: Record<string, unknown> = {},
  ) {
    if (['disable', 'archive'].includes(actionName)
      && !window.confirm(`${actionName === 'archive' ? 'Archive login identity for' : 'Disable'} ${employee.name}?`)) return
    setBusy(`${employee.id}:${actionName}`)
    setMessage('')
    const response = await call('/api/admin/employee-accounts', {
      method: 'POST',
      body: JSON.stringify({ action: actionName, employeeId: employee.id, ...extra }),
    })
    const body = await response.json().catch(() => ({}))
    setBusy('')
    if (!response.ok) { setMessage(body.error || 'Request failed.'); await load(); return }
    if (body.temporaryPassword && body.loginId) {
      setCredentials({ employeeName: employee.name, loginId: body.loginId, temporaryPassword: body.temporaryPassword })
      setMessage('Temporary credentials were created. They are shown only in the one-time dialog.')
    } else if (body.actionLink) {
      await navigator.clipboard.writeText(body.actionLink).catch(() => null)
      setMessage('One-time recovery link generated and copied. Do not store it in email notes or audit logs.')
    } else if (body.email) {
      setMessage('Login email updated. Use Reset by email or Recovery link to send new instructions to the corrected address.')
    } else if (body.mailAccepted) {
      setMessage('Email accepted for delivery. Check the employee inbox; delivery is not guaranteed until received.')
    } else {
      setMessage('Account action completed.')
    }
    setProvision(null)
    setEmailEdit(null)
    await load()
  }

  function openProvision(employee: EmployeeRow) {
    setProvision({ employee, mode: employee.work_email ? 'email' : 'admin_managed', email: employee.work_email ?? '' })
  }

  const visibleEmployees = employees.filter(employee => {
    if (isNonPayrollEmploymentType(employee.employment_type)) return false
    if (statusTab === 'terminated' ? !isTerminated(employee) : isTerminated(employee)) return false
    if (companyTab !== 'all' && employee.companies?.code?.toUpperCase() !== companyTab) return false
    return true
  })

  const activeCount = employees.filter(employee => !isNonPayrollEmploymentType(employee.employment_type) && !isTerminated(employee)).length
  const terminatedCount = employees.filter(employee => !isNonPayrollEmploymentType(employee.employment_type) && isTerminated(employee)).length

  function renderActions(employee: EmployeeRow) {
    if (!employee.account && statusTab === 'active') {
      return <button disabled={!!busy} onClick={() => openProvision(employee)} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Create login</button>
    }
    if (!employee.account) return null
    return <>
      {employee.account.loginMode === 'email' ? <>
        <button disabled={!!busy || employee.account.portalStatus === 'disabled'} onClick={() => setEmailEdit({ employee, email: employee.account?.loginEmail ?? employee.work_email ?? '' })} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-40">Edit email</button>
        <button disabled={!!busy || employee.account.portalStatus === 'disabled'} onClick={() => perform(employee, 'reset', { delivery: 'email' })} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-40">Reset by email</button>
        <button disabled={!!busy || employee.account.portalStatus === 'disabled'} onClick={() => perform(employee, 'reset', { delivery: 'link' })} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-40">Recovery link</button>
      </> : <button disabled={!!busy || employee.account.portalStatus === 'disabled'} onClick={() => perform(employee, 'reset')} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-40">Generate temporary password</button>}
      {employee.account.portalStatus === 'disabled'
        ? <button disabled={!!busy} onClick={() => perform(employee, 'enable')} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700">Enable</button>
        : <button disabled={!!busy} onClick={() => perform(employee, 'disable')} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Disable</button>}
      {!employee.is_active && !employee.account.archivedLoginEmail && <button disabled={!!busy} onClick={() => perform(employee, 'archive')} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800">Archive login</button>}
    </>
  }

  return <div className="p-6 md:p-10">
    <h1 className="text-2xl font-bold">Employee Portal Accounts</h1>
    <p className="mt-2 text-sm text-ink-muted">Provision pilot accounts, reset access, or open the read-only Admin View. No bulk provisioning is available. Non-payroll employees are excluded.</p>
    {message && <div className="mt-5 rounded-xl bg-pill px-4 py-3 text-sm text-ink-muted">{message}</div>}
    <div className="mt-8 flex flex-wrap gap-2 border-b border-line-soft pb-3">
      {COMPANY_TABS.map(tab => <button key={tab.value} onClick={() => setCompanyTab(tab.value)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${companyTab === tab.value ? 'bg-ink text-white' : 'border border-line bg-white text-ink-muted hover:text-ink'}`}>{tab.label}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-b border-line-soft py-3">
      <button onClick={() => setStatusTab('active')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${statusTab === 'active' ? 'border border-emerald-300 bg-emerald-50 text-emerald-800' : 'text-ink-muted hover:text-ink'}`}>Active ({activeCount})</button>
      <button onClick={() => setStatusTab('terminated')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${statusTab === 'terminated' ? 'border border-red-200 bg-red-50 text-red-700' : 'text-ink-muted hover:text-ink'}`}>Terminated ({terminatedCount})</button>
    </div>
    <div className="mt-4 overflow-x-auto rounded-2xl border border-line-soft bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-pill text-xs uppercase text-ink-muted"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Employment</th><th className="px-4 py-3">Portal</th><th className="px-4 py-3">Actions</th></tr></thead>
        <tbody className="divide-y divide-line-soft">
          {visibleEmployees.length === 0 ? <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-ink-muted">No employees in this view.</td></tr> : visibleEmployees.map(employee => <tr key={employee.id}>
            <td className="px-4 py-4"><p className="font-semibold">{employee.name}</p><p className="text-xs text-ink-muted">{employee.companies?.code} · {employee.work_email || 'No work email'}</p></td>
            <td className="px-4 py-4">{employee.is_active && !employee.end_date ? 'Active' : 'Terminated'}{employee.end_date ? ` · ends ${employee.end_date}` : ''}</td>
            <td className="px-4 py-4">{employee.account ? <><p className="font-medium">{employee.account.portalStatus}{employee.account.passwordSetupRequired ? ' · password setup required' : ''}</p><p className="text-xs text-ink-muted">{employee.account.loginMode === 'admin_managed' ? `Admin-managed · Login ID ${employee.account.loginId}` : `Email-managed · ${employee.account.loginEmail || 'Archived login'}`}</p></> : <span className="text-ink-muted">Not provisioned</span>}</td>
            <td className="px-4 py-4"><div className="flex min-w-72 flex-wrap gap-2"><Link href={`/admin/employees/${employee.id}/portal`} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">View Portal</Link>{renderActions(employee)}</div></td>
          </tr>)}
        </tbody>
      </table>
    </div>

    {provision && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"><div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-xl"><h2 className="text-xl font-bold">Create login for {provision.employee.name}</h2><p className="mt-2 text-sm text-ink-muted">Choose Email-managed only for a unique employee mailbox. Shared mailboxes must not be used.</p><div className="mt-6 grid gap-3"><label className="rounded-xl border border-line p-4"><input type="radio" checked={provision.mode === 'email'} onChange={() => setProvision({ ...provision, mode: 'email' })} /> <span className="ml-2 font-semibold">Email-managed</span><p className="mt-1 pl-6 text-xs text-ink-muted">Supabase invite and email recovery.</p></label><label className="rounded-xl border border-line p-4"><input type="radio" checked={provision.mode === 'admin_managed'} onChange={() => setProvision({ ...provision, mode: 'admin_managed', email: '' })} /> <span className="ml-2 font-semibold">Admin-managed</span><p className="mt-1 pl-6 text-xs text-ink-muted">Unique Login ID and one-time temporary password. No recovery email.</p></label></div>{provision.mode === 'email' && <label className="mt-5 block text-sm font-medium">Employee email<input type="email" required value={provision.email} onChange={event => setProvision({ ...provision, email: event.target.value })} className="mt-2 w-full rounded-xl border border-line px-4 py-3" /></label>}<div className="mt-7 flex justify-end gap-3"><button onClick={() => setProvision(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold">Cancel</button><button disabled={!!busy || (provision.mode === 'email' && !provision.email.trim())} onClick={() => perform(provision.employee, 'create', { mode: provision.mode, email: provision.mode === 'email' ? provision.email.trim() : undefined })} className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Creating…' : provision.mode === 'email' ? 'Send invite' : 'Create Login ID'}</button></div></div></div>}

    {emailEdit && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"><div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-xl"><h2 className="text-xl font-bold">Correct login email</h2><p className="mt-2 text-sm text-ink-muted">This keeps the existing Auth user and Portal link. The old address will no longer be used for this account.</p><label className="mt-5 block text-sm font-medium">New employee email<input type="email" required value={emailEdit.email} onChange={event => setEmailEdit({ ...emailEdit, email: event.target.value })} className="mt-2 w-full rounded-xl border border-line px-4 py-3" /></label><p className="mt-3 text-xs leading-5 text-ink-muted">After saving, use Reset by email or Recovery link to send setup instructions to the corrected address.</p><div className="mt-7 flex justify-end gap-3"><button onClick={() => setEmailEdit(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold">Cancel</button><button disabled={!!busy || !emailEdit.email.trim()} onClick={() => perform(emailEdit.employee, 'change_email', { email: emailEdit.email.trim() })} className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Updating…' : 'Update email'}</button></div></div></div>}

    {credentials && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"><div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-xl"><h2 className="text-xl font-bold">Temporary Portal credentials</h2><p className="mt-2 text-sm text-red-700">Shown once. Closing this dialog permanently removes the password from this screen.</p><dl className="mt-6 space-y-4 rounded-2xl bg-pill p-5"><div><dt className="text-xs uppercase text-ink-muted">Employee</dt><dd className="mt-1 font-semibold">{credentials.employeeName}</dd></div><div><dt className="text-xs uppercase text-ink-muted">Login ID</dt><dd className="mt-1 font-mono text-lg">{credentials.loginId}</dd></div><div><dt className="text-xs uppercase text-ink-muted">Temporary password</dt><dd className="mt-1 break-all font-mono text-lg">{credentials.temporaryPassword}</dd></div></dl><p className="mt-4 text-xs leading-5 text-ink-muted">The employee must change this password before Portal or PTO data can be accessed. The password is not stored in the application database or audit log.</p><div className="mt-7 flex justify-end"><button onClick={() => setCredentials(null)} className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white">I have recorded it — close</button></div></div></div>}
  </div>
}
