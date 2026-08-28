'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'
import {
  computeBillStatus, isActiveOutstanding, STATUS_BADGE,
  type BalanceStatus, type InvoiceStatus,
} from '@/lib/billStatus'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

// ── Types ──────────────────────────────────────────────────────────────────────

type Company = 'afs' | 'tnt' | 'zfs'
type Currency = 'CAD' | 'USD'
type Role = 'admin' | 'ap'
type MainTab = 'dashboard' | 'all' | 'analytics'
type StatusFilter = 'all' | 'open' | 'overdue' | 'overdue_partial' | 'due_today' | 'upcoming' | 'partially_paid' | 'paid' | 'carried_forward' | 'waived' | 'void'

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

interface VendorRef {
  id: string
  company_id: Company
  name: string
}

// A standalone account-balance adjustment (e.g. a duplicate/overpayment) not tied to any
// specific bill. Reduces the account's running balance the same way a bill payment would.
interface Credit {
  id: string
  company_id: Company
  utility_name: string
  account_number: string | null
  amount: number
  credit_date: string | null
  note: string | null
  created_at: string
}

interface Bill {
  id: string
  company_id: Company
  utility_name: string
  provider: string | null
  amount: number | null
  previous_balance: number | null
  current_charges: number | null
  currency: Currency
  issue_date: string | null
  due_date: string | null
  billing_period: string | null
  billing_month: number | null
  billing_year: number | null
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
  // new balance fields
  balance_status: BalanceStatus
  invoice_status: InvoiceStatus | null
  total_due: number | null
  amount_paid: number | null
  remaining_balance: number | null
  late_fee: number | null
  tax: number | null
  adjustments: number | null
  needs_amount_review: boolean
  carried_forward_to_bill_id: string | null
  carried_forward_amount: number | null
}

const COMPANIES: { id: Company | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'afs', label: 'AFS' },
  { id: 'tnt', label: 'TNT' },
  { id: 'zfs', label: 'ZFS' },
]

const CO_COLORS: Record<Company, string> = {
  afs: 'text-blue-600',
  tnt: 'text-amber-600',
  zfs: 'text-emerald-600',
}

