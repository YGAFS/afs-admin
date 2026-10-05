'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { portalFetch, portalSupabase } from '@/lib/employeePortal'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    portalSupabase.auth.getSession().then(({ data }) => setReady(!!data.session))
    const { data } = portalSupabase.auth.onAuthStateChange((_event, session) => { if (session) setReady(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < 12) { setError('Use at least 12 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    const completed = await portalFetch('/api/employee-portal/password/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const body = await completed.json().catch(() => ({})) as { error?: string }
    setBusy(false)
    if (!completed.ok) {
      setError(body.error || 'Unable to update password.')
      return
    }
    setPassword('')
    setConfirm('')
    router.replace('/portal')
  }

  return <div className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><div className="w-full max-w-md rounded-3xl border border-line-soft bg-white p-7 shadow-sm"><h1 className="text-2xl font-bold">Set your password</h1><p className="mt-2 text-sm text-ink-muted">Choose a private password that is not shared with your administrator.</p>{!ready ? <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Sign in with your temporary password or open this page from a valid invitation or recovery link.</div> : <form onSubmit={submit} className="mt-6 space-y-4">{error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<label className="block text-sm font-medium">New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-line px-4 py-3" /></label><label className="block text-sm font-medium">Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-2 w-full rounded-xl border border-line px-4 py-3" /></label><button disabled={busy} className="w-full rounded-xl bg-ink py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save password'}</button></form>}</div></div>
}
