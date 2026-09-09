'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder')
type Thread = { id: string; subject: string; sender_email: string; created_at: string }
type Notification = { id: string; bill_id: string; bill_name: string; status: 'queued' | 'sending' | 'sent' | 'failed'; created_at: string; sent_at: string | null }
type Bill = { id: string; provider: string | null; utility_name: string }

export default function UtilityAdminPage() {
  const { user, loading } = useAuth()
  const allowed = user?.email?.trim().toLowerCase() === 'admin@afstransco.com'

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-ink">Utility Admin</h1>
      <p className="mt-1 text-sm text-ink-muted">Monthly utility email thread management.</p>
      {!loading && !allowed && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">This page is restricted to admin@afstransco.com.</div>}
      {allowed && <UtilityEmailPanel />}
    </div>
  )
}

function UtilityEmailPanel() {
  const [thread, setThread] = useState<Thread | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const session = (await supabase.auth.getSession()).data.session
    if (!session?.access_token) return
    const response = await fetch('/api/utility/email-thread', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
    if (!response.ok) { setMessage(`Unable to load email status (${response.status}).`); return }
    const data = await response.json() as { thread: Thread | null; notifications?: Notification[]; bills?: Bill[] }
    setThread(data.thread); setNotifications(data.notifications ?? []); setBills(data.bills ?? [])
  }

  useEffect(() => { load() }, [])

  async function send(billId?: string, forceRoot = false) {
    const prior = billId ? notifications.find(item => item.bill_id === billId) : undefined
    if (billId && prior && !window.confirm(`${prior.bill_name} 빌을 다시 발송할까요?\n가장 최근 이메일에 이어 붙습니다.`)) return
    const session = (await supabase.auth.getSession()).data.session
    if (!session?.access_token) { setMessage('Please sign in again.'); return }
    setBusy(true); setMessage('')
    const action = billId && prior ? 'retry' : billId ? 'notify' : 'root'
    const response = await fetch('/api/utility/email-thread', {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, billId, force: forceRoot, version: billId ? `manual-resend:${Date.now()}` : undefined }),
    })
    const text = await response.text()
    let data: { error?: string } = {}
    try { data = text ? JSON.parse(text) as { error?: string } : {} } catch { data = { error: text } }
    setMessage(response.ok ? (action === 'root' ? '이번 달 최초 이메일이 발송되었습니다.' : '재발송되었습니다.') : (data.error ?? `Request failed (${response.status})`))
    await load(); setBusy(false)
  }

  const sent = notifications.filter(item => item.status === 'sent')
  return (
    <section className="mt-6 rounded-xl border border-line-soft bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Monthly email thread</h2>
          <p className="mt-1 text-xs text-ink-muted">September bills · {thread ? 'Root email sent' : 'Not sent yet'}</p>
        </div>
        <button onClick={() => { if (!thread || window.confirm('전체 Utility Bill 목록이 포함된 최초 안내 메일을 재발송할까요?\n기존 스레드의 가장 최근 이메일에 이어 붙습니다.')) send(undefined, !!thread) }} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-50">{busy ? 'Sending…' : thread ? 'Resend first email' : 'Send first email'}</button>
      </div>
      {thread && <div className="mt-4 rounded-lg bg-pill px-3 py-2 text-xs text-ink-muted"><span className="font-semibold text-ink">{thread.subject}</span> · 최초 이메일 발송 완료</div>}
      {thread && <details className="mt-5" open>
        <summary className="cursor-pointer text-sm font-semibold text-ink">이 스레드로 발송된 이메일: {sent.length + 1}개</summary>
        <div className="mt-3 space-y-2 border-l-2 border-line pl-3 text-sm">
          <div className="text-ink-muted">월간 최초 알림</div>
          {sent.map(item => <div key={item.id} className="text-ink">{item.bill_name}</div>)}
          {!sent.length && <div className="text-ink-faint">추가 빌 알림 없음</div>}
        </div>
      </details>}
      <div className="mt-6 border-t border-line-soft pt-4"><p className="text-xs text-ink-muted">The email contains the complete list of utility bills registered for the current month.</p></div>
      {message && <p className="mt-4 text-xs text-ink-muted">{message}</p>}
    </section>
  )
}
