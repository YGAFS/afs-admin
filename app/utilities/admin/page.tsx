'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder')
type Thread = { id: string; subject: string; sender_email: string; created_at: string }
type Notification = { id: string; bill_id: string; bill_name: string; status: 'queued' | 'sending' | 'sent' | 'failed'; created_at: string; sent_at: string | null; graph_message_id?: string | null }
type Bill = { id: string; provider: string | null; utility_name: string; account_number?: string | null; company_id?: string | null; location_id?: string | null; created_at?: string; utility_locations?: { name?: string | null; city?: string | null } | { name?: string | null; city?: string | null }[] | null }
type RecipientGroup = { id: string; label: string }

const COMPANY_LABEL: Record<string, string> = { afs: 'AFS', tnt: 'TNT', zfs: 'ZFS' }

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function UtilityAdminPage() {
  const { user, loading } = useAuth()
  const allowed = user?.email?.trim().toLowerCase() === 'admin@afstransco.com'

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="max-w-3xl p-6">
        <h1 className="text-xl font-bold text-ink">Utility Admin</h1>
        <p className="mt-1 text-sm text-ink-muted">Monthly utility email thread management.</p>
        {!loading && !allowed && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">This page is restricted to admin@afstransco.com.</div>}
        {allowed && <UtilityEmailPanel />}
      </div>
    </div>
  )
}

