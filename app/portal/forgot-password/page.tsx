'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    await fetch('/api/employee-portal/password/forgot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    }).catch(() => null)
    setBusy(false); setSent(true)
  }

  return <AuthCard title="Reset your password" subtitle="Enter your Portal login email.">
    {sent ? <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">If an active account exists, a password reset email will be sent.</div> : <form onSubmit={submit} className="space-y-4"><label className="block text-sm font-medium">Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:ring-2 focus:ring-ink" /></label><button disabled={busy} className="w-full rounded-xl bg-ink py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send reset link'}</button></form>}
    <Link href="/portal/login" className="mt-5 block text-center text-sm text-ink-muted hover:text-ink">Back to sign in</Link>
  </AuthCard>
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><div className="w-full max-w-md"><div className="mb-8 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-sm font-bold text-white">AFS</div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-2 text-sm text-ink-muted">{subtitle}</p></div><div className="rounded-3xl border border-line-soft bg-white p-7 shadow-sm">{children}</div></div></div>
}
