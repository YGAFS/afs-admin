export type BalanceStatus = 'open' | 'partially_paid' | 'paid' | 'carried_forward' | 'waived'
export type InvoiceStatus = 'active' | 'void'

export type BillStatusResult =
  | 'paid'
  | 'carried_forward'
  | 'waived'
  | 'void'
  | 'overdue_partial'
  | 'overdue'
  | 'due_today'
  | 'upcoming'
  | 'open'

export interface BillForStatus {
  balance_status: BalanceStatus
  invoice_status: InvoiceStatus | null
  due_date: string | null
}

export function computeBillStatus(bill: BillForStatus): BillStatusResult {
  if (bill.invoice_status === 'void') return 'void'
  const s = bill.balance_status
  if (s === 'paid') return 'paid'
  if (s === 'carried_forward') return 'carried_forward'
  if (s === 'waived') return 'waived'
  if (!bill.due_date) return s === 'partially_paid' ? 'overdue_partial' : 'open'
  const today = new Date(new Date().toDateString())
  const due = new Date(bill.due_date + 'T00:00:00')
  if (s === 'partially_paid') return due < today ? 'overdue_partial' : 'upcoming'
  if (due < today) return 'overdue'
  if (due.getTime() === today.getTime()) return 'due_today'
  return 'upcoming'
}

export function isActiveOutstanding(bill: BillForStatus): boolean {
  const s = computeBillStatus(bill)
  return s === 'open' || s === 'overdue' || s === 'due_today' || s === 'upcoming' || s === 'overdue_partial'
}

export const STATUS_BADGE: Record<BillStatusResult, { label: string; className: string }> = {
  paid:            { label: 'Paid',              className: 'bg-emerald-100 text-emerald-700' },
  carried_forward: { label: 'Carried Forward',   className: 'bg-purple-100 text-purple-700' },
  waived:          { label: 'Waived',            className: 'bg-gray-100 text-gray-500' },
  void:            { label: 'Void',              className: 'bg-gray-100 text-gray-400' },
  overdue:         { label: 'Overdue',           className: 'bg-red-100 text-red-700' },
  overdue_partial: { label: 'Overdue (Partial)', className: 'bg-orange-100 text-orange-700' },
  due_today:       { label: 'Due Today',         className: 'bg-yellow-100 text-yellow-700' },
  upcoming:        { label: 'Upcoming',          className: 'bg-blue-100 text-blue-700' },
  open:            { label: 'Open',              className: 'bg-slate-100 text-slate-600' },
}
