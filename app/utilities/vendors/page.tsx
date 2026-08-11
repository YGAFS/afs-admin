'use client'

export const dynamic = 'force-dynamic'

import {
  useEffect, useMemo, useState, useCallback, useRef, Suspense,
} from 'react'
import { createClient } from '@supabase/supabase-js'
import { useSearchParams } from 'next/navigation'
import { computeBillStatus, STATUS_BADGE, type BalanceStatus, type InvoiceStatus } from '@/lib/billStatus'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Company = 'afs' | 'tnt' | 'zfs'
type Role    = 'admin' | 'ap'

interface Location {
  id: string; company_id: Company; region: string | null
  city: string; name: string; address: string | null
  sort_order?: number | null
}

interface Contact {
  id: string; vendor_id: string; name: string; title: string | null
  email: string | null; phone: string | null; is_primary: boolean; notes: string | null
}

interface ServiceAccount {
  id: string; vendor_id: string; location_id: string | null
  account_number: string; service_label: string | null
  billing_portal_url: string | null; is_active: boolean; is_auto_pay: boolean; notes: string | null
  utility_locations: Location | null
}

interface DocumentLink {
  id: string; vendor_id: string; location_id: string | null
  name: string; document_type: string; onedrive_url: string
}

interface Vendor {
  id: string; company_id: Company; name: string; service_type: string | null
  contact_name: string | null; contact_email: string | null; contact_phone: string | null
  contract_start: string | null; contract_end: string | null
  onedrive_url: string | null; website_url: string | null
  billing_portal_url: string | null; notes: string | null
  location_id: string | null
  created_at: string
  utility_vendor_contacts: Contact[]
  utility_service_accounts: ServiceAccount[]
  utility_document_links: DocumentLink[]
}

interface Bill {
  id: string
  provider: string | null; amount: number | null
  currency: string; due_date: string | null; is_paid: boolean
  issue_date: string | null
  utility_name: string; bill_number: string | null; account_number: string | null
  balance_status: BalanceStatus; invoice_status: InvoiceStatus | null
}

