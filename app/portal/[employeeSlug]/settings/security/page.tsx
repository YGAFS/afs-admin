'use client'

import { FormEvent, useState } from 'react'
import { portalSupabase } from '@/lib/employeePortal'

export default function PortalSecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage('')
    if (password.length < 12) { setMessage('Use at least 12 characters.'); return }
    if (password !== confirm) { setMessage('Passwords do not match.'); return }
    setBusy(true)
    const result = await portalSupabase.auth.updateUser({ password, current_password: currentPassword })
    setBusy(false)
    if (result.error) { setMessage(result.error.message); return }
    setCurrentPassword(''); setPassword(''); setConfirm(''); setMessage('Password updated.')
  }

  return <div className="mx-auto max-w-2xl p-6 md:p-10"><h1 className="text-3xl font-bold">Security</h1><p className="mt-2 text-sm text-ink-muted">Change your Employee Portal password.</p><form onSubmit={submit} className="mt-8 space-y-5 rounded-3xl border border-line-soft bg-white p-7 shadow-sm">{message && <div className="rounded-xl bg-pill px-4 py-3 text-sm text-ink-muted">{message}</div>}<label className="block text-sm font-medium">Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-line px-4 py-3" /></label><label className="block text-sm font-medium">New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-line px-4 py-3" /></label><label className="block text-sm font-medium">Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-2 w-full rounded-xl border border-line px-4 py-3" /></label><button disabled={busy} className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Updating…' : 'Update password'}</button></form></div>
}
