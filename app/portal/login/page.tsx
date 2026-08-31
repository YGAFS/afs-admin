'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { portalSupabase } from '@/lib/employeePortal'

export default function PortalLoginPage() {
  const router = useRouter(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); const { error: err } = await portalSupabase.auth.signInWithPassword({ email, password }); setBusy(false); if (err) { setError(err.message); return } const next = new URLSearchParams(window.location.search).get('next'); router.replace(next || '/portal') }
  return <div className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><div className="w-full max-w-md"><div className="mb-8 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-sm font-bold text-white">AFS</div><h1 className="text-2xl font-bold">Employee Portal</h1><p className="mt-2 text-sm text-ink-muted">View your PTO and company policy</p></div><form onSubmit={submit} className="space-y-4 rounded-3xl border border-line-soft bg-white p-7 shadow-sm">{error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Unable to sign in. Please check your email and password.</div>}<label className="block text-sm font-medium">Email<input className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:ring-2 focus:ring-ink" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label className="block text-sm font-medium">Password<input className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:ring-2 focus:ring-ink" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button disabled={busy} className="w-full rounded-xl bg-ink py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button></form></div></div>
}
