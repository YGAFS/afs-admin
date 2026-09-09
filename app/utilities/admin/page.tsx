'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder')
type Thread = { id: string; subject: string; sender_email: string; created_at: string }
type Notification = { id: string; bill_id: string; bill_name: string; status: 'queued' | 'sending' | 'sent' | 'failed'; created_at: string; sent_at: string | null }
type Bill = { id: string; provider: string | null; utility_name: string; account_number?: string | null; company_id?: string | null; location_id?: string | null; created_at?: string; utility_locations?: { name?: string | null; city?: string | null } | { name?: string | null; city?: string | null }[] | null }
type RecipientGroup = { id: string; label: string }

const COMPANY_LABEL: Record<string, string> = { afs: 'AFS', tnt: 'TNT', zfs: 'ZFS' }

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
  const [recipientGroups, setRecipientGroups] = useState<RecipientGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const loadSequence = useRef(0)

  async function load(groupId = selectedGroup) {
    const session = (await supabase.auth.getSession()).data.session
    if (!session?.access_token) return
    const sequence = ++loadSequence.current
    const query = groupId ? `?recipientGroupId=${encodeURIComponent(groupId)}` : ''
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch(`/api/utility/email-thread${query}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store', signal: controller.signal })
      const responseText = await response.text()
      if (!response.ok) { setMessage(`Unable to load email status (${response.status}).`); return }
      let data: { thread: Thread | null; notifications?: Notification[]; bills?: Bill[]; recipientGroups?: RecipientGroup[] }
      try { data = JSON.parse(responseText) as typeof data } catch { setMessage('Email status could not be read. Please refresh once.'); return }
      if (sequence !== loadSequence.current) return
      const groups = data.recipientGroups ?? []
      setThread(data.thread); setNotifications(data.notifications ?? []); setBills(data.bills ?? []); setRecipientGroups(groups)
      setSelectedGroup(current => groups.some(group => group.id === current) ? current : (groups[0]?.id ?? ''))
    } catch (error) {
      if (sequence === loadSequence.current) setMessage(error instanceof DOMException && error.name === 'AbortError' ? 'Email status request timed out. Please retry.' : error instanceof Error ? error.message : 'Unable to load email status.')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  useEffect(() => { void load('') }, [])
  useEffect(() => { if (selectedGroup) void load(selectedGroup) }, [selectedGroup])

  async function send(billId?: string, forceRoot = false) {
    const prior = billId ? notifications.find(item => item.bill_id === billId) : undefined
    if (billId && prior && !window.confirm(`${prior.bill_name} 빌을 다시 발송할까요?\n가장 최근 이메일에 이어 붙습니다.`)) return
    const session = (await supabase.auth.getSession()).data.session
    if (!session?.access_token) { setMessage('Please sign in again.'); return }
    setBusy(true); setMessage('')
    const action = billId && prior ? 'retry' : billId ? 'notify' : 'root'
    try {
      const response = await fetch('/api/utility/email-thread', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, billId, force: forceRoot, recipientGroupId: selectedGroup || undefined, version: billId ? `manual-resend:${Date.now()}` : undefined }),
      })
      const text = await response.text()
      let data: { error?: string } = {}
      try { data = text ? JSON.parse(text) as { error?: string } : {} } catch { data = { error: text } }
      setMessage(response.ok ? (action === 'root' ? (forceRoot ? '전체 Utility Bill 메일을 새 메일로 재발송했습니다.' : '이번 달 최초 이메일이 발송되었습니다.') : '재발송되었습니다.') : (data.error ?? `Request failed (${response.status})`))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Email operation failed.')
    } finally {
      setBusy(false)
      void load(selectedGroup)
    }
  }

  const sent = notifications.filter(item => item.status === 'sent')
  return (
    <section className="mt-6 rounded-xl border border-line-soft bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Monthly email thread</h2>
          <p className="mt-1 text-xs text-ink-muted">September bills · {thread ? 'Root email sent' : 'Not sent yet'}</p>
        </div>
        <button onClick={() => { if (!thread || window.confirm('경고: 전체 Utility Bill 목록이 포함된 새 메일을 다시 발송합니다.\n기존 메일에는 이어붙지 않습니다. 계속할까요?')) send(undefined, !!thread) }} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-50">{busy ? 'Sending…' : thread ? 'Resend first email' : 'Send first email'}</button>
      </div>
      <div className="mt-5 border-b border-line-soft pb-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Send to</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {recipientGroups.map(group => <button key={group.id} type="button" onClick={() => setSelectedGroup(group.id)} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${selectedGroup === group.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-muted hover:border-ink-muted hover:text-ink'}`}>{group.label}</button>)}
          {!recipientGroups.length && <span className="text-sm text-ink-faint">No recipient groups configured.</span>}
        </div>
        <p className="mt-2 text-xs text-ink-muted">The selected group is used for this manual send. Add more groups in <code>UTILITY_EMAIL_RECIPIENT_GROUPS</code>.</p>
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
      <div className="mt-6 border-t border-line-soft pt-4">
        <h3 className="text-sm font-semibold text-ink">이번 달 빌 수동 발송</h3>
        <p className="mt-1 text-xs text-ink-muted">자동 발송이 누락된 경우 업체별로 직접 보낼 수 있습니다. 이미 보낸 빌은 재발송 확인창이 표시됩니다.</p>
        <div className="mt-3 divide-y divide-line-soft rounded-lg border border-line-soft">
          {bills.map(bill => {
            const prior = notifications.find(item => item.bill_id === bill.id)
            return <div key={bill.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="min-w-0"><div className="text-sm font-medium text-ink">{bill.provider ?? bill.utility_name}</div><div className="mt-0.5 text-xs text-ink-muted">{COMPANY_LABEL[bill.company_id ?? ''] ?? bill.company_id ?? '—'} · {Array.isArray(bill.utility_locations) ? (bill.utility_locations[0]?.name ?? bill.utility_locations[0]?.city) : (bill.utility_locations?.name ?? bill.utility_locations?.city) ?? 'No location'} · Account {bill.account_number?.trim() ? `****${bill.account_number.trim().slice(-4)}` : '—'}</div></div>
              <button onClick={() => send(bill.id)} disabled={busy || !thread} className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">{prior ? 'Resend' : 'Send'}</button>
            </div>
          })}
          {!bills.length && <div className="px-3 py-4 text-sm text-ink-faint">이번 달 빌이 없습니다.</div>}
        </div>
      </div>
      {message && <p className="mt-4 text-xs text-ink-muted">{message}</p>}
    </section>
  )
}
