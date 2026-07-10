'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
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
  due_date: string | null
  billing_period: string | null
  billing_month: number | null
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

const COMPANIES: { id: Company | 'all'; label: string; flag?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'afs', label: 'AFS' },
  { id: 'tnt', label: 'TNT', flag: '🇨🇦' },
  { id: 'zfs', label: 'ZFS', flag: '🇺🇸' },
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
  if (days < 0)  return `${fmt} (${Math.abs(days)}d overdue)`
  if (days === 0) return `${fmt} (Today)`
  if (days <= 7)  return `${fmt} (${days}d left)`
  return fmt
}

function dueDateColor(bill: Bill) {
  if (bill.is_paid) return 'text-gray-400'
  const days = daysUntilDue(bill)
  if (days === null) return 'text-gray-500'
  if (days < 0)  return 'text-red-600 font-semibold'
  if (days <= 3) return 'text-red-500 font-medium'
  if (days <= 7) return 'text-amber-600 font-medium'
  return 'text-gray-700'
}

const emptyBill: Omit<Bill, 'id' | 'created_at' | 'payment_methods'> = {
  company_id: 'afs',
  utility_name: '',
  provider: '',
  amount: null,
  currency: 'CAD',
  due_date: '',
  billing_period: '',
  billing_month: null,
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

  const [coFilter,     setCoFilter]     = useState<Company | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchTerm,   setSearchTerm]   = useState('')

  const [showModal,   setShowModal]   = useState(false)
  const [editBill,    setEditBill]    = useState<Partial<Bill>>(emptyBill)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)

  const [noteEdit,    setNoteEdit]    = useState<{ id: string; value: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const [showPMModal, setShowPMModal] = useState(false)

  // Load user role
  useEffect(() => {
    if (!user) return
    supabase
      .from('utility_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setRole((data?.role as Role) ?? 'admin')
      })
  }, [user])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('utility_bills')
      .select('*, payment_methods(*)')
      .order('due_date', { ascending: true, nullsFirst: false })
    setBills((data as Bill[]) ?? [])
    const { data: pm } = await supabase
      .from('payment_methods')
      .select('*')
      .order('label')
    setMethods((pm as PaymentMethod[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Filtered bills ──────────────────────────────────────────────────────────
  const filtered = bills.filter(b => {
    if (coFilter !== 'all' && b.company_id !== coFilter) return false
    if (statusFilter === 'paid'   && !b.is_paid) return false
    if (statusFilter === 'unpaid' && (b.is_paid || isOverdue(b))) return false
    if (statusFilter === 'overdue' && !isOverdue(b)) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      if (!b.utility_name.toLowerCase().includes(q) &&
          !(b.provider ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = {
    total:   bills.length,
    unpaid:  bills.filter(b => !b.is_paid && !isOverdue(b)).length,
    overdue: bills.filter(isOverdue).length,
    paid:    bills.filter(b => b.is_paid).length,
  }

  // ── Paid toggle ─────────────────────────────────────────────────────────────
  async function togglePaid(bill: Bill) {
    const newPaid = !bill.is_paid
    await supabase.from('utility_bills').update({
      is_paid: newPaid,
      paid_at:  newPaid ? new Date().toISOString() : null,
      paid_by:  newPaid ? (user?.email ?? null) : null,
    }).eq('id', bill.id)
    setBills(prev => prev.map(b =>
      b.id === bill.id
        ? { ...b, is_paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null, paid_by: newPaid ? (user?.email ?? null) : null }
        : b
    ))
  }

  // ── Save note ───────────────────────────────────────────────────────────────
  async function saveNote(id: string, notes: string) {
    await supabase.from('utility_bills').update({ notes }).eq('id', id)
    setBills(prev => prev.map(b => b.id === id ? { ...b, notes } : b))
    setNoteEdit(null)
  }

  // ── Save bill (add/edit) ────────────────────────────────────────────────────
  async function saveBill() {
    if (!editBill.utility_name?.trim()) return
    setSaving(true)
    const payload = {
      company_id:        editBill.company_id,
      utility_name:      editBill.utility_name,
      provider:          editBill.provider || null,
      amount:            editBill.amount ?? null,
      currency:          editBill.currency,
      due_date:          editBill.due_date || null,
      billing_period:    editBill.billing_period || null,
      billing_month:     editBill.due_date
                           ? new Date(editBill.due_date + 'T00:00:00').getMonth() + 1
                           : null,
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

  // ── Delete bill ─────────────────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 min-h-full bg-gray-50">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Utility Bills</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            AFS · TNT · ZFS — {role === 'ap' ? 'AP View' : 'Admin'}
          </p>
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

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total', value: stats.total,   color: 'text-gray-700', bg: 'bg-white' },
          { label: 'Unpaid', value: stats.unpaid,  color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Overdue', value: stats.overdue, color: 'text-red-600',   bg: 'bg-red-50' },
          { label: 'Paid',    value: stats.paid,    color: 'text-emerald-600', bg: 'bg-emerald-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl border border-gray-200 px-4 py-3`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Company tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {COMPANIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCoFilter(c.id as Company | 'all')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                coFilter === c.id
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {c.flag ? `${c.flag} ${c.label}` : c.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {STATUS_FILTER.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors capitalize ${
                statusFilter === s
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search utility / provider…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="ml-auto px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 w-52"
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid</th>
                  {role === 'admin' && (
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(bill => (
                  <tr key={bill.id} className={`hover:bg-gray-50 transition-colors ${bill.is_paid ? 'opacity-60' : ''}`}>
                    {/* Company */}
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${CO_COLORS[bill.company_id]}`}>
                        {bill.company_id.toUpperCase()}
                      </span>
                    </td>

                    {/* Utility name */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{bill.utility_name}</div>
                      {bill.billing_period && (
                        <div className="text-xs text-gray-400">{bill.billing_period}</div>
                      )}
                    </td>

                    {/* Provider */}
                    <td className="px-4 py-3 text-gray-600 text-xs">{bill.provider ?? '—'}</td>

                    {/* Amount */}
                    <td className="px-4 py-3">
                      {bill.amount != null ? (
                        <span className="font-medium text-gray-900">
                          {bill.currency === 'USD' ? 'US$' : 'CA$'}{bill.amount.toFixed(2)}
                        </span>
                      ) : '—'}
                    </td>

                    {/* Due date */}
                    <td className={`px-4 py-3 text-xs ${dueDateColor(bill)}`}>
                      {dueDateLabel(bill)}
                    </td>

                    {/* Payment method */}
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

                    {/* Notes */}
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
                            : <span className="text-gray-300 group-hover:text-gray-400">+ note</span>
                          }
                        </div>
                      )}
                    </td>

                    {/* Paid checkbox */}
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={bill.is_paid}
                        onChange={() => togglePaid(bill)}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer"
                        title={bill.paid_at ? `Paid on ${new Date(bill.paid_at).toLocaleDateString()} by ${bill.paid_by ?? 'unknown'}` : 'Mark as paid'}
                      />
                    </td>

                    {/* Admin actions */}
                    {role === 'admin' && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {bill.onedrive_file_url && (
                            <a
                              href={bill.onedrive_file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                              title="Open file"
                            >
                              📎
                            </a>
                          )}
                          <button
                            onClick={() => openEdit(bill)}
                            className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
                            title="Edit"
                          >
                            ✏️
                          </button>
                          {deleteConfirm === bill.id ? (
                            <span className="flex items-center gap-1 text-xs">
                              <button onClick={() => deleteBill(bill.id)} className="text-red-600 font-semibold">Del</button>
                              <button onClick={() => setDeleteConfirm(null)} className="text-gray-400">✕</button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(bill.id)}
                              className="p-1 text-gray-300 hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              🗑
                            </button>
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

      {/* AP view notice */}
      {role === 'ap' && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          AP view — you can mark bills as paid and add notes. Contact admin to add or edit bills.
        </p>
      )}

      {/* ── Add/Edit Bill Modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{editingId ? 'Edit Bill' : 'Add Bill'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">

              {/* Company + Currency row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Company</label>
                  <select
                    value={editBill.company_id}
                    onChange={e => setEditBill(b => ({ ...b, company_id: e.target.value as Company }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="afs">AFS</option>
                    <option value="tnt">TNT 🇨🇦</option>
                    <option value="zfs">ZFS 🇺🇸</option>
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

              {/* Provider */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Provider</label>
                <input
                  type="text"
                  placeholder="e.g. BC Hydro, Enbridge, Comcast"
                  value={editBill.provider ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, provider: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              {/* Amount + Due date */}
              <div className="grid grid-cols-2 gap-3">
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
                    .filter(m => editBill.company_id === 'all' || m.company_id === editBill.company_id)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.label}{m.holder_name ? ` (${m.holder_name})` : ''}
                        {m.is_auto ? ' ⟳' : ''}
                      </option>
                    ))
                  }
                </select>
              </div>

              {/* Auto pay toggle */}
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

      {/* ── Payment Methods Modal ──────────────────────────────────────────── */}
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
  const [form, setForm] = useState<Omit<PaymentMethod, 'id'>>(emptyPM)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function addMethod() {
    if (!form.label.trim()) return
    setSaving(true)
    await supabase.from('payment_methods').insert({
      company_id:  form.company_id,
      label:       form.label,
      holder_name: form.holder_name || null,
      card_brand:  form.card_brand || null,
      bank_name:   form.bank_name || null,
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

        {/* List */}
        <div className="px-6 py-3">
          {methods.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No payment methods yet.</p>
          ) : (
            <div className="space-y-2">
              {methods.map(m => (
                <div key={m.id} className="flex items-start justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${CO_COLORS[m.company_id]}`}>
                        {m.company_id.toUpperCase()}
                      </span>
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

        {/* Add form (admin only) */}
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
