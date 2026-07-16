'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

// ── Types ──────────────────────────────────────────────────────────────────────

type Company = 'afs' | 'tnt' | 'zfs'
type Currency = 'CAD' | 'USD'
type Role = 'admin' | 'ap'
type MainTab = 'bills' | 'calendar' | 'vendor' | 'analytics'

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

interface Bill {
  id: string
  company_id: Company
  utility_name: string
  provider: string | null
  amount: number | null
  currency: Currency
  issue_date: string | null
  due_date: string | null
  billing_period: string | null
  billing_month: number | null
  bill_number: string | null
  account_number: string | null
  is_auto_pay: boolean
  payment_method_id: string | null
  onedrive_file_url: string | null
  is_paid: boolean
  paid_at: string | null
  paid_by: string | null
  notes: string | null
  created_at: string
  payment_methods?: PaymentMethod | null
}

const COMPANIES: { id: Company | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'afs', label: 'AFS' },
  { id: 'tnt', label: 'TNT' },
  { id: 'zfs', label: 'ZFS' },
]

const CO_COLORS: Record<Company, string> = {
  afs: 'bg-blue-100 text-blue-700',
  tnt: 'bg-amber-100 text-amber-700',
  zfs: 'bg-emerald-100 text-emerald-700',
}

const STATUS_FILTER = ['all', 'unpaid', 'paid', 'overdue'] as const
type StatusFilter = typeof STATUS_FILTER[number]

// ── Helpers ────────────────────────────────────────────────────────────────────

function isOverdue(bill: Bill) {
  if (bill.is_paid || !bill.due_date) return false
  return new Date(bill.due_date) < new Date(new Date().toDateString())
}

function daysUntilDue(bill: Bill): number | null {
  if (!bill.due_date) return null
  const today = new Date(new Date().toDateString())
  const due   = new Date(bill.due_date)
  return Math.ceil((due.getTime() - today.getTime()) / 86400000)
}