const STATUS_FILTER_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all',            label: 'All' },
  { id: 'open',           label: 'Open' },
  { id: 'overdue',        label: 'Overdue' },
  { id: 'overdue_partial',label: 'Overdue (Partial)' },
  { id: 'due_today',      label: 'Due Today' },
  { id: 'upcoming',       label: 'Upcoming' },
  { id: 'partially_paid', label: 'Partial' },
  { id: 'paid',           label: 'Paid' },
  { id: 'carried_forward',label: 'Carried Fwd' },
  { id: 'waived',         label: 'Waived' },
  { id: 'void',           label: 'Void' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function isAbnormalBill(bill: Bill, allBills: Bill[]): boolean {
  const charges = bill.current_charges ?? bill.amount
  if (charges == null || charges <= 0) return false
  const key = `${bill.provider ?? bill.utility_name}|${bill.account_number ?? ''}`
  const billKey = bill.billing_year && bill.billing_month
    ? `${bill.billing_year}-${String(bill.billing_month).padStart(2, '0')}`
    : bill.due_date?.slice(0, 7) ?? null
  if (!billKey) return false
  const peers = allBills
    .filter(b => {
      if (b.id === bill.id) return false
      if (`${b.provider ?? b.utility_name}|${b.account_number ?? ''}` !== key) return false
      const bKey = b.billing_year && b.billing_month
        ? `${b.billing_year}-${String(b.billing_month).padStart(2, '0')}`
        : b.due_date?.slice(0, 7) ?? null
      return bKey !== null && bKey < billKey
    })
    .sort((a, b) => {
      const aK = a.billing_year && a.billing_month ? `${a.billing_year}-${String(a.billing_month).padStart(2,'0')}` : a.due_date?.slice(0,7) ?? ''
      const bK = b.billing_year && b.billing_month ? `${b.billing_year}-${String(b.billing_month).padStart(2,'0')}` : b.due_date?.slice(0,7) ?? ''
      return bK.localeCompare(aK)
    })
    .slice(0, 3)
  if (peers.length < 2) return false
  const avg = peers.reduce((s, b) => s + (b.current_charges ?? b.amount ?? 0), 0) / peers.length
  if (avg === 0) return false
  const ratio = charges / avg
  return ratio > 1.25 || ratio < 0.75
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
  const fmt = new Date(bill.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const s = computeBillStatus(bill)
  if (s === 'paid' || s === 'paid_late' || s === 'carried_forward' || s === 'waived' || s === 'void') return fmt
  if (days < 0)   return `${fmt} (${Math.abs(days)}d overdue)`
  if (days === 0) return `${fmt} (Today)`
  if (days <= 7)  return `${fmt} (${days}d left)`
  return fmt
}

function dueDateColor(bill: Bill) {
  const s = computeBillStatus(bill)
  if (s === 'paid' || s === 'paid_late' || s === 'carried_forward' || s === 'waived' || s === 'void') return 'text-ink-faint'
  const days = daysUntilDue(bill)
  if (days === null) return 'text-ink-muted'
  if (days < 0)   return 'text-red-600 font-semibold'
  if (days <= 3)  return 'text-red-500 font-medium'
  if (days <= 7)  return 'text-amber-600 font-medium'
  return 'text-ink-muted'
}

function fmtAmt(bill: Bill) {
  if (bill.amount == null) return '—'
  return `${bill.currency === 'USD' ? 'US$' : 'CA$'}${bill.amount.toFixed(2)}`
}

function fmtShortDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function accountKey(companyId: Company, utilityName: string, accountNumber: string | null): string {
  return `${companyId}::${utilityName}::${accountNumber ?? ''}`
}

// Per-account running balance, keyed the same way bills are grouped elsewhere on this page.
// Charge uses current_charges (not total_due) so a bill's carried-forward previous_balance
// isn't double-counted on top of the source bill's own charge. Credits are independent
// adjustments (e.g. a duplicate payment) not tied to any bill, and simply reduce the balance —
// pushing it negative represents an account credit rather than clamping at zero like the
// per-bill remaining_balance field does.
// Returns both the final per-account balance and a human-readable breakdown of what
// contributed to it (bill charge/paid line + credit lines) — the Balance column shows the
// breakdown as a hover tooltip so a wrong-looking number can be traced back to its source
// (a specific bill's total_due column, an old carry-forward, a mistyped credit, etc.)
// instead of having to be re-derived by hand.
function computeAccountBalanceDetail(bills: Bill[], credits: Credit[]): { balances: Map<string, number>; breakdown: Map<string, string[]> } {
  const balances = new Map<string, number>()
  const breakdown = new Map<string, string[]>()
  const addLine = (key: string, line: string) => breakdown.set(key, [...(breakdown.get(key) ?? []), line])

  for (const b of bills) {
    const status = computeBillStatus(b)
    const key = accountKey(b.company_id, b.utility_name, b.account_number)
    if (status === 'void' || status === 'waived') {
      addLine(key, `${fmtShortDate(b.issue_date)} bill: ${status}, excluded`)
      continue
    }
    const charge = b.current_charges ?? b.amount ?? b.total_due ?? 0
    // amount_paid on a carried-forward bill includes repaying the previous_balance portion
    // too (the "Paid" quick action sets amount_paid = previous_balance + current_charges).
    // Subtract previous_balance back out so only this bill's own current_charges is treated
    // as paid here — otherwise the carried amount gets counted as repaid a second time on
    // top of however it was already accounted for in the prior bill's own contribution.
    const paid = (b.amount_paid ?? 0) - (b.previous_balance ?? 0)
    const contribution = charge - paid
    balances.set(key, (balances.get(key) ?? 0) + contribution)
    addLine(key, `${fmtShortDate(b.issue_date)} bill: charge ${charge.toFixed(2)} − paid ${paid.toFixed(2)} (amount_paid ${(b.amount_paid ?? 0).toFixed(2)}, total_due ${(b.total_due ?? 0).toFixed(2)}) = ${contribution >= 0 ? '+' : ''}${contribution.toFixed(2)}`)
  }
  for (const c of credits) {
    const key = accountKey(c.company_id, c.utility_name, c.account_number)
    balances.set(key, (balances.get(key) ?? 0) - c.amount)
    addLine(key, `${fmtShortDate(c.credit_date)} credit: -${c.amount.toFixed(2)}`)
  }
  return { balances, breakdown }
}

function fmtBalance(balance: number, sym: string): string {
  if (balance > 0.005) return `${sym}${balance.toFixed(2)}`
  if (balance < -0.005) return `-${sym}${Math.abs(balance).toFixed(2)}`
  return `${sym}0.00`
}

function balanceColor(balance: number): string {
  if (balance > 0.005) return 'text-red-600'
  if (balance < -0.005) return 'text-emerald-600'
  return 'text-ink-faint'
}

const emptyBill: Omit<Bill, 'id' | 'created_at' | 'payment_methods'> = {
  company_id: 'afs',
  utility_name: '',
  provider: '',
  amount: null,
  previous_balance: null,
  current_charges: null,
  currency: 'CAD',
  issue_date: '',
  due_date: '',
  billing_period: '',
  billing_month: null,
  billing_year: null,
  bill_number: '',
  account_number: '',
  is_auto_pay: false,
  payment_method_id: null,
  onedrive_file_url: '',
  is_paid: false,
  paid_at: null,
  paid_by: null,
  notes: '',
  balance_status: 'open',
  invoice_status: 'active',
  total_due: null,
  amount_paid: null,
  remaining_balance: null,
  late_fee: null,
  tax: null,
  adjustments: null,
  needs_amount_review: false,
  carried_forward_to_bill_id: null,
  carried_forward_amount: null,
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function UtilityPage() {
  const { user } = useAuth()
  const [role,    setRole]    = useState<Role | null>(null)
  const [bills,   setBills]   = useState<Bill[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [credits, setCredits] = useState<Credit[]>([])
  const [vendors, setVendors] = useState<VendorRef[]>([])
  const [loading, setLoading] = useState(true)

  const [mainTab,      setMainTab]      = useState<MainTab>('dashboard')
  // The dashboard is an across-company overview, so start with every company visible.
  const [coFilter,     setCoFilter]     = useState<Company | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchTerm,   setSearchTerm]   = useState('')
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null)

  const [showModal,     setShowModal]     = useState(false)
  const [editBill,      setEditBill]      = useState<Partial<Bill>>(emptyBill)
  const [editingId,     setEditingId]     = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [noteEdit,      setNoteEdit]      = useState<{ id: string; value: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [applyConfirm,  setApplyConfirm]  = useState<string | null>(null)
  const [showPMModal,   setShowPMModal]   = useState(false)
  const [showCreditModal, setShowCreditModal] = useState(false)

  useEffect(() => {
    if (!user) {
      setRole(null)
      return
    }
    supabase
      .from('utility_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || (data?.role !== 'admin' && data?.role !== 'ap')) {
          setRole(null)
        } else {
          setRole(data.role)
        }
      })
  }, [user])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: pm }, { data: cr }, { data: v }] = await Promise.all([
      supabase
        .from('utility_bills')
        .select('*, payment_methods(*), balance_status, invoice_status, total_due, amount_paid, remaining_balance, late_fee, tax, adjustments, needs_amount_review, carried_forward_to_bill_id, carried_forward_amount')
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('payment_methods').select('*').order('label'),
      supabase.from('utility_credits').select('*').order('credit_date', { ascending: false }),
      supabase.from('utility_vendors').select('id, company_id, name').order('name'),
    ])
    setBills((data as Bill[]) ?? [])
    setMethods((pm as PaymentMethod[]) ?? [])
    setCredits((cr as Credit[]) ?? [])
    setVendors((v as VendorRef[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const { balances: accountBalances, breakdown: accountBalanceBreakdown } = useMemo(() => computeAccountBalanceDetail(bills, credits), [bills, credits])

  const vendorCompanyByName = useMemo(() => {
    const map = new Map<string, Company>()
    for (const vendor of vendors) map.set(vendor.name.trim().toLowerCase(), vendor.company_id)
    return map
  }, [vendors])

  function effectiveCompanyId(bill: Bill): Company {
    const providerKey = (bill.provider ?? bill.utility_name).trim().toLowerCase()
    return vendorCompanyByName.get(providerKey) ?? bill.company_id
  }

  const filtered = bills.filter(b => {
    if (coFilter !== 'all' && effectiveCompanyId(b) !== coFilter) return false
    if (statusFilter !== 'all' && computeBillStatus(b) !== statusFilter) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      if (!b.utility_name.toLowerCase().includes(q) &&
          !(b.provider ?? '').toLowerCase().includes(q) &&
          !(b.bill_number ?? '').toLowerCase().includes(q) &&
          !(b.account_number ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  // Credits aren't "bills" so they only show up in the unfiltered All-Bills view — a bill
  // status filter (Overdue, Paid, etc.) doesn't have a meaningful equivalent for them.
  const filteredCredits = statusFilter !== 'all' ? [] : credits.filter(c => {
    if (coFilter !== 'all' && c.company_id !== coFilter) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      if (!c.utility_name.toLowerCase().includes(q) &&
          !(c.account_number ?? '').toLowerCase().includes(q) &&
          !(c.note ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  type BillTableRow = { kind: 'bill'; bill: Bill } | { kind: 'credit'; credit: Credit }
  const rows: BillTableRow[] = [
    ...filtered.map(bill => ({ kind: 'bill' as const, bill })),
    ...filteredCredits.map(credit => ({ kind: 'credit' as const, credit })),
  ].sort((a, b) => {
    const da = a.kind === 'bill' ? (a.bill.due_date ?? '') : (a.credit.credit_date ?? '')
    const db = b.kind === 'bill' ? (b.bill.due_date ?? '') : (b.credit.credit_date ?? '')
    return da.localeCompare(db)
  })

  const availableCreditByAccount = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of credits) {
      const key = accountKey(c.company_id, c.utility_name, c.account_number)
      map.set(key, (map.get(key) ?? 0) + c.amount)
    }
    return map
  }, [credits])

  const today = new Date(new Date().toDateString())
  const inSevenDays = new Date(today.getTime() + 7 * 86400000)

  const overdueBills  = bills.filter(b => {
    if (coFilter !== 'all' && effectiveCompanyId(b) !== coFilter) return false
    const s = computeBillStatus(b)
    return s === 'overdue' || s === 'overdue_partial'
  })
  const upcomingBills = bills.filter(b => {
    if (coFilter !== 'all' && effectiveCompanyId(b) !== coFilter) return false
    if (!isActiveOutstanding(b) || !b.due_date) return false
    const due = new Date(b.due_date + 'T00:00:00')
    return due >= today && due <= inSevenDays
  })

  // "Current" = unpaid bills due this month or next month, excluding anything already overdue
  const curMonth  = today.getMonth()
  const curYear   = today.getFullYear()
  const nextMonthDate = new Date(curYear, curMonth + 1, 1)
  const currentBills = bills.filter(b => {
    if (coFilter !== 'all' && effectiveCompanyId(b) !== coFilter) return false
    const s = computeBillStatus(b)
    if (s === 'overdue' || s === 'overdue_partial' || !isActiveOutstanding(b) || !b.due_date) return false
    const d = new Date(b.due_date + 'T00:00:00')
    const isThisMonth = d.getFullYear() === curYear && d.getMonth() === curMonth
    const isNextMonth  = d.getFullYear() === nextMonthDate.getFullYear() && d.getMonth() === nextMonthDate.getMonth()
    return isThisMonth || isNextMonth
  })

  const stats = {
    total:           bills.length,
    outstanding:     bills.filter(b => isActiveOutstanding(b)).length,
    overdue:         overdueBills.length,
    paid:            bills.filter(b => computeBillStatus(b) === 'paid').length,
    carriedForward:  bills.filter(b => computeBillStatus(b) === 'carried_forward').length,
  }

  async function updateBillStatus(bill: Bill, newStatus: BalanceStatus) {
    const patch: Partial<Bill> = { balance_status: newStatus }
    if (newStatus === 'paid') {
      patch.amount_paid = bill.amount ?? bill.total_due ?? 0
      patch.remaining_balance = 0
      // The quick "Paid" action makes no claim about *when* it was actually paid —
      // stamping "now" made every backfilled/historical bill look "paid late" simply
      // because today is always after an old due date. Only the dated Record Payment
      // flow (savePartialPayment) should set a paid_at that feeds the late check.
      // Clearing it here also lets "Paid" double as the fix for a wrongly-late bill.
      patch.paid_at = null
      patch.paid_by = user?.email ?? null
      patch.is_paid = true
    } else if (newStatus === 'open') {
      patch.amount_paid = 0
      patch.remaining_balance = bill.amount ?? bill.total_due ?? 0
      patch.is_paid = false
      patch.paid_at = null
      patch.paid_by = null
    }
    await supabase.from('utility_bills').update(patch).eq('id', bill.id)
    setBills(prev => prev.map(b => b.id === bill.id ? { ...b, ...patch } : b))
  }

  const [carryForwardBill, setCarryForwardBill] = useState<Bill | null>(null)
  const [partialPaymentBill, setPartialPaymentBill] = useState<Bill | null>(null)

  async function savePartialPayment(bill: Bill, amountPaid: number, paidAt: string, lateFee: number) {
    const baseTotal = bill.amount ?? bill.total_due ?? 0
    const effectiveTotal = baseTotal + lateFee
    // Paying it off in full (including any late fee) through this same flow should
    // count as fully Paid — otherwise balance_status stays 'partially_paid' forever
    // and the bill never leaves the Overdue list even though nothing is owed anymore.
    const isFullyPaid = effectiveTotal > 0 && amountPaid >= effectiveTotal - 0.005
    const patch: Partial<Bill> = {
      balance_status: isFullyPaid ? 'paid' : 'partially_paid',
      amount_paid: isFullyPaid ? effectiveTotal : amountPaid,
      remaining_balance: isFullyPaid ? 0 : Math.max(effectiveTotal - amountPaid, 0),
      late_fee: lateFee,
      paid_at: paidAt ? new Date(paidAt + 'T00:00:00').toISOString() : new Date().toISOString(),
      paid_by: user?.email ?? null,
      is_paid: isFullyPaid,
    }
    await supabase.from('utility_bills').update(patch).eq('id', bill.id)
    setBills(prev => prev.map(b => b.id === bill.id ? { ...b, ...patch } : b))
    setPartialPaymentBill(null)
  }

  async function saveNote(id: string, notes: string) {
    await supabase.from('utility_bills').update({ notes }).eq('id', id)
    setBills(prev => prev.map(b => b.id === id ? { ...b, notes } : b))
    setNoteEdit(null)
  }

  async function saveBill() {
    if (!editBill.utility_name?.trim()) return
    setSaving(true)
    // billing_month/billing_year identify which month's bill this is, and
    // must come from issue_date only — falling back to due_date here
    // previously mislabeled bills by the wrong month whenever issue_date
    // was left blank (due_date is typically ~1 month after issue_date).
    const billingDate = editBill.issue_date ? new Date(editBill.issue_date + 'T00:00:00') : null

    const payload = {
      company_id:        editBill.company_id,
      utility_name:      editBill.utility_name,
      provider:          editBill.provider || null,
      previous_balance:  editBill.previous_balance ?? null,
      current_charges:   editBill.current_charges ?? null,
      // amount = total due: previous_balance + current_charges if both set, else manual amount
      amount:            (editBill.previous_balance != null && editBill.current_charges != null)
                           ? (editBill.previous_balance + editBill.current_charges)
                           : (editBill.amount ?? null),
      currency:          editBill.currency,
      issue_date:        editBill.issue_date || null,
      due_date:          editBill.due_date || null,
      billing_period:    editBill.billing_period || null,
      billing_month:     billingDate ? billingDate.getMonth() + 1 : null,
      billing_year:      editBill.billing_year ?? (billingDate ? billingDate.getFullYear() : null),
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

  async function deleteCredit(id: string) {
    await supabase.from('utility_credits').delete().eq('id', id)
    setCredits(prev => prev.filter(c => c.id !== id))
  }

  // Applies as much of the account's available credit as possible toward a bill: marks the
  // bill paid/partially-paid (same fields the quick "Paid" action sets) and consumes credit
  // rows oldest-first, shrinking or deleting them. Balance-neutral overall — see
  // computeAccountBalances: crediting a bill's amount_paid and removing the same amount from
  // the credits pool cancel out, so the account's total balance doesn't move, only which line
  // item represents it.
  async function applyCredit(bill: Bill) {
    const key = accountKey(bill.company_id, bill.utility_name, bill.account_number)
    const acctCredits = credits
      .filter(c => accountKey(c.company_id, c.utility_name, c.account_number) === key)
      .sort((a, b) => (a.credit_date ?? '').localeCompare(b.credit_date ?? ''))
    const available = acctCredits.reduce((s, c) => s + c.amount, 0)
    const baseTotal = bill.amount ?? bill.total_due ?? 0
    const alreadyPaid = bill.amount_paid ?? 0
    const remaining = Math.max(baseTotal - alreadyPaid, 0)
    const applyAmt = Math.min(available, remaining)
    if (applyAmt <= 0.005) return

    const newPaid = alreadyPaid + applyAmt
    const isFullyPaid = newPaid >= baseTotal - 0.005
    const patch: Partial<Bill> = {
      balance_status: isFullyPaid ? 'paid' : 'partially_paid',
      amount_paid: newPaid,
      remaining_balance: Math.max(baseTotal - newPaid, 0),
      is_paid: isFullyPaid,
      paid_by: bill.paid_by ?? 'Credit',
    }
    await supabase.from('utility_bills').update(patch).eq('id', bill.id)
    setBills(prev => prev.map(b => b.id === bill.id ? { ...b, ...patch } : b))

    let toConsume = applyAmt
    for (const c of acctCredits) {
      if (toConsume <= 0.005) break
      const use = Math.min(c.amount, toConsume)
      toConsume -= use
      const newAmt = c.amount - use
      if (newAmt <= 0.005) {
        await supabase.from('utility_credits').delete().eq('id', c.id)
      } else {
        await supabase.from('utility_credits').update({ amount: newAmt }).eq('id', c.id)
      }
    }
    setApplyConfirm(null)
    load()
  }

  function openEdit(bill: Bill) {
    setEditBill(bill)
    setEditingId(bill.id)
    setShowModal(true)
  }

  return (
    <div className="h-full overflow-auto bg-pill">
    <div className="p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-ink">Utility Bills</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-white border border-line rounded-lg p-1">
            {([
              ['dashboard', 'Dashboard'],
              ['all',       'All Bills'],
              ['analytics', 'Analytics'],
            ] as [MainTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setMainTab(tab)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  mainTab === tab ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowPMModal(true)}
            className="px-3 py-1.5 text-sm text-ink-muted border border-line bg-white rounded-lg hover:bg-pill transition-colors"
          >
            Payment Methods
          </button>
          {role === 'admin' && (
            <button
              onClick={() => setShowCreditModal(true)}
              className="px-3 py-1.5 text-sm text-ink-muted border border-line bg-white rounded-lg hover:bg-pill transition-colors"
            >
              Add Credit
            </button>
          )}
          {role === 'admin' && (
            <button
              onClick={() => { setEditBill(emptyBill); setEditingId(null); setShowModal(true) }}
              className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 transition-colors"
            >
              + Add Bill
            </button>
          )}
        </div>
      </div>

      {/* ── DASHBOARD TAB ──────────────────────────────────────────────────── */}
      {mainTab === 'dashboard' && (
        <DashboardTab
          bills={bills}
          overdueBills={overdueBills}
          currentBills={currentBills}
          coFilter={coFilter}
          setCoFilter={setCoFilter}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          effectiveCompanyId={effectiveCompanyId}
          expandedVendor={expandedVendor}
          setExpandedVendor={setExpandedVendor}
          role={role}
          onUpdateStatus={updateBillStatus}
          onCarryForward={setCarryForwardBill}
          onPartialPayment={setPartialPaymentBill}
          onEdit={openEdit}
          deleteConfirm={deleteConfirm}
          setDeleteConfirm={setDeleteConfirm}
          onDelete={deleteBill}
          noteEdit={noteEdit}
          setNoteEdit={setNoteEdit}
          onSaveNote={saveNote}
        />
      )}

      {/* ── ALL BILLS TAB ──────────────────────────────────────────────────── */}
      {mainTab === 'all' && (
        <>
          {/* Stats row — clickable to filter */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            {[
              { label: 'Total',        value: stats.total,          color: 'text-ink',         sf: 'all'            as StatusFilter },
              { label: 'Outstanding',  value: stats.outstanding,    color: 'text-amber-600',   sf: 'open'           as StatusFilter },
              { label: 'Overdue',      value: stats.overdue,        color: 'text-signal-neg',  sf: 'overdue'        as StatusFilter },
              { label: 'Paid',         value: stats.paid,           color: 'text-signal-pos',  sf: 'paid'           as StatusFilter },
              { label: 'Carried Fwd',  value: stats.carriedForward, color: 'text-purple-600',  sf: 'carried_forward' as StatusFilter },
            ].map(s => (
              <button
                key={s.label}
                onClick={() => setStatusFilter(s.sf)}
                className={`bg-white rounded-xl border border-line px-4 py-3 text-left transition-colors ${statusFilter === s.sf ? 'ring-2 ring-ink' : 'hover:border-ink-faint'}`}
              >
                <div className={`text-2xl font-semibold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-ink-muted mt-0.5">{s.label}</div>
              </button>
            ))}
          </div>

          {/* Overdue + Upcoming alert panels */}
          {(overdueBills.length > 0 || upcomingBills.length > 0) && (
            <div className={`grid gap-3 mb-5 ${overdueBills.length > 0 && upcomingBills.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
              {overdueBills.length > 0 && (
                <div className="bg-white border border-line rounded-xl p-4">
                  <div className="text-signal-neg font-semibold text-sm mb-2.5">Overdue ({overdueBills.length})</div>
                  <div className="space-y-2">
                    {overdueBills.map(b => (
                      <div key={b.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 text-xs font-bold ${CO_COLORS[effectiveCompanyId(b)]}`}>{effectiveCompanyId(b).toUpperCase()}</span>
                          <span className="text-xs font-medium text-ink truncate">{b.utility_name}</span>
                          {b.provider && <span className="text-xs text-ink-faint hidden sm:inline">· {b.provider}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-semibold text-signal-neg">{fmtAmt(b)}</span>
                          <span className="text-xs text-signal-neg">{dueDateLabel(b)}</span>
                          {b.is_auto_pay ? (
                            <span
                              className="text-xs px-2 py-0.5 rounded bg-pill text-amber-600 font-medium"
                              title="Auto Pay is enabled, but payment has not been recorded as paid. Verify the payment."
                            >
                              Verify Auto Pay
                            </span>
                          ) : (
                            <button onClick={() => updateBillStatus(b, 'paid')} className="text-xs px-2 py-0.5 rounded bg-ink text-white hover:bg-ink/90 transition-colors" title="Mark paid">Paid</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {upcomingBills.length > 0 && (
                <div className="bg-white border border-line rounded-xl p-4">
                  <div className="text-amber-600 font-semibold text-sm mb-2.5">Due this week ({upcomingBills.length})</div>
                  <div className="space-y-2">
                    {upcomingBills.map(b => (
                      <div key={b.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 text-xs font-bold ${CO_COLORS[effectiveCompanyId(b)]}`}>{effectiveCompanyId(b).toUpperCase()}</span>
                          <span className="text-xs font-medium text-ink truncate">{b.utility_name}</span>
                          {b.provider && <span className="text-xs text-ink-faint hidden sm:inline">· {b.provider}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium text-ink">{fmtAmt(b)}</span>
                          <span className={`text-xs ${dueDateColor(b)}`}>{dueDateLabel(b)}</span>
                          <button onClick={() => updateBillStatus(b, 'paid')} className="text-xs px-2 py-0.5 rounded bg-ink text-white hover:bg-ink/90 transition-colors" title="Mark paid">Paid</button>
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
            <div className="flex gap-1 bg-white border border-line rounded-lg p-1">
              {COMPANIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCoFilter(c.id as Company | 'all')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    coFilter === c.id ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 bg-white border border-line rounded-lg p-1 flex-wrap">
              {STATUS_FILTER_OPTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setStatusFilter(s.id)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    statusFilter === s.id ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search utility / provider / bill # / account…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="ml-auto px-3 py-1.5 text-sm border border-line rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-ink w-60"
            />
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-sm text-ink-faint">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-ink-faint">No bills found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-pill border-b border-line">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Co</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Utility</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Bill #</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Provider</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Account</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wide">Balance</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Issued</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Due Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Payment</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Notes</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">Status</th>
                      {role === 'admin' && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {rows.map(row => row.kind === 'credit' ? (
                      <CreditRow
                        key={`credit-${row.credit.id}`}
                        credit={row.credit}
                        balance={accountBalances.get(accountKey(row.credit.company_id, row.credit.utility_name, row.credit.account_number)) ?? 0}
                        balanceTip={(accountBalanceBreakdown.get(accountKey(row.credit.company_id, row.credit.utility_name, row.credit.account_number)) ?? []).join('\n')}
                        role={role}
                        onDelete={deleteCredit}
                      />
                    ) : (() => { const bill = row.bill; return (
                      <tr key={bill.id} className={`hover:bg-pill transition-colors ${computeBillStatus(bill) === 'paid' || computeBillStatus(bill) === 'waived' || computeBillStatus(bill) === 'void' ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <span className={`inline-block text-xs font-bold ${CO_COLORS[effectiveCompanyId(bill)]}`}>
                            {effectiveCompanyId(bill).toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-ink">{bill.utility_name}</span>
                            {isAbnormalBill(bill, bills) && (
                              <span className="text-[10px] uppercase tracking-wide text-amber-600 font-medium shrink-0">±25%</span>
                            )}
                          </div>
                          {bill.billing_period && <div className="text-xs text-ink-faint">{bill.billing_period}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-muted font-mono">{bill.bill_number ?? '—'}</td>
                        <td className="px-4 py-3 text-ink-muted text-xs">{bill.provider ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-ink-muted font-mono">{bill.account_number ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          {(() => {
                            const key = accountKey(bill.company_id, bill.utility_name, bill.account_number)
                            const bal = accountBalances.get(key) ?? 0
                            const sym = bill.currency === 'USD' ? 'US$' : 'CA$'
                            const tip = (accountBalanceBreakdown.get(key) ?? []).join('\n')
                            return <span className={`text-xs font-semibold ${balanceColor(bal)} cursor-help`} title={tip}>{fmtBalance(bal, sym)}</span>
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          {bill.current_charges != null ? (
                            <div>
                              <span className="font-medium text-ink">
                                {bill.currency === 'USD' ? 'US$' : 'CA$'}{((bill.previous_balance ?? 0) + bill.current_charges).toFixed(2)}
                              </span>
                              <div className="text-[10px] text-ink-faint mt-0.5 space-x-1.5">
                                {(bill.previous_balance ?? 0) > 0 && (
                                  <span>prev {bill.currency === 'USD' ? 'US$' : 'CA$'}{bill.previous_balance!.toFixed(2)}</span>
                                )}
                                <span>curr {bill.currency === 'USD' ? 'US$' : 'CA$'}{bill.current_charges.toFixed(2)}</span>
                              </div>
                            </div>
                          ) : bill.amount != null ? (
                            <span className="font-medium text-ink">{fmtAmt(bill)}</span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-muted">{fmtShortDate(bill.issue_date)}</td>
                        <td className={`px-4 py-3 text-xs ${dueDateColor(bill)}`}>{dueDateLabel(bill)}</td>
                        <td className="px-4 py-3">
                          {bill.payment_methods ? (
                            <div>
                              <div className="text-xs font-medium text-ink-muted">
                                {bill.is_auto_pay && <span className="text-signal-pos mr-1">⟳</span>}
                                {bill.payment_methods.label}
                              </div>
                              {bill.payment_methods.holder_name && (
                                <div className="text-xs text-ink-faint">{bill.payment_methods.holder_name}</div>
                              )}
                            </div>
                          ) : bill.is_auto_pay ? (
                            <span className="text-xs text-signal-pos">⟳ Auto</span>
                          ) : (
                            <span className="text-xs text-ink-faint">—</span>
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
                                className="flex-1 text-xs border border-line rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ink min-w-0"
                              />
                              <button onClick={() => saveNote(bill.id, noteEdit.value)} className="text-signal-pos text-xs font-bold">✓</button>
                              <button onClick={() => setNoteEdit(null)} className="text-ink-faint text-xs">✕</button>
                            </div>
                          ) : (
                            <div
                              onClick={() => setNoteEdit({ id: bill.id, value: bill.notes ?? '' })}
                              className="text-xs text-ink-muted cursor-pointer hover:text-ink truncate group"
                              title={bill.notes ?? 'Click to add note'}
                            >
                              {bill.notes
                                ? <span>{bill.notes}</span>
                                : <span className="text-ink-faint group-hover:text-ink-faint">+ note</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusDropdown bill={bill} onUpdate={updateBillStatus} onCarryForward={setCarryForwardBill} onPartialPayment={setPartialPaymentBill} />
                        </td>
                        {role === 'admin' && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {bill.onedrive_file_url && (
                                <a href={bill.onedrive_file_url} target="_blank" rel="noreferrer"
                                  className="px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-signal-pos transition-colors" title="Open file">File</a>
                              )}
                              {(() => {
                                const s = computeBillStatus(bill)
                                const key = accountKey(bill.company_id, bill.utility_name, bill.account_number)
                                const avail = availableCreditByAccount.get(key) ?? 0
                                const canApply = avail > 0.005 && s !== 'paid' && s !== 'paid_late' && s !== 'void' && s !== 'waived' && s !== 'carried_forward'
                                if (!canApply) return null
                                const baseTotal = bill.amount ?? bill.total_due ?? 0
                                const remaining = Math.max(baseTotal - (bill.amount_paid ?? 0), 0)
                                const applyAmt = Math.min(avail, remaining)
                                const sym = bill.currency === 'USD' ? 'US$' : 'CA$'
                                return applyConfirm === bill.id ? (
                                  <span className="flex items-center gap-1 text-xs">
                                    <button onClick={() => applyCredit(bill)} className="text-signal-pos font-semibold">Apply {sym}{applyAmt.toFixed(2)}?</button>
                                    <button onClick={() => setApplyConfirm(null)} className="text-ink-faint">✕</button>
                                  </span>
                                ) : (
                                  <button onClick={() => setApplyConfirm(bill.id)} className="px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-signal-pos transition-colors" title={`Apply account credit (${sym}${avail.toFixed(2)} available)`}>Credit</button>
                                )
                              })()}
                              <button onClick={() => openEdit(bill)} className="px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-ink transition-colors" title="Edit">Edit</button>
                              {deleteConfirm === bill.id ? (
                                <span className="flex items-center gap-1 text-xs">
                                  <button onClick={() => deleteBill(bill.id)} className="text-signal-neg font-semibold">Del</button>
                                  <button onClick={() => setDeleteConfirm(null)} className="text-ink-faint">✕</button>
                                </span>
                              ) : (
                                <button onClick={() => setDeleteConfirm(bill.id)} className="px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-signal-neg transition-colors" title="Delete">Del</button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ) })())}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {role === 'ap' && (
            <p className="text-xs text-ink-faint mt-3 text-center">
              AP view — you can mark bills as paid and add notes. Contact admin to add or edit bills.
            </p>
          )}
        </>
      )}

      {/* ── ANALYTICS TAB ──────────────────────────────────────────────────── */}
      {mainTab === 'analytics' && <AnalyticsTab bills={bills} />}

      {/* ── Add/Edit Bill Modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
              <h2 className="font-semibold text-ink">{editingId ? 'Edit Bill' : 'Add Bill'}</h2>
              <button onClick={() => setShowModal(false)} className="text-ink-faint hover:text-ink-muted">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">

              {/* Company + Currency */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Company</label>
                  <select
                    value={editBill.company_id}
                    onChange={e => setEditBill(b => ({ ...b, company_id: e.target.value as Company }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  >
                    <option value="afs">AFS</option>
                    <option value="tnt">TNT</option>
                    <option value="zfs">ZFS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Currency</label>
                  <select
                    value={editBill.currency}
                    onChange={e => setEditBill(b => ({ ...b, currency: e.target.value as Currency }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  >
                    <option value="CAD">CAD (CA$)</option>
                    <option value="USD">USD (US$)</option>
                  </select>
                </div>
              </div>

              {/* Utility name */}
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Utility Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Electricity, Gas, Internet"
                  value={editBill.utility_name ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, utility_name: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                />
              </div>

              {/* Provider + Account Number */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. BC Hydro"
                    value={editBill.provider ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, provider: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Account Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 1234567890"
                    value={editBill.account_number ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, account_number: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  />
                </div>
              </div>

              {/* Bill Number */}
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Bill Number</label>
                <input
                  type="text"
                  placeholder="e.g. INV-2026-001"
                  value={editBill.bill_number ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, bill_number: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                />
              </div>

              {/* Charges breakdown */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted mb-1">Previous Balance</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editBill.previous_balance ?? ''}
                      onChange={e => setEditBill(b => ({ ...b, previous_balance: e.target.value ? parseFloat(e.target.value) : null }))}
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted mb-1">Current Charges</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editBill.current_charges ?? ''}
                      onChange={e => setEditBill(b => ({ ...b, current_charges: e.target.value ? parseFloat(e.target.value) : null }))}
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Total Due
                    {editBill.previous_balance != null && editBill.current_charges != null && (
                      <span className="ml-2 text-ink-faint font-normal">
                        (auto: {editBill.currency === 'USD' ? 'US$' : 'CA$'}{((editBill.previous_balance ?? 0) + (editBill.current_charges ?? 0)).toFixed(2)})
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00 — or auto-calculated above"
                    value={editBill.previous_balance != null && editBill.current_charges != null
                      ? (editBill.previous_balance + editBill.current_charges).toFixed(2)
                      : (editBill.amount ?? '')}
                    disabled={editBill.previous_balance != null && editBill.current_charges != null}
                    onChange={e => setEditBill(b => ({ ...b, amount: e.target.value ? parseFloat(e.target.value) : null }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink disabled:bg-pill disabled:text-ink-faint"
                  />
                </div>
              </div>

              {/* Issue date + Due date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={editBill.issue_date ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, issue_date: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Due Date</label>
                  <input
                    type="date"
                    value={editBill.due_date ?? ''}
                    onChange={e => setEditBill(b => ({ ...b, due_date: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  />
                </div>
              </div>

              {/* Billing period */}
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Billing Period</label>
                <input
                  type="text"
                  placeholder="e.g. Jun 2026"
                  value={editBill.billing_period ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, billing_period: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                />
              </div>

              {/* Payment method */}
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Payment Method</label>
                <select
                  value={editBill.payment_method_id ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, payment_method_id: e.target.value || null }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
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
                  className="w-4 h-4 accent-signal-pos"
                />
                <label htmlFor="auto_pay" className="text-sm text-ink-muted">Auto-pay enabled</label>
              </div>

              {/* OneDrive URL */}
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">OneDrive File Link</label>
                <input
                  type="url"
                  placeholder="https://…sharepoint.com/…"
                  value={editBill.onedrive_file_url ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, onedrive_file_url: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Any special notes…"
                  value={editBill.notes ?? ''}
                  onChange={e => setEditBill(b => ({ ...b, notes: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-line-soft flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-ink-muted border border-line rounded-lg hover:bg-pill transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveBill}
                disabled={saving || !editBill.utility_name?.trim()}
                className="px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-line transition-colors"
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

      {showCreditModal && (
        <CreditModal
          credits={credits}
          onClose={() => setShowCreditModal(false)}
          onSave={() => load()}
        />
      )}

      {carryForwardBill && (
        <CarryForwardModal
          bill={carryForwardBill}
          allBills={bills}
          onClose={() => setCarryForwardBill(null)}
          onSave={async (sourceId, targetId, amount, notes) => {
            const patch = {
              balance_status: 'carried_forward' as BalanceStatus,
              carried_forward_amount: amount,
              carried_forward_to_bill_id: targetId ?? null,
            }
            await supabase.from('utility_bills').update(patch).eq('id', sourceId)
            await supabase.from('bill_carryovers').insert({
              source_bill_id: sourceId,
              target_bill_id: targetId ?? null,
              amount,
              notes: notes || null,
            })
            if (targetId) {
              const target = bills.find(b => b.id === targetId)
              if (target) {
                const newPrevBal = (target.previous_balance ?? 0) + amount
                const newTotalDue = newPrevBal + (target.current_charges ?? target.amount ?? 0)
                await supabase.from('utility_bills').update({
                  previous_balance: newPrevBal,
                  total_due: newTotalDue,
                  remaining_balance: newTotalDue - (target.amount_paid ?? 0),
                }).eq('id', targetId)
              }
            }
            setCarryForwardBill(null)
            load()
          }}
        />
      )}

      {partialPaymentBill && (
        <PartialPaymentModal
          bill={partialPaymentBill}
          onClose={() => setPartialPaymentBill(null)}
          onSave={savePartialPayment}
        />
      )}
    </div>
    </div>
  )
}

// ── CreditRow ──────────────────────────────────────────────────────────────────
// Renders a standalone account credit inline in the All Bills table, matching the bill
// row's column layout so the two interleave cleanly in the same chronological list.

function CreditRow({
  credit, balance, balanceTip, role, onDelete,
}: {
  credit: Credit
  balance: number
  balanceTip?: string
  role: Role | null
  onDelete: (id: string) => void
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const sym = 'US$' // credits are entered in USD/CAD-agnostic dollars; matches fmtBalance's default symbol usage elsewhere

  return (
    <tr className="hover:bg-pill/60 transition-colors">
      <td className="px-4 py-3">
        <span className={`inline-block text-xs font-bold ${CO_COLORS[credit.company_id]}`}>
          {credit.company_id.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="font-medium text-ink">{credit.utility_name}</span>
      </td>
      <td className="px-4 py-3 text-xs text-ink-faint">—</td>
      <td className="px-4 py-3 text-xs text-ink-faint">—</td>
      <td className="px-4 py-3 text-xs text-ink-muted font-mono">{credit.account_number ?? '—'}</td>
      <td className="px-4 py-3 text-right">
        <span className={`text-xs font-semibold ${balanceColor(balance)} cursor-help`} title={balanceTip}>{fmtBalance(balance, sym)}</span>
      </td>
      <td className="px-4 py-3">
        <span className="font-medium text-signal-pos">-{sym}{credit.amount.toFixed(2)}</span>
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">{fmtShortDate(credit.credit_date)}</td>
      <td className="px-4 py-3 text-xs text-ink-faint">—</td>
      <td className="px-4 py-3 text-xs text-ink-faint">—</td>
      <td className="px-4 py-3 max-w-[180px] text-xs text-ink-muted truncate" title={credit.note ?? ''}>{credit.note ?? '—'}</td>
      <td className="px-4 py-3">
        <span className="text-[10px] uppercase tracking-wide font-medium text-signal-pos">Credit</span>
      </td>
      {role === 'admin' && (
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {deleteConfirm ? (
              <span className="flex items-center gap-1 text-xs">
                <button onClick={() => onDelete(credit.id)} className="text-signal-neg font-semibold">Del</button>
                <button onClick={() => setDeleteConfirm(false)} className="text-ink-faint">✕</button>
              </span>
            ) : (
              <button onClick={() => setDeleteConfirm(true)} className="px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-signal-neg transition-colors" title="Delete">Del</button>
            )}
          </div>
        </td>
      )}
    </tr>
  )
}

// ── StatusDropdown ─────────────────────────────────────────────────────────────

function StatusDropdown({
  bill, onUpdate, onCarryForward, onPartialPayment,
}: {
  bill: Bill
  onUpdate: (bill: Bill, status: BalanceStatus) => void
  onCarryForward: (bill: Bill) => void
  onPartialPayment: (bill: Bill) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const status = computeBillStatus(bill)
  const badge = STATUS_BADGE[status]

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // Rough guess for the first paint; corrected below once the menu's real size is known.
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(v => !v)
  }

  // After the menu actually renders, flip it above the button (or clamp horizontally)
  // if it would otherwise overflow the viewport — a plain "open below" would get cut off
  // by the screen edge for buttons near the bottom, with no way to scroll it into view
  // since the menu is position:fixed.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !btnRef.current) return
    const btnRect = btnRef.current.getBoundingClientRect()
    const menuRect = menuRef.current.getBoundingClientRect()
    const margin = 8
    let top = btnRect.bottom + 4
    if (top + menuRect.height > window.innerHeight - margin) {
      top = btnRect.top - menuRect.height - 4
      if (top < margin) top = margin
    }
    let left = btnRect.left
    if (left + menuRect.width > window.innerWidth - margin) {
      left = window.innerWidth - menuRect.width - margin
    }
    if (left < margin) left = margin
    setPos(prev => (prev && prev.top === top && prev.left === left) ? prev : { top, left })
  }, [open])

  // Menu renders in a portal (escapes any ancestor overflow-hidden/scroll clipping,
  // e.g. the vendor-history accordion card), so outside-click/scroll must check both refs.
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (btnRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleScroll() { setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [open])

  const options: { status: BalanceStatus; label: string }[] = [
    { status: 'open',           label: 'Open' },
    { status: 'paid',           label: 'Paid ✓' },
    { status: 'waived',         label: 'Waived' },
  ]

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        className={`px-2 py-0.5 rounded bg-pill text-xs ${badge.className} hover:opacity-70 transition-opacity whitespace-nowrap`}
      >
        {badge.label} ▾
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-50 bg-white border border-line rounded-lg shadow-lg min-w-[150px]"
        >
          {options.map(opt => (
            <button
              key={opt.status}
              className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:bg-pill transition-colors"
              onClick={() => { onUpdate(bill, opt.status); setOpen(false) }}
            >
              {opt.label}
            </button>
          ))}
          <button
            className="w-full text-left px-3 py-2 text-xs text-amber-600 hover:bg-pill transition-colors"
            onClick={() => { onPartialPayment(bill); setOpen(false) }}
          >
            Paid (Late) / Partial…
          </button>
          <button
            className="w-full text-left px-3 py-2 text-xs text-purple-600 hover:bg-pill transition-colors border-t border-line-soft"
            onClick={() => { onCarryForward(bill); setOpen(false) }}
          >
            Carried Forward →
          </button>
        </div>,
        document.body
      )}
    </>
  )
}

// ── PartialPaymentModal ─────────────────────────────────────────────────────────

function PartialPaymentModal({
  bill, onClose, onSave,
}: {
  bill: Bill
  onClose: () => void
  onSave: (bill: Bill, amountPaid: number, paidAt: string, lateFee: number) => Promise<void>
}) {
  const baseTotal = bill.amount ?? bill.total_due ?? 0
  const [amountPaid, setAmountPaid] = useState(String(bill.amount_paid ?? ''))
  const [paidAt, setPaidAt] = useState(bill.paid_at ? bill.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10))
  const [lateFee, setLateFee] = useState(String(bill.late_fee ?? ''))
  const [saving, setSaving] = useState(false)

  const parsedAmount = parseFloat(amountPaid)
  const parsedLateFee = parseFloat(lateFee)
  const lateFeeValue = isNaN(parsedLateFee) ? 0 : parsedLateFee
  const effectiveTotal = baseTotal + lateFeeValue
  const remaining = !isNaN(parsedAmount) ? Math.max(effectiveTotal - parsedAmount, 0) : null
  const currencySymbol = bill.currency === 'USD' ? 'US$' : 'CA$'

  async function handle() {
    if (isNaN(parsedAmount) || parsedAmount < 0) return
    setSaving(true)
    await onSave(bill, parsedAmount, paidAt, lateFeeValue)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
          <h2 className="font-semibold text-ink">Record Payment</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-muted">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-ink-muted">
            <span className="font-medium">{bill.utility_name}</span>
            {bill.provider && ` · ${bill.provider}`}
            {' — Total Due: '}
            <span className="font-medium">{currencySymbol}{baseTotal.toFixed(2)}</span>
          </p>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Amount Paid So Far</label>
            <input
              type="number" step="0.01" value={amountPaid}
              onChange={e => setAmountPaid(e.target.value)}
              placeholder="0.00"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Payment Date</label>
            <input
              type="date" value={paidAt}
              onChange={e => setPaidAt(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Late Fee / Interest (if any)</label>
            <input
              type="number" step="0.01" value={lateFee}
              onChange={e => setLateFee(e.target.value)}
              placeholder="0.00"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </div>
          {remaining !== null && (
            <p className="text-xs text-ink-muted">
              {lateFeeValue > 0 && (
                <>Total incl. late fee: <span className="font-medium text-ink-muted">{currencySymbol}{effectiveTotal.toFixed(2)}</span> · </>
              )}
              Remaining balance: <span className="font-medium text-ink-muted">{currencySymbol}{remaining.toFixed(2)}</span>
            </p>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm text-ink-muted bg-pill rounded-lg hover:bg-line transition-colors">Cancel</button>
          <button onClick={handle} disabled={saving || amountPaid.trim() === ''}
            className="flex-1 px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-line transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CarryForwardModal ──────────────────────────────────────────────────────────

function CarryForwardModal({
  bill, allBills, onClose, onSave,
}: {
  bill: Bill
  allBills: Bill[]
  onClose: () => void
  onSave: (sourceId: string, targetId: string | null, amount: number, notes: string) => Promise<void>
}) {
  const defaultAmt = bill.remaining_balance ?? bill.amount ?? bill.total_due ?? 0
  const [amount, setAmount] = useState(String(defaultAmt))
  const [targetId, setTargetId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const candidates = allBills.filter(b =>
    b.id !== bill.id &&
    b.account_number === bill.account_number &&
    b.balance_status !== 'carried_forward' &&
    (b.due_date ?? '') > (bill.due_date ?? '')
  ).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

  async function handle() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) return
    setSaving(true)
    await onSave(bill.id, targetId || null, amt, notes)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
          <h2 className="font-semibold text-ink">Carry Forward Balance</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-muted">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-ink-muted">
            Moving balance from: <span className="font-medium">{bill.utility_name}</span>
            {bill.due_date ? ` (due ${bill.due_date})` : ''}
          </p>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Carryover Amount</label>
            <input
              type="number" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Target Bill (same account)</label>
            <select
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
            >
              <option value="">— None —</option>
              {candidates.map(b => (
                <option key={b.id} value={b.id}>
                  {b.utility_name} · {b.due_date ?? 'no date'} · {b.account_number}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Notes</label>
            <textarea
              rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink resize-none"
            />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm text-ink-muted bg-pill rounded-lg hover:bg-line transition-colors">Cancel</button>
          <button onClick={handle} disabled={saving}
            className="flex-1 px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-line transition-colors">
            {saving ? 'Saving…' : 'Carry Forward'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dashboard Tab ────────────────────────────────────────────────────────────

function monthYearLabel(b: Bill) {
  const dateStr = b.issue_date ?? b.due_date
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function BillExpandPanel({
  bill, role, onUpdateStatus, onCarryForward, onPartialPayment, onEdit,
  deleteConfirm, setDeleteConfirm, onDelete,
  noteEdit, setNoteEdit, onSaveNote,
}: {
  bill: Bill
  role: Role | null
  onUpdateStatus: (bill: Bill, status: BalanceStatus) => void
  onCarryForward: (bill: Bill) => void
  onPartialPayment: (bill: Bill) => void
  onEdit: (bill: Bill) => void
  deleteConfirm: string | null
  setDeleteConfirm: (id: string | null) => void
  onDelete: (id: string) => void
  noteEdit: { id: string; value: string } | null
  setNoteEdit: (v: { id: string; value: string } | null) => void
  onSaveNote: (id: string, notes: string) => void
}) {
  return (
    <div className="mt-2 pt-3 border-t border-line-soft grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div><span className="text-ink-faint">Bill #:</span> <span className="text-ink-muted font-mono">{bill.bill_number ?? '—'}</span></div>
      <div><span className="text-ink-faint">Account:</span> <span className="text-ink-muted font-mono">{bill.account_number ?? '—'}</span></div>
      <div><span className="text-ink-faint">Issued:</span> <span className="text-ink-muted">{fmtShortDate(bill.issue_date)}</span></div>
      <div><span className="text-ink-faint">Due:</span> <span className="text-ink-muted">{fmtShortDate(bill.due_date)}</span></div>
      <div className="col-span-2">
        <span className="text-ink-faint">Payment:</span>{' '}
        {bill.payment_methods ? (
          <span className="text-ink-muted">
            {bill.is_auto_pay && <span className="text-signal-pos mr-1">⟳</span>}
            {bill.payment_methods.label}
          </span>
        ) : bill.is_auto_pay ? (
          <span className="text-signal-pos">⟳ Auto</span>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </div>
      <div className="col-span-2">
        <span className="text-ink-faint">Notes:</span>{' '}
        {noteEdit?.id === bill.id ? (
          <span className="inline-flex gap-1 items-center w-full mt-1">
            <input
              autoFocus
              value={noteEdit.value}
              onChange={e => setNoteEdit({ id: bill.id, value: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') onSaveNote(bill.id, noteEdit.value)
                if (e.key === 'Escape') setNoteEdit(null)
              }}
              className="flex-1 min-w-0 text-sm border border-line rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ink"
            />
            <button onClick={() => onSaveNote(bill.id, noteEdit.value)} className="text-emerald-600 text-sm font-bold">✓</button>
            <button onClick={() => setNoteEdit(null)} className="text-ink-faint text-sm">✕</button>
          </span>
        ) : (
          <span
            onDoubleClick={() => setNoteEdit({ id: bill.id, value: bill.notes ?? '' })}
            className="text-ink-muted cursor-pointer hover:text-ink"
            title="Double-click to edit"
          >
            {bill.notes || <span className="text-ink-faint">+ double-click to add note</span>}
          </span>
        )}
      </div>
      <div className="col-span-2 flex items-center justify-between pt-1">
        <StatusDropdown bill={bill} onUpdate={onUpdateStatus} onCarryForward={onCarryForward} onPartialPayment={onPartialPayment} />
        {role === 'admin' && (
          <div className="flex items-center gap-2">
            {bill.onedrive_file_url && (
              <a href={bill.onedrive_file_url} target="_blank" rel="noreferrer"
                className="text-xs text-ink-faint hover:text-signal-pos transition-colors" title="Open file">File</a>
            )}
            <button onClick={() => onEdit(bill)} className="text-xs text-ink-faint hover:text-ink transition-colors" title="Edit">Edit</button>
            {deleteConfirm === bill.id ? (
              <span className="flex items-center gap-1 text-sm">
                <button onClick={() => onDelete(bill.id)} className="text-signal-neg font-semibold">Del</button>
                <button onClick={() => setDeleteConfirm(null)} className="text-ink-faint">✕</button>
              </span>
            ) : (
              <button onClick={() => setDeleteConfirm(bill.id)} className="text-xs text-ink-faint hover:text-signal-neg transition-colors" title="Delete">Del</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardTab({
  bills, overdueBills, currentBills,
  coFilter, setCoFilter, searchTerm, setSearchTerm,
  effectiveCompanyId,
  expandedVendor, setExpandedVendor,
  role, onUpdateStatus, onCarryForward, onPartialPayment, onEdit,
  deleteConfirm, setDeleteConfirm, onDelete,
  noteEdit, setNoteEdit, onSaveNote,
}: {
  bills: Bill[]
  overdueBills: Bill[]
  currentBills: Bill[]
  coFilter: Company | 'all'
  setCoFilter: (c: Company | 'all') => void
  searchTerm: string
  setSearchTerm: (s: string) => void
  effectiveCompanyId: (bill: Bill) => Company
  expandedVendor: string | null
  setExpandedVendor: (v: string | null) => void
  role: Role | null
  onUpdateStatus: (bill: Bill, status: BalanceStatus) => void
  onCarryForward: (bill: Bill) => void
  onPartialPayment: (bill: Bill) => void
  onEdit: (bill: Bill) => void
  deleteConfirm: string | null
  setDeleteConfirm: (id: string | null) => void
  onDelete: (id: string) => void
  noteEdit: { id: string; value: string } | null
  setNoteEdit: (v: { id: string; value: string } | null) => void
  onSaveNote: (id: string, notes: string) => void
}) {
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null)
  function toggleBill(id: string) {
    setExpandedBillId(prev => prev === id ? null : id)
  }

  // Year groups within a vendor's history: current year open by default,
  // older years collapsed by default — toggling flips from that default
  // independently per year, so any number of years can be open at once.
  const currentYear = new Date().getFullYear()
  const [toggledYearKeys, setToggledYearKeys] = useState<Set<string>>(new Set())
  function isYearOpen(year: number, key: string) {
    const defaultOpen = year === currentYear
    return toggledYearKeys.has(key) ? !defaultOpen : defaultOpen
  }
  function toggleYear(key: string) {
    setToggledYearKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function billYear(b: Bill): number {
    const dateStr = b.issue_date ?? b.due_date
    return dateStr ? new Date(dateStr + 'T00:00:00').getFullYear() : 0
  }
  // Scope the vendor history to the selected company + search term
  const scoped = bills.filter(b => {
    if (coFilter !== 'all' && effectiveCompanyId(b) !== coFilter) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      if (!b.utility_name.toLowerCase().includes(q) &&
          !(b.provider ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  // Group scoped bills by vendor (provider, falling back to utility name)
  const vendors = useMemo(() => {
    const map = new Map<string, Bill[]>()
    for (const b of scoped) {
      const key = b.provider ?? b.utility_name
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return Array.from(map.entries())
      .map(([name, bs]) => {
        const distinctAccounts = new Set(bs.map(b => b.account_number).filter((a): a is string => !!a))
        return {
          name,
          company_id: effectiveCompanyId(bs[0]),
          hasMultipleAccounts: distinctAccounts.size > 1,
          bills: [...bs].sort((a, b) => (b.issue_date ?? b.due_date ?? '').localeCompare(a.issue_date ?? a.due_date ?? '')),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coFilter, searchTerm, bills])

  const sortedCurrent = [...currentBills].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const sortedOverdue = [...overdueBills].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

  function renderBillRow(b: Bill, amountClassName: string, dateClassName: string) {
    const isOpen = expandedBillId === b.id
    return (
      <div key={b.id} className="py-2 first:pt-0 last:pb-0">
        <div
          onClick={() => toggleBill(b.id)}
          className="flex items-center justify-between gap-2 cursor-pointer"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-xs transition-transform inline-block ${isOpen ? 'rotate-90' : ''}`}>▸</span>
            <span className={`shrink-0 text-xs font-bold ${CO_COLORS[effectiveCompanyId(b)]}`}>{effectiveCompanyId(b).toUpperCase()}</span>
            <span className="text-sm font-medium text-ink truncate">{b.utility_name}</span>
            {b.provider && <span className="text-sm text-ink-faint hidden sm:inline">· {b.provider}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-sm font-medium ${amountClassName}`}>{fmtAmt(b)}</span>
            <span className={`text-sm ${dateClassName}`}>{dueDateLabel(b)}</span>
            {b.is_auto_pay ? (
              <span
                className="text-xs px-2 py-0.5 rounded bg-pill text-signal-pos font-medium"
                title="Automatically paid — no manual action needed"
              >
                ⟳ Auto Pay
              </span>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); onUpdateStatus(b, 'paid') }}
                className="text-xs px-2 py-0.5 rounded bg-ink text-white hover:bg-ink/90 transition-colors"
                title="Mark paid"
              >
                Paid
              </button>
            )}
          </div>
        </div>
        {isOpen && (
          <BillExpandPanel
            bill={b}
            role={role}
            onUpdateStatus={onUpdateStatus}
            onCarryForward={onCarryForward}
            onPartialPayment={onPartialPayment}
            onEdit={onEdit}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            onDelete={onDelete}
            noteEdit={noteEdit}
            setNoteEdit={setNoteEdit}
            onSaveNote={onSaveNote}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Current + Overdue bill lists */}
      <div className={`grid gap-3 mb-5 ${sortedCurrent.length > 0 && sortedOverdue.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {sortedOverdue.length > 0 && (
          <div className="bg-white border border-line rounded-xl p-4">
            <div className="text-signal-neg font-semibold text-base mb-3">Overdue ({sortedOverdue.length})</div>
            <div className="divide-y divide-line-soft">
              {sortedOverdue.map(b => renderBillRow(b, 'text-signal-neg', 'text-signal-neg'))}
            </div>
          </div>
        )}

        {sortedCurrent.length > 0 && (
          <div className="bg-white border border-line rounded-xl p-4">
            <div className="text-amber-600 font-semibold text-base mb-3">Current ({sortedCurrent.length})</div>
            <div className="divide-y divide-line-soft">
              {sortedCurrent.map(b => renderBillRow(b, 'text-ink', dueDateColor(b)))}
            </div>
          </div>
        )}

        {sortedOverdue.length === 0 && sortedCurrent.length === 0 && (
          <div className="bg-white rounded-xl border border-line p-6 text-center text-sm text-ink-faint">
            No current or overdue bills.
          </div>
        )}
      </div>

      {/* Company + search control row */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-white border border-line rounded-lg p-1">
          {COMPANIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCoFilter(c.id as Company | 'all')}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                coFilter === c.id ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search utility / provider…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="ml-auto px-3 py-1.5 text-sm border border-line rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-ink w-60"
        />
      </div>

      {/* Vendor-grouped monthly history (accordion) */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="px-4 py-3 border-b border-line-soft text-base font-semibold text-ink-muted">Bill History by Vendor</div>
        {vendors.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink-faint">No bills found.</div>
        ) : (
          <div className="divide-y divide-line-soft">
            {vendors.map(v => {
              const isOpen = expandedVendor === v.name
              return (
                <div key={v.name}>
                  <button
                    onClick={() => setExpandedVendor(isOpen ? null : v.name)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-pill transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm transition-transform inline-block ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                      <span className={`text-xs font-bold ${CO_COLORS[v.company_id]}`}>{v.company_id.toUpperCase()}</span>
                      <span className="font-medium text-ink text-base">{v.name}</span>
                    </div>
                    <span className="text-sm text-ink-faint">{v.bills.length} bill{v.bills.length !== 1 ? 's' : ''}</span>
                  </button>
                  {isOpen && (() => {
                    const byYear = new Map<number, Bill[]>()
                    for (const b of v.bills) {
                      const y = billYear(b)
                      if (!byYear.has(y)) byYear.set(y, [])
                      byYear.get(y)!.push(b)
                    }
                    const years = [...byYear.keys()].sort((a, b) => b - a)
                    return (
                      <div className="px-4 pb-3">
                        {years.map(year => {
                          const yearBills = byYear.get(year)!
                          const yearKey = `${v.name}-${year}`
                          const yearOpen = isYearOpen(year, yearKey)
                          return (
                            <div key={year}>
                              <button
                                onClick={() => toggleYear(yearKey)}
                                className="w-full flex items-center gap-2 py-1.5 pl-6 text-left hover:bg-pill transition-colors"
                              >
                                <span className={`text-xs transition-transform inline-block ${yearOpen ? 'rotate-90' : ''}`}>▸</span>
                                <span className="text-sm font-semibold text-ink-muted">{year || 'Unknown'}</span>
                                <span className="text-xs text-ink-faint">({yearBills.length})</span>
                              </button>
                              {yearOpen && yearBills.map(b => {
                                const isBillOpen = expandedBillId === b.id
                                return (
                                  <div key={b.id} className="pl-10 py-1.5 border-t border-line-soft first:border-t-0">
                                    <div
                                      onClick={() => toggleBill(b.id)}
                                      className="flex items-center justify-between gap-2 cursor-pointer"
                                    >
                                      <span className="flex items-center gap-2 min-w-0">
                                        {v.hasMultipleAccounts && (
                                          <span className="text-xs text-ink-faint font-mono truncate">{b.account_number ?? '—'}</span>
                                        )}
                                        <span className="text-sm font-semibold text-ink">{monthYearLabel(b)}</span>
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-ink">{fmtAmt(b)}</span>
                                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE[computeBillStatus(b)].className}`}>
                                          {STATUS_BADGE[computeBillStatus(b)].label}
                                        </span>
                                      </div>
                                    </div>
                                    {isBillOpen && (
                                      <BillExpandPanel
                                        bill={b}
                                        role={role}
                                        onUpdateStatus={onUpdateStatus}
                                        onCarryForward={onCarryForward}
                                        onPartialPayment={onPartialPayment}
                                        onEdit={onEdit}
                                        deleteConfirm={deleteConfirm}
                                        setDeleteConfirm={setDeleteConfirm}
                                        onDelete={onDelete}
                                        noteEdit={noteEdit}
                                        setNoteEdit={setNoteEdit}
                                        onSaveNote={onSaveNote}
                                      />
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}
      </div>
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
        const s = computeBillStatus(b)
        return s === 'overdue' || s === 'overdue_partial'
      }).length
      const amounts = sorted.filter(b => b.amount != null).map(b => b.amount!)
      const maxAmt = amounts.length ? Math.max(...amounts) : 0
      const minAmt = amounts.length ? Math.min(...amounts) : 0
      const avgAmt = amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0
      return { key, company_id: bs[0].company_id as Company, utility_name: bs[0].utility_name, provider: bs[0].provider, account_number: bs[0].account_number, bills: sorted, overdueCount, maxAmt, minAmt, avgAmt }
    })
  }, [bills])

  if (bills.length === 0) {
    return <div className="py-16 text-center text-sm text-ink-faint">No bills data yet.</div>
  }

  return (
    <div className="space-y-4">
      {utilities.map(({ key, company_id, utility_name, provider, account_number, bills: bs, overdueCount, maxAmt, minAmt, avgAmt }) => (
        <div key={key} className="bg-white rounded-xl border border-line p-5">
          {/* Utility header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold ${CO_COLORS[company_id]}`}>
                {company_id.toUpperCase()}
              </span>
              <span className="font-semibold text-ink">{utility_name}</span>
              {provider && <span className="text-xs text-ink-faint">· {provider}</span>}
              {account_number && <span className="text-xs text-ink-faint font-mono">({account_number})</span>}
            </div>
            <div className="flex items-center gap-2 text-xs">
              {overdueCount > 0 && (
                <span className="text-signal-neg font-semibold">
                  {overdueCount}x overdue
                </span>
              )}
              {bs.some(b => b.is_auto_pay) && (
                <span className="text-signal-pos font-medium">⟳ Auto-pay</span>
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
              <div key={s.label} className="bg-pill rounded-lg px-3 py-2">
                <div className="text-xs text-ink-muted mb-0.5">{s.label}</div>
                <div className="text-sm font-semibold text-ink">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Amount history table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-ink-faint border-b border-line-soft">
                  <th className="text-left pb-2 pr-3 font-medium">Period</th>
                  <th className="text-left pb-2 pr-3 font-medium">Bill #</th>
                  <th className="text-left pb-2 pr-3 font-medium">Issued</th>
                  <th className="text-left pb-2 pr-3 font-medium">Due</th>
                  <th className="text-right pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 font-medium w-36">Trend</th>
                  <th className="text-center pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {bs.slice(-10).map(b => {
                  const pct = maxAmt > 0 && b.amount != null ? (b.amount / maxAmt) * 100 : 0
                  const wasLate = b.is_paid && b.paid_at && b.due_date && b.paid_at.slice(0, 10) > b.due_date
                  const isCurrentlyOverdue = computeBillStatus(b) === 'overdue' || computeBillStatus(b) === 'overdue_partial'
                  return (
                    <tr key={b.id}>
                      <td className="py-2 pr-3 text-ink-muted">{b.billing_period ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-ink-muted">{b.bill_number ?? '—'}</td>
                      <td className="py-2 pr-3 text-ink-muted">{fmtShortDate(b.issue_date)}</td>
                      <td className="py-2 pr-3 text-ink-muted">{fmtShortDate(b.due_date)}</td>
                      <td className="py-2 pr-4 text-right font-semibold text-ink">
                        {b.amount != null ? fmtAmt(b) : '—'}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="bg-pill rounded-full h-2 w-36">
                          <div
                            className="h-2 rounded-full bg-ink/70 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-2 text-center">
                        {b.is_paid && !wasLate  && <span className="text-signal-pos font-bold" title="Paid on time">✓</span>}
                        {wasLate                 && <span className="text-amber-500 font-bold"   title="Paid late">⚠</span>}
                        {isCurrentlyOverdue      && <span className="text-signal-neg font-bold"     title="Overdue">!</span>}
                        {!b.is_paid && !isCurrentlyOverdue && <span className="text-ink-faint" title="Pending">·</span>}
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

// ── Payment Methods Modal ──────────────────────────────────────────────────────

function PaymentMethodsModal({
  methods, role, onClose, onSave
}: {
  methods: PaymentMethod[]
  role: Role | null
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
        <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
          <h2 className="font-semibold text-ink">Payment Methods</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-muted">✕</button>
        </div>

        <div className="px-6 py-3">
          {methods.length === 0 ? (
            <p className="text-sm text-ink-faint py-4 text-center">No payment methods yet.</p>
          ) : (
            <div className="space-y-2">
              {methods.map(m => (
                <div key={m.id} className="flex items-start justify-between gap-2 p-3 bg-pill rounded-lg border border-line">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold ${CO_COLORS[m.company_id]}`}>{m.company_id.toUpperCase()}</span>
                      <span className="text-sm font-medium text-ink">{m.label}</span>
                      {m.is_auto && <span className="text-xs text-signal-pos">⟳ Auto</span>}
                    </div>
                    {m.holder_name && <div className="text-xs text-ink-muted mt-1">{m.holder_name}</div>}
                    {m.card_brand  && <div className="text-xs text-ink-muted">{m.card_brand}</div>}
                    {m.bank_name   && <div className="text-xs text-ink-muted">{m.bank_name}</div>}
                    {m.notes       && <div className="text-xs text-ink-faint mt-1 italic">{m.notes}</div>}
                  </div>
                  {role === 'admin' && (
                    deleteId === m.id ? (
                      <span className="flex items-center gap-1 text-xs shrink-0">
                        <button onClick={() => deleteMethod(m.id)} className="text-signal-neg font-semibold">Del</button>
                        <button onClick={() => setDeleteId(null)} className="text-ink-faint">✕</button>
                      </span>
                    ) : (
                      <button onClick={() => setDeleteId(m.id)} className="text-ink-faint hover:text-signal-neg text-xs shrink-0">Del</button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {role === 'admin' && (
          <div className="px-6 pb-4 border-t border-line-soft pt-4 space-y-3">
            <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Add Payment Method</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Company</label>
                <select
                  value={form.company_id}
                  onChange={e => setForm(f => ({ ...f, company_id: e.target.value as Company }))}
                  className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                >
                  <option value="afs">AFS</option>
                  <option value="tnt">TNT</option>
                  <option value="zfs">ZFS</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Label *</label>
                <input
                  type="text"
                  placeholder="e.g. RBC Visa"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Card Holder Name</label>
                <input
                  type="text"
                  placeholder="e.g. John Kim"
                  value={form.holder_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, holder_name: e.target.value }))}
                  className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Card Brand / Bank</label>
                <input
                  type="text"
                  placeholder="e.g. Visa, RBC, Chase"
                  value={form.card_brand ?? ''}
                  onChange={e => setForm(f => ({ ...f, card_brand: e.target.value }))}
                  className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
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
                  className="w-4 h-4 accent-signal-pos"
                />
                <label htmlFor="pm_auto" className="text-sm text-ink-muted">Auto-pay</label>
              </div>
              <input
                type="text"
                placeholder="Notes (optional)"
                value={form.notes ?? ''}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="flex-1 border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </div>
            <button
              onClick={addMethod}
              disabled={saving || !form.label.trim()}
              className="w-full px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-line transition-colors"
            >
              {saving ? 'Adding…' : '+ Add Method'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Credit Modal ────────────────────────────────────────────────────────────────

function CreditModal({
  credits, onClose, onSave
}: {
  credits: Credit[]
  onClose: () => void
  onSave: () => void
}) {
  const emptyForm = {
    company_id: 'afs' as Company,
    utility_name: '',
    account_number: '',
    amount: '',
    credit_date: new Date().toISOString().slice(0, 10),
    note: '',
  }
  const [form,     setForm]    = useState(emptyForm)
  const [saving,   setSaving]  = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function addCredit() {
    const amount = parseFloat(form.amount)
    if (!form.utility_name.trim() || !amount || amount <= 0) return
    setSaving(true)
    await supabase.from('utility_credits').insert({
      company_id:     form.company_id,
      utility_name:   form.utility_name,
      account_number: form.account_number || null,
      amount,
      credit_date:    form.credit_date || null,
      note:           form.note || null,
    })
    setSaving(false)
    setForm(emptyForm)
    onSave()
  }

  async function deleteCredit(id: string) {
    await supabase.from('utility_credits').delete().eq('id', id)
    setDeleteId(null)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
          <h2 className="font-semibold text-ink">Account Credits</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-muted">✕</button>
        </div>

        <div className="px-6 py-3 text-xs text-ink-muted">
          A credit is money already paid to a vendor that isn't tied to any specific bill —
          e.g. a duplicate payment. It reduces that account's running balance and can push it negative.
        </div>

        <div className="px-6 py-3">
          {credits.length === 0 ? (
            <p className="text-sm text-ink-faint py-4 text-center">No credits recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {credits.map(c => (
                <div key={c.id} className="flex items-start justify-between gap-2 p-3 bg-pill rounded-lg border border-line">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold ${CO_COLORS[c.company_id]}`}>{c.company_id.toUpperCase()}</span>
                      <span className="text-sm font-medium text-ink">{c.utility_name}</span>
                      {c.account_number && <span className="text-xs text-ink-faint font-mono">({c.account_number})</span>}
                    </div>
                    <div className="text-sm text-signal-pos font-semibold mt-1">-${c.amount.toFixed(2)}</div>
                    {c.credit_date && <div className="text-xs text-ink-faint">{fmtShortDate(c.credit_date)}</div>}
                    {c.note && <div className="text-xs text-ink-faint mt-1 italic">{c.note}</div>}
                  </div>
                  {deleteId === c.id ? (
                    <span className="flex items-center gap-1 text-xs shrink-0">
                      <button onClick={() => deleteCredit(c.id)} className="text-signal-neg font-semibold">Del</button>
                      <button onClick={() => setDeleteId(null)} className="text-ink-faint">✕</button>
                    </span>
                  ) : (
                    <button onClick={() => setDeleteId(c.id)} className="text-ink-faint hover:text-signal-neg text-xs shrink-0">Del</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 pb-4 border-t border-line-soft pt-4 space-y-3">
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Add Credit</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Company</label>
              <select
                value={form.company_id}
                onChange={e => setForm(f => ({ ...f, company_id: e.target.value as Company }))}
                className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              >
                <option value="afs">AFS</option>
                <option value="tnt">TNT</option>
                <option value="zfs">ZFS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Utility Name *</label>
              <input
                type="text"
                placeholder="e.g. Water"
                value={form.utility_name}
                onChange={e => setForm(f => ({ ...f, utility_name: e.target.value }))}
                className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Account Number</label>
              <input
                type="text"
                placeholder="e.g. 10149626-106307"
                value={form.account_number}
                onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
                className="w-full border border-line rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Amount *</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Date</label>
              <input
                type="date"
                value={form.credit_date}
                onChange={e => setForm(f => ({ ...f, credit_date: e.target.value }))}
                className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Note</label>
              <input
                type="text"
                placeholder="e.g. Duplicate EFT payment"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                className="w-full border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </div>
          </div>
          <button
            onClick={addCredit}
            disabled={saving || !form.utility_name.trim() || !form.amount}
            className="w-full px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-line transition-colors"
          >
            {saving ? 'Adding…' : '+ Add Credit'}
          </button>
        </div>
      </div>
    </div>
  )
}

