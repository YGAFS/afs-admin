'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import { computeBillStatus, STATUS_BADGE } from '@/lib/billStatus'
import type { BalanceStatus, InvoiceStatus } from '@/lib/billStatus'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

type Company = 'afs' | 'tnt' | 'zfs'

interface Bill {
  id: string
  company_id: Company
  utility_name: string
  provider: string | null
  amount: number | null
  currency: string
  issue_date: string | null
  due_date: string | null
  bill_number: string | null
  is_paid: boolean
  balance_status: BalanceStatus
  invoice_status: InvoiceStatus | null
}

const CO_DOT: Record<Company, string> = {
  afs: 'bg-blue-500',
  tnt: 'bg-amber-500',
  zfs: 'bg-emerald-500',
}

const STATUS_DOT: Record<ReturnType<typeof computeBillStatus>, string> = {
  paid:            'bg-signal-pos',
  paid_late:       'bg-amber-400',
  carried_forward: 'bg-purple-400',
  waived:          'bg-ink-faint',
  void:            'bg-ink-faint',
  overdue:         'bg-signal-neg',
  overdue_partial: 'bg-signal-neg',
  due_today:       'bg-amber-500',
  upcoming:        'bg-amber-400',
  open:            'bg-ink-faint',
}

function fmtAmt(bill: Bill) {
  if (bill.amount == null) return '—'
  return `${bill.currency === 'USD' ? 'US$' : 'CA$'}${bill.amount.toFixed(2)}`
}

export default function CalendarPage() {
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)

  const todayReal = new Date()
  const [year, setYear] = useState(todayReal.getFullYear())
  const [month, setMonth] = useState(todayReal.getMonth())
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    supabase
      .from('utility_bills')
      .select('id,company_id,utility_name,provider,amount,currency,issue_date,due_date,bill_number,is_paid,balance_status,invoice_status')
      .then(({ data }) => {
        setBills((data as Bill[]) ?? [])
        setLoading(false)
      })
  }, [])

  async function togglePaid(bill: Bill) {
    const newPaid = bill.balance_status !== 'paid'
    const patch = {
      is_paid: newPaid,
      balance_status: newPaid ? 'paid' : 'open',
      paid_at: newPaid ? new Date().toISOString() : null,
    }
    await supabase.from('utility_bills').update(patch).eq('id', bill.id)
    setBills(bs => bs.map(b => b.id === bill.id ? { ...b, ...patch, balance_status: patch.balance_status as BalanceStatus } : b))
  }

  const firstDow = new Date(year, month, 1).getDay()
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
  const selectedDue = selected ? (billsByDue.get(dateKey(selected)) ?? []) : []
  const selectedIssued = selected ? (billsByIssue.get(dateKey(selected)) ?? []) : []

  if (loading) {
    return <div className="p-6 text-sm text-ink-faint">Loading...</div>
  }

  return (
    <div className="h-full overflow-auto">
    <div className="p-6">
      {/* Month nav */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <button onClick={prevMonth} className="px-4 py-2 text-lg border border-line rounded-lg bg-white hover:bg-pill transition-colors">‹</button>
        <span className="font-semibold text-ink text-2xl">{monthLabel}</span>
        <button onClick={nextMonth} className="px-4 py-2 text-lg border border-line rounded-lg bg-white hover:bg-pill transition-colors">›</button>
      </div>

      {/* Grid */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-pill">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-3 text-center text-base font-semibold text-ink-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={i} className="border-r border-b border-line-soft min-h-[130px] bg-pill/40" />
            }
            const key = dateKey(day)
            const dueBills = billsByDue.get(key) ?? []
            const issuedBills = billsByIssue.get(key) ?? []
            const isToday = day === todayReal.getDate() && month === todayReal.getMonth() && year === todayReal.getFullYear()
            const isSelected = selected === day
            const shownIssued = issuedBills.slice(0, 2)
            const shownDue = dueBills.slice(0, 3 - shownIssued.length)
            const overflow = (dueBills.length + issuedBills.length) - (shownIssued.length + shownDue.length)

            return (
              <div
                key={i}
                onClick={() => setSelected(isSelected ? null : day)}
                className={`border-r border-b border-line-soft min-h-[130px] p-2 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50/60' : 'hover:bg-pill/60'}`}
              >
                <div className={`text-base font-semibold mb-1.5 w-8 h-8 flex items-center justify-center rounded-full ${isToday ? 'bg-ink text-white' : isSelected ? 'text-signal-pos' : 'text-ink'}`}>
                  {day}
                </div>
                <div className="space-y-1">
                  {shownIssued.map(b => (
                    <div key={`i-${b.id}`} className="flex items-center gap-1.5 text-xs leading-tight" title={`Issued: [${b.company_id.toUpperCase()}] ${b.provider ?? b.utility_name}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-ink-faint shrink-0" />
                      <span className="truncate text-ink-muted">{b.provider ?? b.utility_name}</span>
                    </div>
                  ))}
                  {shownDue.map(b => (
                    <div key={`d-${b.id}`} className="flex items-center gap-1.5 text-xs leading-tight"
                      title={`Due: [${b.company_id.toUpperCase()}] ${b.provider ?? b.utility_name}${b.amount != null ? ` (${fmtAmt(b)})` : ''}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[computeBillStatus(b)]}`} />
                      <span className="truncate text-ink-muted">{b.provider ?? b.utility_name}</span>
                    </div>
                  ))}
                </div>
                {overflow > 0 && (
                  <div className="text-xs text-ink-faint mt-1">+{overflow} more</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selected !== null && (selectedDue.length > 0 || selectedIssued.length > 0) && (
        <div className="mt-4 bg-white rounded-xl border border-line p-4">
          <div className="font-semibold text-ink mb-3 text-base">
            {new Date(year, month, selected).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          {selectedIssued.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">Issued</div>
              <div className="space-y-2">
                {selectedIssued.map(b => (
                  <div key={b.id} className="flex items-center gap-2 text-base">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${CO_DOT[b.company_id]}`} />
                    <span className="text-xs font-semibold text-ink-muted">{b.company_id.toUpperCase()}</span>
                    <span className="font-medium text-ink">{b.provider ?? b.utility_name}</span>
                    {b.provider && <span className="text-ink-faint text-sm">· {b.utility_name}</span>}
                    {b.bill_number && <span className="text-ink-faint text-sm font-mono">#{b.bill_number}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {selectedDue.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">Due</div>
              <div className="space-y-2">
                {selectedDue.map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-base min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${CO_DOT[b.company_id]}`} />
                      <span className="text-xs font-semibold text-ink-muted shrink-0">{b.company_id.toUpperCase()}</span>
                      <span className="font-medium text-ink truncate">{b.provider ?? b.utility_name}</span>
                      {b.provider && <span className="text-ink-faint text-sm hidden sm:inline">· {b.utility_name}</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-base font-medium text-ink">{fmtAmt(b)}</span>
                      <span className={`text-sm font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE[computeBillStatus(b)].className}`}>
                        {STATUS_BADGE[computeBillStatus(b)].label}
                      </span>
                      <input type="checkbox" checked={b.is_paid} onChange={() => togglePaid(b)} className="w-4 h-4 accent-signal-pos cursor-pointer" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-ink-faint inline-block" />Issued</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Due (unpaid)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-signal-neg inline-block" />Overdue</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-signal-pos inline-block" />Paid</span>
      </div>
    </div>
    </div>
  )
}