function dueDateLabel(bill: Bill) {
  if (!bill.due_date) return '—'
  const days = daysUntilDue(bill)!
  const fmt = new Date(bill.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (bill.is_paid) return fmt
  if (days < 0)   return `${fmt} (${Math.abs(days)}d overdue)`
  if (days === 0) return `${fmt} (Today)`
  if (days <= 7)  return `${fmt} (${days}d left)`
  return fmt
}

function dueDateColor(bill: Bill) {
  if (bill.is_paid) return 'text-gray-400'
  const days = daysUntilDue(bill)
  if (days === null) return 'text-gray-500'
  if (days < 0)   return 'text-red-600 font-semibold'
  if (days <= 3)  return 'text-red-500 font-medium'
  if (days <= 7)  return 'text-amber-600 font-medium'
  return 'text-gray-700'
}

function fmtAmt(bill: Bill) {
  if (bill.amount == null) return '—'
  return `${bill.currency === 'USD' ? 'US$' : 'CA$'}${bill.amount.toFixed(2)}`
}

function fmtShortDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const emptyBill: Omit<Bill, 'id' | 'created_at' | 'payment_methods'> = {
  company_id: 'afs',
  utility_name: '',
  provider: '',
  amount: null,
  currency: 'CAD',
  issue_date: '',
  due_date: '',
  billing_period: '',
  billing_month: null,
  bill_number: '',
  account_number: '',
  is_auto_pay: false,
  payment_method_id: null,
  onedrive_file_url: '',
  is_paid: false,
  paid_at: null,
  paid_by: null,
  notes: '',
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function UtilityPage() {
  const { user } = useAuth()
  const [role,    setRole]    = useState<Role>('admin')
  const [bills,   setBills]   = useState<Bill[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)

  const [mainTab,      setMainTab]      = useState<MainTab>('bills')
  const [coFilter,     setCoFilter]     = useState<Company | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchTerm,   setSearchTerm]   = useState('')

  const [showModal,     setShowModal]     = useState(false)
  const [editBill,      setEditBill]      = useState<Partial<Bill>>(emptyBill)
  const [editingId,     setEditingId]     = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [noteEdit,      setNoteEdit]      = useState<{ id: string; value: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [showPMModal,   setShowPMModal]   = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('utility_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setRole((data?.role as Role) ?? 'admin'))
  }, [user])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('utility_bills')
      .select('*, payment_methods(*)')
      .order('due_date', { ascending: true, nullsFirst: false })
    setBills((data as Bill[]) ?? [])
    const { data: pm } = await supabase.from('payment_methods').select('*').order('label')
    setMethods((pm as PaymentMethod[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = bills.filter(b => {
    if (coFilter !== 'all' && b.company_id !== coFilter) return false
    if (statusFilter === 'paid'    && !b.is_paid) return false
    if (statusFilter === 'unpaid'  && (b.is_paid || isOverdue(b))) return false
    if (statusFilter === 'overdue' && !isOverdue(b)) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      if (!b.utility_name.toLowerCase().includes(q) &&
          !(b.provider ?? '').toLowerCase().includes(q) &&
          !(b.bill_number ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const today = new Date(new Date().toDateString())
  const inSevenDays = new Date(today.getTime() + 7 * 86400000)

  const overdueBills  = bills.filter(isOverdue)
  const upcomingBills = bills.filter(b => {
    if (b.is_paid || isOverdue(b) || !b.due_date) return false
    const due = new Date(b.due_date)
    return due >= today && due <= inSevenDays
  })

  const stats = {
    total:   bills.length,
    unpaid:  bills.filter(b => !b.is_paid && !isOverdue(b)).length,
    overdue: overdueBills.length,
    paid:    bills.filter(b => b.is_paid).length,
  }

  async function togglePaid(bill: Bill) {
    const newPaid = !bill.is_paid
    await supabase.from('utility_bills').update({
      is_paid: newPaid,
      paid_at: newPaid ? new Date().toISOString() : null,
      paid_by: newPaid ? (user?.email ?? null) : null,
    }).eq('id', bill.id)
    setBills(prev => prev.map(b =>
      b.id === bill.id
        ? { ...b, is_paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null, paid_by: newPaid ? (user?.email ?? null) : null }
        : b
    ))
  }

  async function saveNote(id: string, notes: string) {
    await supabase.from('utility_bills').update({ notes }).eq('id', id)
    setBills(prev => prev.map(b => b.id === id ? { ...b, notes } : b))
    setNoteEdit(null)
  }

  async function saveBill() {
    if (!editBill.utility_name?.trim()) return
    setSaving(true)
    const payload = {
      company_id:        editBill.company_id,
      utility_name:      editBill.utility_name,
      provider:          editBill.provider || null,
      amount:            editBill.amount ?? null,
      currency:          editBill.currency,
      issue_date:        editBill.issue_date || null,
      due_date:          editBill.due_date || null,
      billing_period:    editBill.billing_period || null,
      billing_month:     editBill.due_date
                           ? new Date(editBill.due_date + 'T00:00:00').getMonth() + 1
                           : null,
      bill_number:       editBill.bill_number || null,
      account_number:    editBill.account_number || null,
      is_auto_pay:       editBill.is_auto_pay ?? false,
      payment_method_id: editBill.payment_method_id || null,
      onedrive_file_url: editBill.onedrive_file_url || null,
      notes:             editBill.notes || null,
    }
    if (editingId) {
      await supabase.from('utility_bills').update(payload).eq('id', editingId)
    } else {
      await supabase.from('utility_bills').insert({ ...payload, is_paid: false })
    }
    setSaving(false)
    setShowModal(false)
    setEditingId(null)
    setEditBill(emptyBill)
    load()
  }

  async function deleteBill(id: string) {
    await supabase.from('utility_bills').delete().eq('id', id)
    setBills(prev => prev.filter(b => b.id !== id))
    setDeleteConfirm(null)
  }

  function openEdit(bill: Bill) {
    setEditBill(bill)
    setEditingId(bill.id)
    setShowModal(true)
  }

  return (
    <div className="p-6 min-h-full bg-gray-50">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Utility Bills</h1>
          <p className="text-sm text-gray-400 mt-0.5">AFS · TNT · ZFS — {role === 'ap' ? 'AP View' : 'Admin'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPMModal(true)}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors"
          >
            💳 Payment Methods
          </button>
          {role === 'admin' && (
            <button
              onClick={() => { setEditBill(emptyBill); setEditingId(null); setShowModal(true) }}
              className="px-3 py-1.5 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors"
            >
              + Add Bill
            </button>
          )}
        </div>
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1 mb-5 w-fit">
        {([
          ['bills',     '📋 Bills'],
          ['calendar',  '📅 Calendar'],
          ['vendor',    '🏢 Vendors'],
          ['analytics', '📊 Analytics'],
        ] as [MainTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`px-5 py-2 rounded-md text-base font-medium transition-colors ${
              mainTab === tab ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── BILLS TAB ────────────────────────────────────────────────────────── */}
      {mainTab === 'bills' && (
        <>
          {/* Stats row — clickable to filter */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Total',   value: stats.total,   color: 'text-gray-700',    bg: 'bg-white',      sf: 'all'     as StatusFilter },
              { label: 'Unpaid',  value: stats.unpaid,  color: 'text-amber-600',   bg: 'bg-amber-50',   sf: 'unpaid'  as StatusFilter },
              { label: 'Overdue', value: stats.overdue, color: 'text-red-600',     bg: 'bg-red-50',     sf: 'overdue' as StatusFilter },
              { label: 'Paid',    value: stats.paid,    color: 'text-emerald-600', bg: 'bg-emerald-50', sf: 'paid'    as StatusFilter },
            ].map(s => (
              <button
                key={s.label}
                onClick={() => setStatusFilter(s.sf)}
                className={`${s.bg} rounded-xl border border-gray-200 px-4 py-3 text-left hover:shadow-sm transition-shadow ${statusFilter === s.sf ? 'ring-2 ring-gray-900' : ''}`}
              >
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </button>
            ))}
          </div>

          {/* Overdue + Upcoming alert panels */}
          {(overdueBills.length > 0 || upcomingBills.length > 0) && (
            <div className={`grid gap-3 mb-5 ${overdueBills.length > 0 && upcomingBills.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
              {overdueBills.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="text-red-600 font-semibold text-sm mb-2.5">🚨 Overdue ({overdueBills.length})</div>
                  <div className="space-y-2">
                    {overdueBills.map(b => (
                      <div key={b.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-xs font-bold ${CO_COLORS[b.company_id]}`}>{b.company_id.toUpperCase()}</span>
                          <span className="text-xs font-medium text-gray-800 truncate">{b.utility_name}</span>
                          {b.provider && <span className="text-xs text-gray-400 hidden sm:inline">· {b.provider}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-semibold text-red-600">{fmtAmt(b)}</span>
                          <span className="text-xs text-red-500">{dueDateLabel(b)}</span>
                          <input type="checkbox" checked={false} onChange={() => togglePaid(b)} className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" title="Mark paid" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {upcomingBills.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="text-amber-700 font-semibold text-sm mb-2.5">⏰ Due This Week ({upcomingBills.length})</div>
                  <div className="space-y-2">
                    {upcomingBills.map(b => (
                      <div key={b.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-xs font-bold ${CO_COLORS[b.company_id]}`}>{b.company_id.toUpperCase()}</span>
                          <span className="text-xs font-medium text-gray-800 truncate">{b.utility_name}</span>
                          {b.provider && <span className="text-xs text-gray-400 hidden sm:inline">· {b.provider}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium text-gray-800">{fmtAmt(b)}</span>
                          <span className={`text-xs ${dueDateColor(b)}`}>{dueDateLabel(b)}</span>
                          <input type="checkbox" checked={false} onChange={() => togglePaid(b)} className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" title="Mark paid" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
              {COMPANIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCoFilter(c.id as Company | 'all')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    coFilter === c.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
              {STATUS_FILTER.map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors capitalize ${
                    statusFilter === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search utility / provider / bill #…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="ml-auto px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 w-60"
            />
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400">No bills found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Co</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Utility</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Bill #</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Account</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Issued</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid</th>
                      {role === 'admin' && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(bill => (
                      <tr key={bill.id} className={`hover:bg-gray-50 transition-colors ${bill.is_paid ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${CO_COLORS[bill.company_id]}`}>
                            {bill.company_id.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{bill.utility_name}</div>
                          {bill.billing_period && <div className="text-xs text-gray-400">{bill.billing_period}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{bill.bill_number ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{bill.provider ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{bill.account_number ?? '—'}</td>
                        <td className="px-4 py-3">
                          {bill.amount != null
                            ? <span className="font-medium text-gray-900">{fmtAmt(bill)}</span>
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtShortDate(bill.issue_date)}</td>
                        <td className={`px-4 py-3 text-xs ${dueDateColor(bill)}`}>{dueDateLabel(bill)}</td>
                        <td className="px-4 py-3">
                          {bill.payment_methods ? (
                            <div>
                              <div className="text-xs font-medium text-gray-700">
                                {bill.is_auto_pay && <span className="text-blue-500 mr-1">⟳</span>}
                                {bill.payment_methods.label}
                              </div>
                              {bill.payment_methods.holder_name && (
                                <div className="text-xs text-gray-400">{bill.payment_methods.holder_name}</div>
                              )}
                            </div>
                          ) : bill.is_auto_pay ? (
                            <span className="text-xs text-blue-500">⟳ Auto</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          {noteEdit?.id === bill.id ? (
                            <div className="flex gap-1">
                              <input
                                autoFocus
                                value={noteEdit.value}
                                onChange={e => setNoteEdit({ id: bill.id, value: e.target.value })}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveNote(bill.id, noteEdit.value)
                                  if (e.key === 'Escape') setNoteEdit(null)
                                }}
                                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-900 min-w-0"
                              />
                              <button onClick={() => saveNote(bill.id, noteEdit.value)} className="text-emerald-600 text-xs font-bold">✓</button>
                              <button onClick={() => setNoteEdit(null)} className="text-gray-400 text-xs">✕</button>
                            </div>
                          ) : (
                            <div
                              onClick={() => setNoteEdit({ id: bill.id, value: bill.notes ?? '' })}
                              className="text-xs text-gray-500 cursor-pointer hover:text-gray-800 truncate group"
                              title={bill.notes ?? 'Click to add note'}
                            >
                              {bill.notes
                                ? <span>{bill.notes}</span>
                                : <span className="text-gray-300 group-hover:text-gray-400">+ note</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={bill.is_paid}
                            onChange={() => togglePaid(bill)}
                            className="w-4 h-4 accent-emerald-600 cursor-pointer"
                            title={bill.paid_at
                              ? `Paid on ${new Date(bill.paid_at).toLocaleDateString()} by ${bill.paid_by ?? 'unknown'}`
                              : 'Mark as paid'}
                          />
                        </td>
                        {role === 'admin' && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {bill.onedrive_file_url && (
                                <a href={bill.onedrive_file_url} target="_blank" rel="noreferrer"
                                  className="p-1 text-gray-400 hover:text-blue-500 transition-colors" title="Open file">📎</a>
                              )}
                              <button onClick={() => openEdit(bill)} className="p-1 text-gray-400 hover:text-gray-700 transition-colors" title="Edit">✏️</button>
                              {deleteConfirm === bill.id ? (
                                <span className="flex items-center gap-1 text-xs">
                                  <button onClick={() => deleteBill(bill.id)} className="text-red-600 font-semibold">Del</button>
                                  <button onClick={() => setDeleteConfirm(null)} className="text-gray-400">✕</button>
                                </span>
                              ) : (
                                <button onClick={() => setDeleteConfirm(bill.id)} className="p-1 text-gray-300 hover:text-red-400 transition-colors" title="Delete">🗑</button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {role === 'ap' && (
            <p className="text-xs text-gray-400 mt-3 text-center">
              AP view — you can mark bills as paid and add notes. Contact admin to add or edit bills.
            </p>
          )}
        </>
      )}

      {/* ── CALENDAR TAB ───────────────────────────────────────────────────── */}
      {mainTab === 'calendar' && <CalendarTab bills={bills} onTogglePaid={togglePaid} />}

      {/* ── VENDOR TAB ─────────────────────────────────────────────────────── */}
      {mainTab === 'vendor' && <VendorTab role={role} />}

      {/* ── ANALYTICS TAB ──────────────────────────────────────────────────── */}
      {mainTab === 'analytics' && <AnalyticsTab bills={bills} />}

      {/* ── Add/Edit Bill Modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{editingId ? 'Edit Bill' : 'Add Bill'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">

              {/* Company + Currency */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Company</label>
                  <select
                    value={editBill.company_id}
                    onChange={e => setEditBill(b => ({ ...b, company_id: e.target.value as Company }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="afs">AFS</option>
                    <option value="tnt">TNT</option>
                    <option value="zfs">ZFS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label>
                  <select
                    value={editBill.currency}
                    onChange={e => setEditBill(b => ({ ...b, currency: e.target.value as Currency }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="CAD">CAD (CA$)</option>
                    <option value="USD">USD (US$)</option>
                  </select>
                </div>
              </div>

              {/* Utility name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Utility Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Electricity, Gas, Internet"
                  value={editBill.utility_name ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, utility_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              {/* Provider + Account Number */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. BC Hydro"
                    value={editBill.provider ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, provider: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Account Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 1234567890"
                    value={editBill.account_number ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, account_number: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>

              {/* Bill Number */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Bill Number</label>
                <input
                  type="text"
                  placeholder="e.g. INV-2026-001"
                  value={editBill.bill_number ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, bill_number: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={editBill.amount ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, amount: e.target.value ? parseFloat(e.target.value) : null }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              {/* Issue date + Due date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={editBill.issue_date ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, issue_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={editBill.due_date ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, due_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>

              {/* Billing period */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Billing Period</label>
                <input
                  type="text"
                  placeholder="e.g. Jun 2026"
                  value={editBill.billing_period ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, billing_period: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              {/* Payment method */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Payment Method</label>
                <select
                  value={editBill.payment_method_id ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, payment_method_id: e.target.value || null }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="">— None —</option>
                  {methods
                    .filter(m => !editBill.company_id || m.company_id === editBill.company_id)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.label}{m.holder_name ? ` (${m.holder_name})` : ''}{m.is_auto ? ' ⟳' : ''}
                      </option>
                    ))
                  }
                </select>
              </div>

              {/* Auto pay */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto_pay"
                  checked={editBill.is_auto_pay ?? false}
                  onChange={e => setEditBill(b => ({ ...b, is_auto_pay: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600"
                />
                <label htmlFor="auto_pay" className="text-sm text-gray-700">Auto-pay enabled</label>
              </div>

              {/* OneDrive URL */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">OneDrive File Link</label>
                <input
                  type="url"
                  placeholder="https://…sharepoint.com/…"
                  value={editBill.onedrive_file_url ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, onedrive_file_url: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Any special notes…"
                  value={editBill.notes ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveBill}
                disabled={saving || !editBill.utility_name?.trim()}
                className="px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors"
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Bill'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPMModal && (
        <PaymentMethodsModal
          methods={methods}
          role={role}
          onClose={() => setShowPMModal(false)}
          onSave={() => { setShowPMModal(false); load() }}
        />
      )}
    </div>
  )
}

// ── Analytics Tab ──────────────────────────────────────────────────────────────

function AnalyticsTab({ bills }: { bills: Bill[] }) {
  const utilities = useMemo(() => {
    const map = new Map<string, Bill[]>()
    for (const b of bills) {
      const key = `${b.company_id}::${b.utility_name}::${b.account_number ?? ''}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return Array.from(map.entries()).map(([key, bs]) => {
      const sorted = [...bs].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      const overdueCount = bs.filter(b => {
        if (!b.due_date) return false
        if (b.is_paid && b.paid_at) return b.paid_at > b.due_date
        return !b.is_paid && new Date(b.due_date) < new Date()
      }).length
      const amounts = sorted.filter(b => b.amount != null).map(b => b.amount!)
      const maxAmt = amounts.length ? Math.max(...amounts) : 0
      const minAmt = amounts.length ? Math.min(...amounts) : 0
      const avgAmt = amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0
      return { key, company_id: bs[0].company_id as Company, utility_name: bs[0].utility_name, provider: bs[0].provider, account_number: bs[0].account_number, bills: sorted, overdueCount, maxAmt, minAmt, avgAmt }
    })
  }, [bills])

  if (bills.length === 0) {
    return <div className="py-16 text-center text-sm text-gray-400">No bills data yet.</div>
  }

  return (
    <div className="space-y-4">
      {utilities.map(({ key, company_id, utility_name, provider, account_number, bills: bs, overdueCount, maxAmt, minAmt, avgAmt }) => (
        <div key={key} className="bg-white rounded-xl border border-gray-200 p-5">
          {/* Utility header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${CO_COLORS[company_id]}`}>
                {company_id.toUpperCase()}
              </span>
              <span className="font-semibold text-gray-900">{utility_name}</span>
              {provider && <span className="text-xs text-gray-400">· {provider}</span>}
              {account_number && <span className="text-xs text-gray-400 font-mono">({account_number})</span>}
            </div>
            <div className="flex items-center gap-2 text-xs">
              {overdueCount > 0 && (
                <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">
                  ⚠ {overdueCount}x overdue
                </span>
              )}
              {bs.some(b => b.is_auto_pay) && (
                <span className="text-blue-500 font-medium">⟳ Auto-pay</span>
              )}
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Avg Amount', value: avgAmt > 0 ? `${bs[0].currency === 'USD' ? 'US$' : 'CA$'}${avgAmt.toFixed(2)}` : '—' },
              { label: 'Range', value: maxAmt > 0 ? `${bs[0].currency === 'USD' ? 'US$' : 'CA$'}${minAmt.toFixed(2)} – ${maxAmt.toFixed(2)}` : '—' },
              { label: 'Entries', value: bs.length },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-500 mb-0.5">{s.label}</div>
                <div className="text-sm font-semibold text-gray-800">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Amount history table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2 pr-3 font-medium">Period</th>
                  <th className="text-left pb-2 pr-3 font-medium">Bill #</th>
                  <th className="text-left pb-2 pr-3 font-medium">Issued</th>
                  <th className="text-left pb-2 pr-3 font-medium">Due</th>
                  <th className="text-right pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 font-medium w-36">Trend</th>
                  <th className="text-center pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {bs.slice(-10).map(b => {
                  const pct = maxAmt > 0 && b.amount != null ? (b.amount / maxAmt) * 100 : 0
                  const wasLate = b.is_paid && b.paid_at && b.due_date && b.paid_at > b.due_date
                  const isCurrentlyOverdue = !b.is_paid && b.due_date && new Date(b.due_date) < new Date()
                  return (
                    <tr key={b.id}>
                      <td className="py-2 pr-3 text-gray-600">{b.billing_period ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-gray-500">{b.bill_number ?? '—'}</td>
                      <td className="py-2 pr-3 text-gray-500">{fmtShortDate(b.issue_date)}</td>
                      <td className="py-2 pr-3 text-gray-500">{fmtShortDate(b.due_date)}</td>
                      <td className="py-2 pr-4 text-right font-semibold text-gray-800">
                        {b.amount != null ? fmtAmt(b) : '—'}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="bg-gray-100 rounded-full h-2 w-36">
                          <div
                            className="h-2 rounded-full bg-blue-400 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-2 text-center">
                        {b.is_paid && !wasLate  && <span className="text-emerald-600 font-bold" title="Paid on time">✓</span>}
                        {wasLate                 && <span className="text-amber-500 font-bold"   title="Paid late">⚠</span>}
                        {isCurrentlyOverdue      && <span className="text-red-600 font-bold"     title="Overdue">!</span>}
                        {!b.is_paid && !isCurrentlyOverdue && <span className="text-gray-400" title="Pending">·</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Calendar Tab ───────────────────────────────────────────────────────────────

function CalendarTab({ bills, onTogglePaid }: { bills: Bill[]; onTogglePaid: (b: Bill) => void }) {
  const todayReal = new Date()
  const [year,     setYear]     = useState(todayReal.getFullYear())
  const [month,    setMonth]    = useState(todayReal.getMonth())
  const [selected, setSelected] = useState<number | null>(null)

  const firstDow   = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  function dateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const billsByDue = useMemo(() => {
    const map = new Map<string, Bill[]>()
    for (const b of bills) {
      if (b.due_date) {
        if (!map.has(b.due_date)) map.set(b.due_date, [])
        map.get(b.due_date)!.push(b)
      }
    }
    return map
  }, [bills])

  const billsByIssue = useMemo(() => {
    const map = new Map<string, Bill[]>()
    for (const b of bills) {
      if (b.issue_date) {
        if (!map.has(b.issue_date)) map.set(b.issue_date, [])
        map.get(b.issue_date)!.push(b)
      }
    }
    return map
  }, [bills])

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
    setSelected(null)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
    setSelected(null)
  }

  const monthLabel = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const selectedDue    = selected ? (billsByDue.get(dateKey(selected))    ?? []) : []
  const selectedIssued = selected ? (billsByIssue.get(dateKey(selected))  ?? []) : []

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="px-4 py-2 text-base border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors">‹</button>
        <span className="font-semibold text-gray-800 text-xl">{monthLabel}</span>
        <button onClick={nextMonth} className="px-4 py-2 text-base border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors">›</button>
      </div>

      {/* Grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-3 text-center text-sm font-semibold text-gray-500">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={i} className="border-r border-b border-gray-100 min-h-[80px] bg-gray-50/50" />
            }
            const key = dateKey(day)
            const dueBills    = billsByDue.get(key)    ?? []
            const issuedBills = billsByIssue.get(key)  ?? []
            const isToday = day === todayReal.getDate() && month === todayReal.getMonth() && year === todayReal.getFullYear()
            const isSelected = selected === day

            return (
              <div
                key={i}
                onClick={() => setSelected(isSelected ? null : day)}
                className={`border-r border-b border-gray-100 min-h-[100px] p-2 cursor-pointer transition-colors ${
                  isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className={`text-sm font-semibold mb-1 w-7 h-7 flex items-center justify-center rounded-full ${
                  isToday ? 'bg-gray-900 text-white' : 'text-gray-600'
                }`}>
                  {day}
                </div>
                {issuedBills.slice(0, 2).map(b => (
                  <div key={`i-${b.id}`}
                    className="text-xs leading-tight px-1 py-0.5 mb-0.5 rounded bg-blue-100 text-blue-700 truncate"
                    title={`Issued: ${b.utility_name}`}
                  >
                    ● {b.utility_name}
                  </div>
                ))}
                {dueBills.slice(0, 3 - issuedBills.slice(0,2).length).map(b => (
                  <div key={`d-${b.id}`}
                    className={`text-xs leading-tight px-1 py-0.5 mb-0.5 rounded truncate ${
                      b.is_paid ? 'bg-emerald-100 text-emerald-700' :
                      isOverdue(b) ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}
                    title={`Due: ${b.utility_name}${b.amount != null ? ` (${fmtAmt(b)})` : ''}`}
                  >
                    ⏰ {b.utility_name}
                  </div>
                ))}
                {(dueBills.length + issuedBills.length) > 3 && (
                  <div className="text-xs text-gray-400 px-1">+{dueBills.length + issuedBills.length - 3} more</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selected !== null && (selectedDue.length > 0 || selectedIssued.length > 0) && (
        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
          <div className="font-semibold text-gray-800 mb-3 text-base">
            {new Date(year, month, selected).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>

          {selectedIssued.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-2">Issued</div>
              <div className="space-y-2">
                {selectedIssued.map(b => (
                  <div key={b.id} className="flex items-center gap-2 text-base">
                    <span className={`px-2 py-0.5 rounded-full text-sm font-bold ${CO_COLORS[b.company_id]}`}>{b.company_id.toUpperCase()}</span>
                    <span className="font-medium text-gray-900">{b.utility_name}</span>
                    {b.provider && <span className="text-gray-400 text-sm">· {b.provider}</span>}
                    {b.bill_number && <span className="text-gray-400 text-sm font-mono">#{b.bill_number}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedDue.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-amber-600 uppercase tracking-wide mb-2">Due</div>
              <div className="space-y-2">
                {selectedDue.map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-base min-w-0">
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-sm font-bold ${CO_COLORS[b.company_id]}`}>{b.company_id.toUpperCase()}</span>
                      <span className="font-medium text-gray-900 truncate">{b.utility_name}</span>
                      {b.provider && <span className="text-gray-400 text-sm hidden sm:inline">· {b.provider}</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-base font-medium text-gray-800">{fmtAmt(b)}</span>
                      <span className={`text-sm font-medium ${b.is_paid ? 'text-emerald-600' : isOverdue(b) ? 'text-red-600' : 'text-amber-600'}`}>
                        {b.is_paid ? '✓ Paid' : isOverdue(b) ? 'Overdue' : 'Unpaid'}
                      </span>
                      <input
                        type="checkbox"
                        checked={b.is_paid}
                        onChange={() => onTogglePaid(b)}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-100 inline-block" />Issued</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-100 inline-block" />Due (unpaid)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 inline-block" />Overdue</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-100 inline-block" />Paid</span>
      </div>
    </div>
  )
}

// ── Payment Methods Modal ──────────────────────────────────────────────────────

function PaymentMethodsModal({
  methods, role, onClose, onSave
}: {
  methods: PaymentMethod[]
  role: Role
  onClose: () => void
  onSave: () => void
}) {
  const emptyPM: Omit<PaymentMethod, 'id'> = {
    company_id: 'afs', label: '', holder_name: '', card_brand: '', bank_name: '', is_auto: false, notes: ''
  }
  const [form,     setForm]    = useState<Omit<PaymentMethod, 'id'>>(emptyPM)
  const [saving,   setSaving]  = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function addMethod() {
    if (!form.label.trim()) return
    setSaving(true)
    await supabase.from('payment_methods').insert({
      company_id:  form.company_id,
      label:       form.label,
      holder_name: form.holder_name || null,
      card_brand:  form.card_brand  || null,
      bank_name:   form.bank_name   || null,
      is_auto:     form.is_auto,
      notes:       form.notes || null,
    })
    setSaving(false)
    setForm(emptyPM)
    onSave()
  }

  async function deleteMethod(id: string) {
    await supabase.from('payment_methods').delete().eq('id', id)
    setDeleteId(null)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">💳 Payment Methods</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="px-6 py-3">
          {methods.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No payment methods yet.</p>
          ) : (
            <div className="space-y-2">
              {methods.map(m => (
                <div key={m.id} className="flex items-start justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${CO_COLORS[m.company_id]}`}>{m.company_id.toUpperCase()}</span>
                      <span className="text-sm font-medium text-gray-900">{m.label}</span>
                      {m.is_auto && <span className="text-xs text-blue-500">⟳ Auto</span>}
                    </div>
                    {m.holder_name && <div className="text-xs text-gray-500 mt-1">👤 {m.holder_name}</div>}
                    {m.card_brand  && <div className="text-xs text-gray-500">💳 {m.card_brand}</div>}
                    {m.bank_name   && <div className="text-xs text-gray-500">🏦 {m.bank_name}</div>}
                    {m.notes       && <div className="text-xs text-gray-400 mt-1 italic">{m.notes}</div>}
                  </div>
                  {role === 'admin' && (
                    deleteId === m.id ? (
                      <span className="flex items-center gap-1 text-xs shrink-0">
                        <button onClick={() => deleteMethod(m.id)} className="text-red-600 font-semibold">Del</button>
                        <button onClick={() => setDeleteId(null)} className="text-gray-400">✕</button>
                      </span>
                    ) : (
                      <button onClick={() => setDeleteId(m.id)} className="text-gray-300 hover:text-red-400 text-sm shrink-0">🗑</button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {role === 'admin' && (
          <div className="px-6 pb-4 border-t border-gray-100 pt-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Add Payment Method</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Company</label>
                <select
                  value={form.company_id}
                  onChange={e => setForm(f => ({ ...f, company_id: e.target.value as Company }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="afs">AFS</option>
                  <option value="tnt">TNT</option>
                  <option value="zfs">ZFS</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Label *</label>
                <input
                  type="text"
                  placeholder="e.g. RBC Visa"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Card Holder Name</label>
                <input
                  type="text"
                  placeholder="e.g. John Kim"
                  value={form.holder_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, holder_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Card Brand / Bank</label>
                <input
                  type="text"
                  placeholder="e.g. Visa, RBC, Chase"
                  value={form.card_brand ?? ''}
                  onChange={e => setForm(f => ({ ...f, card_brand: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pm_auto"
                  checked={form.is_auto}
                  onChange={e => setForm(f => ({ ...f, is_auto: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600"
                />
                <label htmlFor="pm_auto" className="text-sm text-gray-700">Auto-pay</label>
              </div>
              <input
                type="text"
                placeholder="Notes (optional)"
                value={form.notes ?? ''}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <button
              onClick={addMethod}
              disabled={saving || !form.label.trim()}
              className="w-full px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors"
            >
              {saving ? 'Adding…' : '+ Add Method'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── VendorTab ──────────────────────────────────────────────────────────────────

interface Vendor {
  id: string
  company_id: Company
  name: string
  service_type: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  contract_start: string | null
  contract_end: string | null
  onedrive_url: string | null
  notes: string | null
}

const emptyVendor: Omit<Vendor, 'id'> = {
  company_id: 'afs',
  name: '',
  service_type: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  contract_start: '',
  contract_end: '',
  onedrive_url: '',
  notes: '',
}

const CO_FILTER_LIST: { id: Company | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'afs', label: 'AFS' },
  { id: 'tnt', label: 'TNT' },
  { id: 'zfs', label: 'ZFS' },
]

function VendorTab({ role }: { role: Role }) {
  const [vendors,    setVendors]    = useState<Vendor[]>([])
  const [loading,    setLoading]    = useState(true)
  const [coFilter,   setCoFilter]   = useState<Company | 'all'>('all')
  const [search,     setSearch]     = useState('')
  const [showModal,  setShowModal]  = useState(false)
  const [form,       setForm]       = useState<Omit<Vendor, 'id'>>(emptyVendor)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('utility_vendors').select('*').order('name')
    setVendors((data as Vendor[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => vendors.filter(v => {
    if (coFilter !== 'all' && v.company_id !== coFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return v.name.toLowerCase().includes(q) ||
        (v.service_type ?? '').toLowerCase().includes(q) ||
        (v.contact_name ?? '').toLowerCase().includes(q)
    }
    return true
  }), [vendors, coFilter, search])

  function openAdd() {
    setForm(emptyVendor)
    setEditId(null)
    setShowModal(true)
  }

  function openEdit(v: Vendor) {
    const { id, ...rest } = v
    setForm(rest)
    setEditId(id)
    setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    if (editId) {
      await supabase.from('utility_vendors').update(form).eq('id', editId)
    } else {
      await supabase.from('utility_vendors').insert(form)
    }
    setSaving(false)
    setShowModal(false)
    load()
  }

  async function del(id: string) {
    await supabase.from('utility_vendors').delete().eq('id', id)
    setDelConfirm(null)
    load()
  }

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {CO_FILTER_LIST.map(c => (
            <button
              key={c.id}
              onClick={() => setCoFilter(c.id as Company | 'all')}
              className={`px-4 py-1.5 rounded-md text-base font-medium transition-colors ${
                coFilter === c.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search vendors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] border border-gray-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        {role === 'admin' && (
          <button
            onClick={openAdd}
            className="px-4 py-2 text-base text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors"
          >
            + Add Vendor
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-base text-gray-400 py-10 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-base text-gray-400 py-10 text-center">No vendors found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(v => (
            <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-2 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold text-gray-900">{v.name}</p>
                  {v.service_type && (
                    <p className="text-sm text-gray-500">{v.service_type}</p>
                  )}
                </div>
                <span className={`text-sm px-2.5 py-0.5 rounded-full font-medium ${CO_COLORS[v.company_id]}`}>
                  {v.company_id.toUpperCase()}
                </span>
              </div>

              {(v.contact_name || v.contact_email || v.contact_phone) && (
                <div className="text-sm text-gray-700 space-y-0.5 border-t border-gray-100 pt-2">
                  {v.contact_name  && <p>👤 {v.contact_name}</p>}
                  {v.contact_email && <p>✉️ {v.contact_email}</p>}
                  {v.contact_phone && <p>📞 {v.contact_phone}</p>}
                </div>
              )}

              {(v.contract_start || v.contract_end) && (
                <p className="text-sm text-gray-500">
                  📄 Contract: {v.contract_start ? fmtShortDate(v.contract_start) : '?'} → {v.contract_end ? fmtShortDate(v.contract_end) : 'ongoing'}
                </p>
              )}

              {v.onedrive_url && (
                <a
                  href={v.onedrive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  ☁️ View Contract on OneDrive
                </a>
              )}

              {v.notes && <p className="text-sm text-gray-500 italic">{v.notes}</p>}

              {role === 'admin' && (
                <div className="flex gap-2 mt-1 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => openEdit(v)}
                    className="flex-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  {delConfirm === v.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => del(v.id)}
                        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDelConfirm(null)}
                        className="px-3 py-1.5 text-sm bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDelConfirm(v.id)}
                      className="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editId ? 'Edit Vendor' : 'Add Vendor'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {/* Company */}
              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-1">Company *</label>
                <div className="flex gap-2">
                  {(['afs', 'tnt', 'zfs'] as Company[]).map(c => (
                    <button
                      key={c}
                      onClick={() => setForm(f => ({ ...f, company_id: c }))}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        form.company_id === c ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {c.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-1">Vendor Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. BC Hydro"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              {/* Service type */}
              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-1">Service Type</label>
                <input
                  type="text"
                  value={form.service_type ?? ''}
                  onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}
                  placeholder="e.g. Electricity, Gas, Internet"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              {/* Contact */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-1">Contact Name</label>
                  <input
                    type="text"
                    value={form.contact_name ?? ''}
                    onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-1">Phone</label>
                  <input
                    type="text"
                    value={form.contact_phone ?? ''}
                    onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-1">Contact Email</label>
                <input
                  type="email"
                  value={form.contact_email ?? ''}
                  onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              {/* Contract dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-1">Contract Start</label>
                  <input
                    type="date"
                    value={form.contract_start ?? ''}
                    onChange={e => setForm(f => ({ ...f, contract_start: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-1">Contract End</label>
                  <input
                    type="date"
                    value={form.contract_end ?? ''}
                    onChange={e => setForm(f => ({ ...f, contract_end: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>
              {/* OneDrive URL */}
              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-1">OneDrive Contract URL</label>
                <input
                  type="url"
                  value={form.onedrive_url ?? ''}
                  onChange={e => setForm(f => ({ ...f, onedrive_url: e.target.value }))}
                  placeholder="https://onedrive.live.com/…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !form.name.trim()}
                className="flex-1 px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors"
              >
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
