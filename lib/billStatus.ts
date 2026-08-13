export type BalanceStatus = 'open' | 'partially_paid' | 'paid' | 'carried_forward' | 'waived'
export type InvoiceStatus = 'active' | 'void'

export type BillStatusResult =
  | 'paid'
  | 'paid_late'
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
  paid_at?: string | null
}

export function computeBillStatus(bill: BillForStatus): BillStatusResult {
  if (bill.invoice_status === 'void') return 'void'
  const s = bill.balance_status
  if (s === 'paid') {
    // Paid, but only after the due date had already passed — surface this distinctly
    // from an on-time payment instead of collapsing it into a plain "Paid" badge.
    if (bill.due_date && bill.paid_at && bill.paid_at.slice(0, 10) > bill.due_date) return 'paid_late'
    return 'paid'
  }
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
  paid:            { label: 'Paid',              className: 'text-signal-pos font-semibold' },
  paid_late:       { label: 'Paid (Late)',       className: 'text-amber-600 font-semibold' },
  carried_forward: { label: 'Carried Forward',   className: 'text-purple-600 font-semibold' },
  waived:          { label: 'Waived',            className: 'text-ink-faint font-medium' },
  void:            { label: 'Void',              className: 'text-ink-faint font-medium' },
  overdue:         { label: 'Overdue',           className: 'text-signal-neg font-semibold' },
  overdue_partial: { label: 'Overdue (Partial)', className: 'text-signal-neg font-semibold' },
  due_today:       { label: 'Due Today',         className: 'text-amber-600 font-semibold' },
  upcoming:        { label: 'Upcoming',          className: 'text-ink-muted font-medium' },
  open:            { label: 'Open',              className: 'text-ink-muted font-medium' },
}
