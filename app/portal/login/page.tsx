'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { establishPortalSession, portalFetch, portalSupabase } from '@/lib/employeePortal'

const GENERIC_ERROR = 'Unable to sign in. Please check your Email or Login ID and password.'

export default function PortalLoginPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const response = await fetch('/api/employee-portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
      cache: 'no-store',
    }).catch(() => null)
    if (!response?.ok) {
      setBusy(false)
      setError(GENERIC_ERROR)
      return
    }
    const body = await response.json().catch(() => null) as { accessToken?: string; refreshToken?: string } | null
    if (!body?.accessToken || !body.refreshToken) {
      setBusy(false)
      setError(GENERIC_ERROR)
      return
    }
    const session = await establishPortalSession(body.accessToken, body.refreshToken)
    if (session.error) {
      setBusy(false)
      setError(GENERIC_ERROR)
      return
    }
    const setup = await portalFetch('/api/employee-portal/password/setup')
    if (!setup.ok) {
      await portalSupabase.auth.signOut()
      setBusy(false)
      setError(GENERIC_ERROR)
      return
    }
    const setupState = await setup.json() as { required?: boolean }
    setBusy(false)
    if (setupState.required) {
      router.replace('/portal/update-password')
      return
    }
    const next = new URLSearchParams(window.location.search).get('next')
    router.replace(next || '/portal')
  }

  return <div className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><div className="w-full max-w-md"><div className="mb-8 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-sm font-bold text-white">AFS</div><h1 className="text-2xl font-bold">Employee Portal</h1><p className="mt-2 text-sm text-ink-muted">View your PTO and company policy</p></div><form onSubmit={submit} className="space-y-4 rounded-3xl border border-line-soft bg-white p-7 shadow-sm">{error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<label className="block text-sm font-medium">Email or Login ID<input className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:ring-2 focus:ring-ink" type="text" autoComplete="username" required value={identifier} onChange={e => setIdentifier(e.target.value)} /></label><label className="block text-sm font-medium">Password<input className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:ring-2 focus:ring-ink" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><div className="text-right"><Link href="/portal/forgot-password" className="text-sm text-ink-muted hover:text-ink">Forgot password?</Link></div><button disabled={busy} className="w-full rounded-xl bg-ink py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button></form></div></div>
}