function UtilityEmailPanel() {
  const [thread, setThread] = useState<Thread | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [recipientGroups, setRecipientGroups] = useState<RecipientGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([])
  const [sendNote, setSendNote] = useState('')
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
  useEffect(() => { setSelectedBillIds([]) }, [selectedGroup])

  async function send(billId?: string, forceRoot = false) {
    const prior = billId ? notifications.find(item => item.bill_id === billId) : undefined
    if (billId && prior && !window.confirm(`Resend ${prior.bill_name}?\nIt will be appended to the most recent email.`)) return
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
      setMessage(response.ok ? (action === 'root' ? (forceRoot ? 'The complete Utility Bill email was resent as a new message.' : 'The first email for this month was sent.') : 'The email was resent.') : (data.error ?? `Request failed (${response.status})`))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Email operation failed.')
    } finally {
      setBusy(false)
      void load(selectedGroup)
    }
  }

  async function sendSelected() {
    const selected = bills.filter(bill => selectedBillIds.includes(bill.id))
    if (!selected.length) return
    const session = (await supabase.auth.getSession()).data.session
    if (!session?.access_token) { setMessage('Please sign in again.'); return }
    setBusy(true); setMessage('')
    let sentCount = 0
    let failedCount = 0
    try {
      const response = await fetch('/api/utility/email-thread', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk', billIds: selected.map(bill => bill.id), recipientGroupId: selectedGroup || undefined, version: `manual-bulk:${Date.now()}`, message: sendNote.trim() || undefined }),
      })
      if (response.ok) sentCount = selected.length
      else failedCount = selected.length
      setMessage(`${sentCount} bill${sentCount === 1 ? '' : 's'} sent in one email${failedCount ? `, ${failedCount} failed.` : '.'}`)
      if (response.ok) {
        setSelectedBillIds([])
        setSendNote('')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Email operation failed.')
    } finally {
      setBusy(false)
      void load(selectedGroup)
    }
  }

  const sent = notifications.filter(item => item.status === 'sent')
  const sentEmailIds = new Set(sent.map(item => item.graph_message_id ?? item.id))
  const allBillsSelected = bills.length > 0 && bills.every(bill => selectedBillIds.includes(bill.id))
  return (
    <section className="mt-6 rounded-xl border border-line-soft bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Monthly email thread</h2>
          <p className="mt-1 text-xs text-ink-muted">September bills · {thread ? 'Root email sent' : 'Not sent yet'}</p>
        </div>
        <button onClick={() => { if (!thread || window.confirm('Warning: this sends a new email containing the complete Utility Bill list.\nIt will not be appended to the existing email. Continue?')) send(undefined, !!thread) }} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-50">{busy ? 'Sending…' : thread ? 'Resend first email' : 'Send first email'}</button>
      </div>
      <div className="mt-5 border-b border-line-soft pb-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Send to</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {recipientGroups.map(group => <button key={group.id} type="button" onClick={() => setSelectedGroup(group.id)} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${selectedGroup === group.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-muted hover:border-ink-muted hover:text-ink'}`}>{group.label}</button>)}
          {!recipientGroups.length && <span className="text-sm text-ink-faint">No recipient groups configured.</span>}
        </div>
        <p className="mt-2 text-xs text-ink-muted">The selected group is used for this manual send. Add more groups in <code>UTILITY_EMAIL_RECIPIENT_GROUPS</code>.</p>
      </div>
      {thread && <div className="mt-4 rounded-lg bg-pill px-3 py-2 text-xs text-ink-muted"><span className="font-semibold text-ink">{thread.subject}</span> · First email sent</div>}
      {thread && <details className="mt-5" open>
        <summary className="cursor-pointer text-sm font-semibold text-ink">Emails sent in this thread: {sentEmailIds.size + 1}</summary>
        <div className="mt-3 space-y-2 border-l-2 border-line pl-3 text-sm">
          <div className="text-ink-muted">Monthly initial notification</div>
          {sent.map(item => <div key={item.id} className="text-ink">{item.bill_name}</div>)}
          {!sent.length && <div className="text-ink-faint">No additional bill notifications</div>}
        </div>
      </details>}
      <div className="mt-6 border-t border-line-soft pt-4">
        <h3 className="text-sm font-semibold text-ink">Send this month’s bills manually</h3>
        <p className="mt-1 text-xs text-ink-muted">Select one or more bills to send them together in a single email. Previously sent bills can be selected again for testing or follow-up.</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-pill px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-ink">
            <input type="checkbox" checked={allBillsSelected} disabled={!bills.length || busy || !thread} onChange={event => setSelectedBillIds(event.target.checked ? bills.map(bill => bill.id) : [])} />
            Select all bills ({bills.length})
          </label>
          <button type="button" onClick={() => void sendSelected()} disabled={!selectedBillIds.length || busy || !thread} className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
            {busy ? 'Sending…' : `Send selected${selectedBillIds.length ? ` (${selectedBillIds.length})` : ''}`}
          </button>
        </div>
        <label className="mt-3 block text-xs font-semibold text-ink">
          Message (optional)
          <textarea value={sendNote} onChange={event => setSendNote(event.target.value)} disabled={busy || !thread} rows={3} maxLength={2000} placeholder="Add a note or announcement to include above the bill table…" className="mt-1 block w-full resize-y rounded-lg border border-line-soft bg-white px-3 py-2 text-sm font-normal text-ink outline-none focus:border-ink-muted disabled:bg-pill" />
        </label>
        <div className="mt-3 divide-y divide-line-soft rounded-lg border border-line-soft">
          {bills.map(bill => {
            const prior = notifications.find(item => item.bill_id === bill.id)
            const isNew = !prior
            return <div key={bill.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <input type="checkbox" checked={selectedBillIds.includes(bill.id)} disabled={busy || !thread} onChange={event => setSelectedBillIds(current => event.target.checked ? [...current, bill.id] : current.filter(id => id !== bill.id))} aria-label={`Select ${bill.provider ?? bill.utility_name}`} className="mt-1" />
                <div className="min-w-0"><div className="text-sm font-medium text-ink">{bill.provider ?? bill.utility_name}</div><div className="mt-0.5 text-xs text-ink-muted">{COMPANY_LABEL[bill.company_id ?? ''] ?? bill.company_id ?? '—'} · {Array.isArray(bill.utility_locations) ? (bill.utility_locations[0]?.name ?? bill.utility_locations[0]?.city) : (bill.utility_locations?.name ?? bill.utility_locations?.city) ?? 'No location'} · Account {bill.account_number?.trim() ? `****${bill.account_number.trim().slice(-4)}` : '—'}</div><div className="mt-1 text-xs text-ink-muted">Uploaded {formatDateTime(bill.created_at)} · {prior?.sent_at ? `Email sent ${formatDateTime(prior.sent_at)}` : prior ? `Email ${prior.status}` : 'Email not sent yet'}</div></div>
              </div>
              <span className={`shrink-0 text-xs font-semibold ${isNew ? 'text-blue-700' : 'text-ink-muted'}`}>{isNew ? 'New' : 'Sent'}</span>
            </div>
          })}
          {!bills.length && <div className="px-3 py-4 text-sm text-ink-faint">No bills for this month.</div>}
        </div>
      </div>
      {message && <p className="mt-4 text-xs text-ink-muted">{message}</p>}
    </section>
  )
}