interface PaymentMethod {
  id: string
  company_id: Company
  label: string
  holder_name: string | null
  card_brand: string | null
  bank_name: string | null
  is_auto: boolean
  notes: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CO_BADGE: Record<Company, string> = {
  afs: 'bg-blue-100 text-blue-700',
  tnt: 'bg-amber-100 text-amber-700',
  zfs: 'bg-emerald-100 text-emerald-700',
}

const DOC_ICONS: Record<string, string> = {
  contract: '📄', rate_schedule: '📊', terms: '📋', other: '📎',
}

function toCAD(amount: number | null, currency: string) {
  if (amount == null) return 0
  return currency === 'USD' ? amount * 1.36 : amount
}

function fmtCAD(n: number) {
  return `CA$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function sortLocations(arr: Location[]) {
  return [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function avgDayOfMonth(dates: (string | null)[]) {
  const days = dates.filter((d): d is string => !!d).map(d => new Date(d + 'T00:00:00').getDate())
  if (!days.length) return null
  return Math.round(days.reduce((s, d) => s + d, 0) / days.length)
}

// ── Copy hook ─────────────────────────────────────────────────────────────────

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(prev => prev === id ? null : prev), 1800)
  }
  return { copy, copiedId }
}

// ── CopyBtn ───────────────────────────────────────────────────────────────────

function CopyBtn({ text, id, copiedId, copy }: {
  text: string; id: string
  copiedId: string | null; copy: (t: string, id: string) => void
}) {
  const done = copiedId === id
  return (
    <button
      onClick={e => { e.stopPropagation(); copy(text, id) }}
      title="Copy"
      className={`ml-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
        done ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
      }`}
    >
      {done ? '✓' : '⎘'}
    </button>
  )
}

// ── emptyVendor ───────────────────────────────────────────────────────────────

const emptyVendor: Omit<Vendor,
  'id' | 'created_at' | 'utility_vendor_contacts' | 'utility_service_accounts' | 'utility_document_links'
> = {
  company_id: 'afs', name: '', service_type: '', contact_name: '', contact_email: '',
  contact_phone: '', contract_start: '', contract_end: '', onedrive_url: '',
  website_url: '', billing_portal_url: '', notes: '', location_id: null,
}

// ── VendorDetailPanel ─────────────────────────────────────────────────────────

function VendorDetailPanel({
  vendor, locations, bills, role, onClose, onRefresh,
}: {
  vendor: Vendor; locations: Location[]; bills: Bill[]
  role: Role; onClose: () => void; onRefresh: () => void
}) {
  const { copy, copiedId } = useCopy()

  // Bill stats for this vendor
  const vendorBills = bills.filter(
    b => b.provider?.toLowerCase() === vendor.name.toLowerCase()
  )
  const avgAmt = vendorBills.length
    ? vendorBills.reduce((s, b) => s + toCAD(b.amount, b.currency), 0) / vendorBills.length
    : null
  const nextBill = vendorBills
    .filter(b => !b.is_paid && b.due_date)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0] ?? null
  const avgIssueDay = avgDayOfMonth(vendorBills.map(b => b.issue_date))
  const avgDueDay = avgDayOfMonth(vendorBills.map(b => b.due_date))

  // Service accounts inline add
  const [addingAccount, setAddingAccount] = useState(false)
  const [acctForm, setAcctForm] = useState({
    account_number: '', service_label: '', location_id: '', billing_portal_url: '', notes: '', is_auto_pay: false,
  })
  const [savingAcct, setSavingAcct] = useState(false)

  // Contacts inline add
  const [addingContact, setAddingContact] = useState(false)
  const [ctForm, setCtForm] = useState({
    name: '', title: '', email: '', phone: '', is_primary: false, notes: '',
  })
  const [savingCt, setSavingCt] = useState(false)

  // Documents inline add
  const [addingDoc, setAddingDoc] = useState(false)
  const [docForm, setDocForm] = useState({
    name: '', document_type: 'contract', onedrive_url: '', location_id: '',
  })
  const [savingDoc, setSavingDoc] = useState(false)

  async function saveAccount() {
    if (!acctForm.account_number.trim()) return
    setSavingAcct(true)
    await supabase.from('utility_service_accounts').insert({
      vendor_id: vendor.id,
      account_number: acctForm.account_number.trim(),
      service_label: acctForm.service_label || null,
      location_id: acctForm.location_id || null,
      billing_portal_url: acctForm.billing_portal_url || null,
      notes: acctForm.notes || null,
      is_auto_pay: acctForm.is_auto_pay,
    })
    setSavingAcct(false)
    setAddingAccount(false)
    setAcctForm({ account_number: '', service_label: '', location_id: '', billing_portal_url: '', notes: '', is_auto_pay: false })
    onRefresh()
  }

  async function deleteAccount(id: string) {
    await supabase.from('utility_service_accounts').delete().eq('id', id)
    onRefresh()
  }

  async function toggleAccountAutoPay(id: string, value: boolean) {
    await supabase.from('utility_service_accounts').update({ is_auto_pay: value }).eq('id', id)
    // The Dashboard's Auto Pay badge reads is_auto_pay off each *bill* row
    // (set once at ingestion time), not off the account -- without this,
    // toggling it here only affects bills the ingestor creates *after* the
    // toggle, and the Dashboard silently keeps showing the old state for
    // every bill that already exists.
    const account = accounts.find(a => a.id === id)
    if (account) {
      await supabase.from('utility_bills').update({ is_auto_pay: value })
        .eq('company_id', vendor.company_id).eq('account_number', account.account_number)
    }
    onRefresh()
  }

  async function saveContact() {
    if (!ctForm.name.trim()) return
    setSavingCt(true)
    await supabase.from('utility_vendor_contacts').insert({
      vendor_id: vendor.id, name: ctForm.name.trim(), title: ctForm.title || null,
      email: ctForm.email || null, phone: ctForm.phone || null,
      is_primary: ctForm.is_primary, notes: ctForm.notes || null,
    })
    setSavingCt(false)
    setAddingContact(false)
    setCtForm({ name: '', title: '', email: '', phone: '', is_primary: false, notes: '' })
    onRefresh()
  }

  async function deleteContact(id: string) {
    await supabase.from('utility_vendor_contacts').delete().eq('id', id)
    onRefresh()
  }

  async function saveDoc() {
    if (!docForm.name.trim() || !docForm.onedrive_url.trim()) return
    setSavingDoc(true)
    await supabase.from('utility_document_links').insert({
      vendor_id: vendor.id, name: docForm.name.trim(),
      document_type: docForm.document_type,
      onedrive_url: docForm.onedrive_url.trim(),
      location_id: docForm.location_id || null,
    })
    setSavingDoc(false)
    setAddingDoc(false)
    setDocForm({ name: '', document_type: 'contract', onedrive_url: '', location_id: '' })
    onRefresh()
  }

  async function deleteDoc(id: string) {
    await supabase.from('utility_document_links').delete().eq('id', id)
    onRefresh()
  }

  const contacts = vendor.utility_vendor_contacts
  const accounts = vendor.utility_service_accounts
  const documents = vendor.utility_document_links

  const locationMap = useMemo(() => {
    const m = new Map<string, Location>()
    locations.forEach(l => m.set(l.id, l))
    return m
  }, [locations])

  const companyLocations = locations.filter(l => l.company_id === vendor.company_id)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white border-l border-gray-200">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${CO_BADGE[vendor.company_id]}`}>
              {vendor.company_id.toUpperCase()}
            </span>
            {vendor.service_type && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-sky-100 text-sky-700">
                {vendor.service_type}
              </span>
            )}
            {vendor.location_id && locationMap.get(vendor.location_id) && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                📍 {locationMap.get(vendor.location_id)!.name}
              </span>
            )}
          </div>
          <h2 className="text-lg font-bold text-gray-900 leading-tight">{vendor.name}</h2>
          {(avgAmt !== null) && (
            <p className="text-xs text-gray-400 mt-0.5">
              Avg {fmtCAD(avgAmt)}/mo · {vendorBills.length} bills
              {nextBill?.due_date ? ` · Next: ${fmtDate(nextBill.due_date)}` : ''}
            </p>
          )}
          {(avgIssueDay !== null || avgDueDay !== null) && (
            <p className="text-xs text-gray-400 mt-0.5">
              {avgIssueDay !== null && `Avg Invoice Date: ${ordinal(avgIssueDay)}`}
              {avgIssueDay !== null && avgDueDay !== null && ' · '}
              {avgDueDay !== null && `Avg Due Date: ${ordinal(avgDueDay)}`}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl shrink-0 leading-none mt-0.5">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Links row */}
        {(vendor.website_url || vendor.billing_portal_url) && (
          <div className="px-5 py-3 border-b border-gray-100 flex gap-2 flex-wrap">
            {vendor.website_url && (
              <a href={vendor.website_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                🌐 Website
              </a>
            )}
            {vendor.billing_portal_url && (
              <a href={vendor.billing_portal_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                💳 Billing Portal
              </a>
            )}
          </div>
        )}

        {/* Contacts */}
        <section className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contacts</h3>
            {role === 'admin' && (
              <button onClick={() => setAddingContact(v => !v)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                {addingContact ? 'Cancel' : '+ Add'}
              </button>
            )}
          </div>

          {contacts.length === 0 && !addingContact && (
            <p className="text-xs text-gray-400">No contacts.</p>
          )}

          <div className="space-y-3">
            {contacts.map(c => (
              <div key={c.id} className="group flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">{c.name}</span>
                    {c.is_primary && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Primary</span>}
                    {c.title && <span className="text-xs text-gray-400">· {c.title}</span>}
                  </div>
                  {c.email && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <a href={`mailto:${c.email}`} className="text-xs text-blue-600 hover:underline truncate max-w-[180px]">{c.email}</a>
                      <CopyBtn text={c.email} id={`email-${c.id}`} copiedId={copiedId} copy={copy} />
                    </div>
                  )}
                  {c.phone && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <a href={`tel:${c.phone}`} className="text-xs text-gray-600 hover:text-gray-900">{c.phone}</a>
                      <CopyBtn text={c.phone} id={`phone-${c.id}`} copiedId={copiedId} copy={copy} />
                    </div>
                  )}
                </div>
                {role === 'admin' && (
                  <button onClick={() => deleteContact(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs transition-opacity shrink-0 mt-0.5">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {addingContact && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Name *" value={ctForm.name}
                  onChange={e => setCtForm(f => ({ ...f, name: e.target.value }))}
                  className="col-span-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <input type="text" placeholder="Title" value={ctForm.title}
                  onChange={e => setCtForm(f => ({ ...f, title: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <input type="text" placeholder="Phone" value={ctForm.phone}
                  onChange={e => setCtForm(f => ({ ...f, phone: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <input type="email" placeholder="Email" value={ctForm.email}
                  onChange={e => setCtForm(f => ({ ...f, email: e.target.value }))}
                  className="col-span-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={ctForm.is_primary}
                    onChange={e => setCtForm(f => ({ ...f, is_primary: e.target.checked }))}
                    className="w-3.5 h-3.5 accent-blue-600" />
                  Primary contact
                </label>
              </div>
              <button onClick={saveContact} disabled={savingCt || !ctForm.name.trim()}
                className="w-full py-1.5 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                {savingCt ? 'Saving…' : 'Add Contact'}
              </button>
            </div>
          )}
        </section>

        {/* Service Accounts */}
        <section className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Service Accounts</h3>
            {role === 'admin' && (
              <button onClick={() => setAddingAccount(v => !v)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                {addingAccount ? 'Cancel' : '+ Add'}
              </button>
            )}
          </div>

          {accounts.length === 0 && !addingAccount && (
            <p className="text-xs text-gray-400">No service accounts.</p>
          )}

          <div className="space-y-2">
            {accounts.map(a => {
              const loc = a.location_id ? locationMap.get(a.location_id) : null
              return (
                <div key={a.id} className="group flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-gray-800">{a.account_number}</span>
                      <CopyBtn text={a.account_number} id={`acct-${a.id}`} copiedId={copiedId} copy={copy} />
                      {!a.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {loc && <span className="text-xs text-gray-500">📍 {loc.name}</span>}
                      {a.service_label && <span className="text-xs text-gray-400">· {a.service_label}</span>}
                    </div>
                    {a.billing_portal_url && (
                      <a href={a.billing_portal_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-0.5 block">💳 Account Portal</a>
                    )}
                    {a.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{a.notes}</p>}
                    {role === 'admin' ? (
                      <label className="flex items-center gap-1.5 mt-1 cursor-pointer w-fit">
                        <input type="checkbox" checked={a.is_auto_pay}
                          onChange={e => toggleAccountAutoPay(a.id, e.target.checked)}
                          className="w-3.5 h-3.5 accent-blue-600" />
                        <span className={`text-xs ${a.is_auto_pay ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                          {a.is_auto_pay ? '⟳ Auto Pay' : 'Auto Pay'}
                        </span>
                      </label>
                    ) : a.is_auto_pay ? (
                      <span className="text-xs text-blue-600 font-medium mt-1 block">⟳ Auto Pay</span>
                    ) : null}
                  </div>
                  {role === 'admin' && (
                    <button onClick={() => deleteAccount(a.id)}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs transition-opacity shrink-0 mt-0.5">
                      ✕
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {addingAccount && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
              <input type="text" placeholder="Account Number *" value={acctForm.account_number}
                onChange={e => setAcctForm(f => ({ ...f, account_number: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <div className="grid grid-cols-2 gap-2">
                <select value={acctForm.location_id}
                  onChange={e => setAcctForm(f => ({ ...f, location_id: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
                  <option value="">— Location —</option>
                  {companyLocations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <input type="text" placeholder="Label (optional)" value={acctForm.service_label}
                  onChange={e => setAcctForm(f => ({ ...f, service_label: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <input type="url" placeholder="Billing Portal URL (optional)" value={acctForm.billing_portal_url}
                onChange={e => setAcctForm(f => ({ ...f, billing_portal_url: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <input type="text" placeholder="Notes (optional)" value={acctForm.notes}
                onChange={e => setAcctForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={acctForm.is_auto_pay}
                  onChange={e => setAcctForm(f => ({ ...f, is_auto_pay: e.target.checked }))}
                  className="w-3.5 h-3.5 accent-blue-600" />
                Auto-pay
              </label>
              <button onClick={saveAccount} disabled={savingAcct || !acctForm.account_number.trim()}
                className="w-full py-1.5 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                {savingAcct ? 'Saving…' : 'Add Account'}
              </button>
            </div>
          )}
        </section>

        {/* Contract Dates */}
        {(vendor.contract_start || vendor.contract_end) && (
          <section className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Contract Period</h3>
            <p className="text-sm text-gray-700">
              {fmtDate(vendor.contract_start)} → {vendor.contract_end ? fmtDate(vendor.contract_end) : 'Ongoing'}
            </p>
          </section>
        )}

        {/* Documents */}
        <section className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contract Documents</h3>
            {role === 'admin' && (
              <button onClick={() => setAddingDoc(v => !v)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                {addingDoc ? 'Cancel' : '+ Add'}
              </button>
            )}
          </div>

          {documents.length === 0 && !addingDoc && (
            <p className="text-xs text-gray-400">No documents.</p>
          )}

          <div className="space-y-2">
            {documents.map(d => (
              <div key={d.id} className="group flex items-center justify-between gap-2">
                <a href={d.onedrive_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-gray-700 hover:text-blue-600 transition-colors min-w-0">
                  <span className="shrink-0">{DOC_ICONS[d.document_type] ?? '📎'}</span>
                  <span className="truncate">{d.name}</span>
                  <span className="text-gray-300 shrink-0">👁</span>
                </a>
                {role === 'admin' && (
                  <button onClick={() => deleteDoc(d.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs transition-opacity shrink-0">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {addingDoc && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
              <input type="text" placeholder="Document name *" value={docForm.name}
                onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <div className="grid grid-cols-2 gap-2">
                <select value={docForm.document_type}
                  onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
                  <option value="contract">Contract</option>
                  <option value="rate_schedule">Rate Schedule</option>
                  <option value="terms">Terms & Conditions</option>
                  <option value="other">Other</option>
                </select>
                <select value={docForm.location_id}
                  onChange={e => setDocForm(f => ({ ...f, location_id: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
                  <option value="">— Location —</option>
                  {companyLocations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <input type="url" placeholder="OneDrive URL *" value={docForm.onedrive_url}
                onChange={e => setDocForm(f => ({ ...f, onedrive_url: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <button onClick={saveDoc} disabled={savingDoc || !docForm.name.trim() || !docForm.onedrive_url.trim()}
                className="w-full py-1.5 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                {savingDoc ? 'Saving…' : 'Add Document'}
              </button>
            </div>
          )}
        </section>

        {/* Notes */}
        {vendor.notes && (
          <section className="px-5 py-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Notes</h3>
            <p className="text-sm text-gray-600 italic">{vendor.notes}</p>
          </section>
        )}
      </div>
    </div>
  )
}

// ── Vendor Form Modal ─────────────────────────────────────────────────────────

function VendorModal({
  initial, locations, bills, onClose, onSave,
}: {
  initial: Partial<Vendor>
  locations: Location[]
  bills: Bill[]
  onClose: () => void; onSave: () => void
}) {
  const [form, setForm] = useState({ ...emptyVendor, ...initial })
  const [saving, setSaving] = useState(false)
  const isEdit = !!initial.company_id && (initial as any).id
  const vendorId = (initial as any).id as string | undefined

  const [tab, setTab] = useState<'details' | 'accounts' | 'payments' | 'bills'>('details')
  const [accounts, setAccounts] = useState<ServiceAccount[]>(initial.utility_service_accounts ?? [])
  const [addingAccount, setAddingAccount] = useState(false)
  const [acctForm, setAcctForm] = useState({ account_number: '', location_id: '', service_label: '', is_auto_pay: false })
  const [savingAcct, setSavingAcct] = useState(false)

  const companyLocations = locations.filter(l => l.company_id === form.company_id)

  // Payment methods (the pool is company-wide; which ones apply to THIS
  // vendor is tracked separately via vendor_payment_methods, so an already-
  // registered method can be linked here instead of re-entered every time)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [loadingMethods, setLoadingMethods] = useState(false)
  const [linkedMethodIds, setLinkedMethodIds] = useState<Set<string>>(new Set())
  const emptyPM: Omit<PaymentMethod, 'id'> = {
    company_id: form.company_id, label: '', holder_name: '', card_brand: '', bank_name: '', is_auto: false, notes: '',
  }
  const [pmForm, setPmForm] = useState<Omit<PaymentMethod, 'id'>>(emptyPM)
  const [addingMethod, setAddingMethod] = useState(false)
  const [savingMethod, setSavingMethod] = useState(false)
  const [linkingMethodId, setLinkingMethodId] = useState('')
  const [linkingMethod, setLinkingMethod] = useState(false)
  const [methodsError, setMethodsError] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'payments' || !vendorId || loadingMethods) return
    if (methods.length > 0 && linkedMethodIds.size >= 0) return
    setLoadingMethods(true)
    Promise.all([
      supabase.from('payment_methods').select('*').order('label'),
      supabase.from('vendor_payment_methods').select('payment_method_id').eq('vendor_id', vendorId),
    ]).then(([{ data: allMethods, error: methodsErr }, { data: links, error: linksErr }]) => {
      setMethods((allMethods as PaymentMethod[]) ?? [])
      setLinkedMethodIds(new Set((links ?? []).map((l: { payment_method_id: string }) => l.payment_method_id)))
      setMethodsError(linksErr?.message ?? methodsErr?.message ?? null)
      setLoadingMethods(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, vendorId])

  const companyMethods = methods.filter(m => m.company_id === form.company_id)
  const linkedMethods = companyMethods.filter(m => linkedMethodIds.has(m.id))
  const unlinkedMethods = companyMethods.filter(m => !linkedMethodIds.has(m.id))

  async function linkMethod(paymentMethodId: string) {
    if (!paymentMethodId || !vendorId) return
    setLinkingMethod(true)
    const { error } = await supabase.from('vendor_payment_methods').insert({
      vendor_id: vendorId, payment_method_id: paymentMethodId,
    })
    if (!error) {
      setLinkedMethodIds(s => new Set(s).add(paymentMethodId))
      setMethodsError(null)
    } else {
      setMethodsError(error.message)
    }
    setLinkingMethod(false)
    setLinkingMethodId('')
  }

  async function unlinkMethod(paymentMethodId: string) {
    if (!vendorId) return
    await supabase.from('vendor_payment_methods')
      .delete().eq('vendor_id', vendorId).eq('payment_method_id', paymentMethodId)
    setLinkedMethodIds(s => { const next = new Set(s); next.delete(paymentMethodId); return next })
  }

  async function saveMethod() {
    if (!pmForm.label.trim() || !vendorId) return
    setSavingMethod(true)
    const { data } = await supabase.from('payment_methods').insert({
      company_id:  form.company_id,
      label:       pmForm.label,
      holder_name: pmForm.holder_name || null,
      card_brand:  pmForm.card_brand  || null,
      bank_name:   pmForm.bank_name   || null,
      is_auto:     pmForm.is_auto,
      notes:       pmForm.notes || null,
    }).select().single()
    if (data) {
      setMethods(m => [...m, data as PaymentMethod])
      await linkMethod((data as PaymentMethod).id)
    }
    setSavingMethod(false)
    setAddingMethod(false)
    setPmForm({ ...emptyPM, company_id: form.company_id })
  }

  // Bills for this vendor (matched by provider name, read-only)
  const vendorBills = useMemo(() => {
    if (!form.name.trim()) return []
    return bills
      .filter(b => b.provider?.toLowerCase() === form.name.trim().toLowerCase())
      .sort((a, b) => (b.due_date ?? '').localeCompare(a.due_date ?? ''))
  }, [bills, form.name])

  function selectCompany(c: Company) {
    setForm(f => ({
      ...f,
      company_id: c,
      location_id: locations.some(l => l.id === f.location_id && l.company_id === c) ? f.location_id : null,
    }))
  }

  async function saveAccount() {
    if (!acctForm.account_number.trim() || !vendorId) return
    setSavingAcct(true)
    const { data } = await supabase.from('utility_service_accounts').insert({
      vendor_id: vendorId,
      account_number: acctForm.account_number.trim(),
      location_id: acctForm.location_id || null,
      service_label: acctForm.service_label || null,
      is_auto_pay: acctForm.is_auto_pay,
    }).select('*, utility_locations(*)').single()
    if (data) setAccounts(a => [...a, data as ServiceAccount])
    setSavingAcct(false)
    setAddingAccount(false)
    setAcctForm({ account_number: '', location_id: '', service_label: '', is_auto_pay: false })
  }

  async function deleteAccount(id: string) {
    await supabase.from('utility_service_accounts').delete().eq('id', id)
    setAccounts(a => a.filter(x => x.id !== id))
  }

  async function toggleAccountAutoPay(id: string, value: boolean) {
    const account = accounts.find(a => a.id === id)
    setAccounts(a => a.map(x => x.id === id ? { ...x, is_auto_pay: value } : x))
    await supabase.from('utility_service_accounts').update({ is_auto_pay: value }).eq('id', id)
    // See the identical comment in VendorDetailPanel's toggleAccountAutoPay:
    // the Dashboard reads is_auto_pay off each bill row, not the account, so
    // existing bills need updating too or the badge silently stays stale.
    if (account) {
      await supabase.from('utility_bills').update({ is_auto_pay: value })
        .eq('company_id', form.company_id).eq('account_number', account.account_number)
    }
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      company_id: form.company_id, name: form.name.trim(),
      service_type: form.service_type || null, notes: form.notes || null,
      contract_start: form.contract_start || null, contract_end: form.contract_end || null,
      website_url: form.website_url || null, billing_portal_url: form.billing_portal_url || null,
      location_id: form.location_id || null,
    }
    if ((initial as any).id) {
      await supabase.from('utility_vendors').update(payload).eq('id', (initial as any).id)
    } else {
      await supabase.from('utility_vendors').insert(payload)
    }
    setSaving(false)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{(initial as any).id ? 'Edit Vendor' : 'Add Vendor'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 flex gap-1 border-b border-gray-100">
          <button onClick={() => setTab('details')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'details' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>Details</button>
          <button onClick={() => setTab('accounts')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'accounts' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>Accounts{accounts.length > 0 ? ` (${accounts.length})` : ''}</button>
          <button onClick={() => setTab('payments')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'payments' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>Payment Methods{linkedMethods.length > 0 ? ` (${linkedMethods.length})` : ''}</button>
          <button onClick={() => setTab('bills')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'bills' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>Bills{vendorBills.length > 0 ? ` (${vendorBills.length})` : ''}</button>
        </div>

        {tab === 'details' && (
        <div className="p-6 space-y-4">
          {/* Company */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Company *</label>
            <div className="flex gap-2">
              {(['afs', 'tnt', 'zfs'] as Company[]).map(c => (
                <button key={c} onClick={() => selectCompany(c)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    form.company_id === c ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>{c.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
            {companyLocations.length === 0 ? (
              <p className="text-xs text-gray-400">No locations set up for this company yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setForm(f => ({ ...f, location_id: null }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    !form.location_id ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>None</button>
                {companyLocations.map(l => (
                  <button key={l.id} onClick={() => setForm(f => ({ ...f, location_id: l.id }))}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      form.location_id === l.id ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>{l.name}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Vendor Name *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. BC Hydro"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Service Type</label>
            <input type="text" value={form.service_type ?? ''} onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}
              placeholder="e.g. Electricity, Gas, Internet"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Website URL</label>
              <input type="url" value={form.website_url ?? ''} onChange={e => setForm(f => ({ ...f, website_url: e.target.value }))}
                placeholder="https://"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Billing Portal URL</label>
              <input type="url" value={form.billing_portal_url ?? ''} onChange={e => setForm(f => ({ ...f, billing_portal_url: e.target.value }))}
                placeholder="https://"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Contract Start</label>
              <input type="date" value={form.contract_start ?? ''} onChange={e => setForm(f => ({ ...f, contract_start: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Contract End</label>
              <input type="date" value={form.contract_end ?? ''} onChange={e => setForm(f => ({ ...f, contract_end: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
            <textarea rows={2} value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
        </div>
        )}

        {tab === 'accounts' && (
        <div className="p-6 space-y-3">
          {!vendorId ? (
            <p className="text-xs text-gray-400">Save the vendor first, then add accounts here.</p>
          ) : (
            <>
              {accounts.length === 0 && !addingAccount && (
                <p className="text-xs text-gray-400">No accounts yet.</p>
              )}
              <div className="space-y-2">
                {accounts.map(a => {
                  const loc = a.location_id ? companyLocations.find(l => l.id === a.location_id) : null
                  return (
                    <div key={a.id} className="group flex items-start justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-gray-800">{a.account_number}</span>
                          {a.service_label && <span className="text-xs text-gray-400">· {a.service_label}</span>}
                        </div>
                        {loc && <span className="text-xs text-gray-500">📍 {loc.name}</span>}
                        <label className="flex items-center gap-1.5 mt-1 cursor-pointer w-fit">
                          <input type="checkbox" checked={a.is_auto_pay}
                            onChange={e => toggleAccountAutoPay(a.id, e.target.checked)}
                            className="w-3.5 h-3.5 accent-blue-600" />
                          <span className={`text-xs ${a.is_auto_pay ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                            {a.is_auto_pay ? '⟳ Auto Pay' : 'Auto Pay'}
                          </span>
                        </label>
                      </div>
                      <button onClick={() => deleteAccount(a.id)}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs transition-opacity shrink-0 mt-0.5">
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>

              {addingAccount ? (
                <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                  <input type="text" placeholder="Account Number *" value={acctForm.account_number}
                    onChange={e => setAcctForm(f => ({ ...f, account_number: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  <input type="text" placeholder="Label (optional)" value={acctForm.service_label}
                    onChange={e => setAcctForm(f => ({ ...f, service_label: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  {companyLocations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setAcctForm(f => ({ ...f, location_id: '' }))}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                          !acctForm.location_id ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-white'
                        }`}>None</button>
                      {companyLocations.map(l => (
                        <button key={l.id} onClick={() => setAcctForm(f => ({ ...f, location_id: l.id }))}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                            acctForm.location_id === l.id ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-white'
                          }`}>{l.name}</button>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={acctForm.is_auto_pay}
                      onChange={e => setAcctForm(f => ({ ...f, is_auto_pay: e.target.checked }))}
                      className="w-3.5 h-3.5 accent-blue-600" />
                    Auto-pay
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => setAddingAccount(false)}
                      className="flex-1 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">Cancel</button>
                    <button onClick={saveAccount} disabled={savingAcct || !acctForm.account_number.trim()}
                      className="flex-1 py-1.5 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                      {savingAcct ? 'Saving…' : 'Add Account'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingAccount(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add Account</button>
              )}
            </>
          )}
        </div>
        )}

        {tab === 'payments' && (
        <div className="p-6 space-y-3">
          {!vendorId ? (
            <p className="text-xs text-gray-400">Save the vendor first, then add payment methods here.</p>
          ) : (
          <>
          <p className="text-xs text-gray-400 -mt-1">Payment methods linked to this vendor</p>
          {methodsError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
              {methodsError}
            </p>
          )}
          {loadingMethods ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : (
            <>
              {linkedMethods.length === 0 && (
                <p className="text-xs text-gray-400">No payment methods linked yet.</p>
              )}
              <div className="space-y-2">
                {linkedMethods.map(m => (
                  <div key={m.id} className="group flex items-start justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{m.label}</span>
                        {m.is_auto && <span className="text-xs text-blue-500">⟳ Auto</span>}
                      </div>
                      {m.holder_name && <div className="text-xs text-gray-500 mt-0.5">👤 {m.holder_name}</div>}
                      {m.card_brand && <div className="text-xs text-gray-500">💳 {m.card_brand}</div>}
                      {m.bank_name && <div className="text-xs text-gray-500">🏦 {m.bank_name}</div>}
                      {m.notes && <div className="text-xs text-gray-400 mt-0.5 italic">{m.notes}</div>}
                    </div>
                    <button onClick={() => unlinkMethod(m.id)}
                      title="Unlink from this vendor (the payment method itself isn't deleted)"
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs transition-opacity shrink-0 mt-0.5">
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {unlinkedMethods.length > 0 && (
                <div className="flex gap-2">
                  <select value={linkingMethodId} onChange={e => setLinkingMethodId(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                    <option value="">Select an existing payment method…</option>
                    {unlinkedMethods.map(m => (
                      <option key={m.id} value={m.id}>{m.label}{m.holder_name ? ` — ${m.holder_name}` : ''}</option>
                    ))}
                  </select>
                  <button onClick={() => linkMethod(linkingMethodId)} disabled={!linkingMethodId || linkingMethod}
                    className="px-3 py-1.5 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                    {linkingMethod ? 'Linking…' : 'Link'}
                  </button>
                </div>
              )}

              {addingMethod ? (
                <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                  <input type="text" placeholder="Label * (e.g. RBC Visa)" value={pmForm.label}
                    onChange={e => setPmForm(f => ({ ...f, label: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="Card Holder Name" value={pmForm.holder_name ?? ''}
                      onChange={e => setPmForm(f => ({ ...f, holder_name: e.target.value }))}
                      className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                    <input type="text" placeholder="Card Brand / Bank" value={pmForm.card_brand ?? ''}
                      onChange={e => setPmForm(f => ({ ...f, card_brand: e.target.value }))}
                      className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={pmForm.is_auto}
                      onChange={e => setPmForm(f => ({ ...f, is_auto: e.target.checked }))}
                      className="w-3.5 h-3.5 accent-blue-600" />
                    Auto-pay
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => setAddingMethod(false)}
                      className="flex-1 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">Cancel</button>
                    <button onClick={saveMethod} disabled={savingMethod || !pmForm.label.trim()}
                      className="flex-1 py-1.5 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                      {savingMethod ? 'Saving…' : 'Add Method'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setPmForm({ ...emptyPM, company_id: form.company_id }); setAddingMethod(true) }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ New payment method</button>
              )}
            </>
          )}
          </>
          )}
        </div>
        )}

        {tab === 'bills' && (
        <div className="p-6">
          {vendorBills.length === 0 ? (
            <p className="text-xs text-gray-400">No bills found for this vendor.</p>
          ) : (
            <div className="space-y-2">
              {vendorBills.map(b => {
                const status = computeBillStatus(b)
                const badge = STATUS_BADGE[status]
                return (
                  <div key={b.id} className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{b.utility_name}</div>
                      <div className="text-xs text-gray-400">
                        {b.account_number && <span className="font-mono">{b.account_number}</span>}
                        {b.account_number && b.due_date && ' · '}
                        {b.due_date && `Due ${fmtDate(b.due_date)}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-medium text-gray-800">
                        {b.amount != null ? `${b.currency === 'USD' ? 'US$' : 'CA$'}${b.amount.toFixed(2)}` : '—'}
                      </span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badge.className}`}>{badge.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving || !form.name.trim()}
            className="flex-1 px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
            {saving ? 'Saving…' : (initial as any).id ? 'Save Changes' : 'Add Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Vendors Content ──────────────────────────────────────────────────────

function VendorsContent() {
  const searchParams = useSearchParams()
  const urlCompany   = searchParams.get('company') as Company | null

  const [vendors,   setVendors]   = useState<Vendor[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [bills,     setBills]     = useState<Bill[]>([])
  const [loading,   setLoading]   = useState(true)
  const [role,      setRole]      = useState<Role>('admin')

  const [coFilter,   setCoFilter]   = useState<Company | 'all'>(urlCompany ?? 'afs')
  const [locFilter,  setLocFilter]  = useState<string>('all')
  const [search,     setSearch]     = useState('')
  const [selected,   setSelected]   = useState<Vendor | null>(null)
  const [showModal,  setShowModal]  = useState(false)
  const [editVendor, setEditVendor] = useState<Partial<Vendor> | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: v }, { data: l }, { data: b }] = await Promise.all([
      supabase.from('utility_vendors').select(`
        *,
        utility_vendor_contacts(*),
        utility_service_accounts(*, utility_locations(*)),
        utility_document_links(*)
      `).order('name'),
      supabase.from('utility_locations').select('*').order('company_id').order('name'),
      supabase.from('utility_bills').select('id, provider, amount, currency, due_date, is_paid, issue_date, utility_name, bill_number, account_number, balance_status, invoice_status'),
    ])
    setVendors((v as Vendor[]) ?? [])
    setLocations(sortLocations((l as Location[]) ?? []))
    setBills((b as Bill[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (urlCompany) setCoFilter(urlCompany) }, [urlCompany])

  // Re-sync selected vendor after refresh
  useEffect(() => {
    if (selected) {
      const updated = vendors.find(v => v.id === selected.id)
      if (updated) setSelected(updated)
    }
  }, [vendors])

  const filteredLocations = locations.filter(l =>
    coFilter === 'all' ? true : l.company_id === coFilter
  )

  const filtered = useMemo(() => vendors.filter(v => {
    if (coFilter !== 'all' && v.company_id !== coFilter) return false
    if (locFilter !== 'all') {
      const hasLoc = v.location_id === locFilter ||
        v.utility_service_accounts.some(a => a.location_id === locFilter)
      if (!hasLoc) return false
    }
    if (search) {
      const q = search.toLowerCase()
      return v.name.toLowerCase().includes(q) ||
        (v.service_type ?? '').toLowerCase().includes(q) ||
        v.utility_vendor_contacts.some(c => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q)) ||
        v.utility_service_accounts.some(a => a.account_number.toLowerCase().includes(q))
    }
    return true
  }), [vendors, coFilter, locFilter, search])

  async function deleteVendor(id: string) {
    await supabase.from('utility_vendors').delete().eq('id', id)
    setDelConfirm(null)
    if (selected?.id === id) setSelected(null)
    load()
  }

  const { copy, copiedId } = useCopy()

  const panelOpen = selected !== null

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main list area ── */}
      <div className={`flex flex-col overflow-hidden transition-all duration-200 ${panelOpen ? 'w-[58%]' : 'flex-1'}`}>
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 bg-white flex items-center gap-2 flex-wrap">
          {/* Company filter */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['all', 'afs', 'tnt', 'zfs'] as (Company | 'all')[]).map(c => (
              <button key={c} onClick={() => { setCoFilter(c); setLocFilter('all') }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  coFilter === c ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {c === 'all' ? 'All' : c.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Location filter */}
          <select value={locFilter} onChange={e => setLocFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="all">All Locations</option>
            {filteredLocations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          {/* Search */}
          <input type="text" placeholder="Search vendors, accounts…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />

          {role === 'admin' && (
            <button onClick={() => { setEditVendor(null); setShowModal(true) }}
              className="px-4 py-1.5 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors shrink-0">
              + Add Vendor
            </button>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-14 bg-white rounded-xl animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">No vendors found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Account #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg / mo</th>
                  {role === 'admin' && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filtered.map(v => {
                  const primaryContact = v.utility_vendor_contacts.find(c => c.is_primary)
                    ?? v.utility_vendor_contacts[0] ?? null
                  const firstAccount = v.utility_service_accounts.find(a => a.is_active)
                    ?? v.utility_service_accounts[0] ?? null
                  const vendorBills = bills.filter(b => b.provider?.toLowerCase() === v.name.toLowerCase())
                  const avgAmt = vendorBills.length
                    ? vendorBills.reduce((s, b) => s + toCAD(b.amount, b.currency), 0) / vendorBills.length
                    : null
                  const isSelected = selected?.id === v.id

                  return (
                    <tr key={v.id}
                      onClick={() => setSelected(isSelected ? null : v)}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${CO_BADGE[v.company_id]}`}>
                            {v.company_id.toUpperCase()}
                          </span>
                          <span className="font-medium text-gray-900 truncate max-w-[140px]">{v.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{v.service_type ?? '—'}</td>
                      <td className="px-4 py-3">
                        {firstAccount ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <span className="font-mono text-xs text-gray-800">{firstAccount.account_number}</span>
                            <CopyBtn text={firstAccount.account_number} id={`row-acct-${firstAccount.id}`} copiedId={copiedId} copy={copy} />
                            {v.utility_service_accounts.length > 1 && (
                              <span className="text-[10px] text-gray-400">+{v.utility_service_accounts.length - 1}</span>
                            )}
                          </div>
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {primaryContact ? (
                          <div onClick={e => e.stopPropagation()}>
                            <p className="text-xs text-gray-700 truncate max-w-[130px]">{primaryContact.name}</p>
                            {primaryContact.email && (
                              <a href={`mailto:${primaryContact.email}`}
                                className="text-xs text-blue-600 hover:underline truncate max-w-[130px] block">
                                {primaryContact.email}
                              </a>
                            )}
                            {primaryContact.phone && (
                              <a href={`tel:${primaryContact.phone}`} className="text-xs text-gray-500 hover:text-gray-700">
                                {primaryContact.phone}
                              </a>
                            )}
                          </div>
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">
                        {avgAmt !== null ? fmtCAD(avgAmt) : '—'}
                      </td>
                      {role === 'admin' && (
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setEditVendor(v); setShowModal(true) }}
                              className="text-xs text-gray-500 hover:text-gray-800 transition-colors">Edit</button>
                            {delConfirm === v.id ? (
                              <div className="flex gap-1">
                                <button onClick={() => deleteVendor(v.id)} className="text-xs text-red-600 font-medium hover:text-red-800">Del</button>
                                <button onClick={() => setDelConfirm(null)} className="text-xs text-gray-400">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => setDelConfirm(v.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Delete</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        <div className="px-4 py-2 border-t border-gray-100 bg-white text-xs text-gray-400">
          {filtered.length} of {vendors.length} vendors
        </div>
      </div>

      {/* ── Detail Panel ── */}
      {panelOpen && selected && (
        <div className="flex-1 border-l border-gray-200 overflow-hidden">
          <VendorDetailPanel
            vendor={selected}
            locations={locations}
            bills={bills}
            role={role}
            onClose={() => setSelected(null)}
            onRefresh={load}
          />
        </div>
      )}

      {/* ── Modal ── */}
      {showModal && (
        <VendorModal
          initial={editVendor ?? {}}
          locations={locations}
          bills={bills}
          onClose={() => { setShowModal(false); setEditVendor(null) }}
          onSave={() => { setShowModal(false); setEditVendor(null); load() }}
        />
      )}
    </div>
  )
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function VendorsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">Loading…</div>}>
      <VendorsContent />
    </Suspense>
  )
}
