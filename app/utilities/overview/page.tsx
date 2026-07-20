'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState, Suspense } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

// ── Types ─────────────────────────────────────────────────────────────────────

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
  billing_month: number | null
  billing_period: string | null
  is_paid: boolean
  paid_at: string | null
  created_at: string
}

interface Vendor {
  id: string
  company_id: Company
  name: string
  service_type: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toCAD(amount: number | null, currency: string): number {
  if (amount == null) return 0
  return currency === 'USD' ? amount * 1.36 : amount
}

function isOverdue(b: Bill) {
  if (b.is_paid || !b.due_date) return false
  return new Date(b.due_date) < new Date(new Date().toDateString())
}

function fmtAmt(n: number, prefix = 'CA$') {
  return `${prefix}${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtShort(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const CO_COLORS: Record<Company, string> = {
  afs: 'bg-blue-100 text-blue-700',
  tnt: 'bg-amber-100 text-amber-700',
  zfs: 'bg-emerald-100 text-emerald-700',
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

function DonutChart({ paid, upcoming, overdue }: { paid: number; upcoming: number; overdue: number }) {
  const total = paid + upcoming + overdue
  if (total === 0) return <div className="w-40 h-40 rounded-full bg-gray-100 mx-auto" />

  const R = 56, CX = 70, CY = 70, strokeW = 20
  const circ = 2 * Math.PI * R

  function slice(value: number, offset: number) {
    const dash = (value / total) * circ
    return { strokeDasharray: `${dash} ${circ - dash}`, strokeDashoffset: -offset * circ / total }
  }

  const paidDash     = slice(paid, 0)
  const upcomingDash = slice(upcoming, paid)
  const overdueDash  = slice(overdue, paid + upcoming)

  return (
    <div className="relative flex-shrink-0">
      <svg width={140} height={140} className="rotate-[-90deg]">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#e5e7eb" strokeWidth={strokeW} />
        {paid > 0 && (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#10b981" strokeWidth={strokeW}
            strokeDasharray={paidDash.strokeDasharray}
            strokeDashoffset={paidDash.strokeDashoffset}
            strokeLinecap="butt"
          />
        )}
        {upcoming > 0 && (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f59e0b" strokeWidth={strokeW}
            strokeDasharray={upcomingDash.strokeDasharray}
            strokeDashoffset={upcomingDash.strokeDashoffset}
            strokeLinecap="butt"
          />
        )}
        {overdue > 0 && (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#ef4444" strokeWidth={strokeW}
            strokeDasharray={overdueDash.strokeDasharray}
            strokeDashoffset={overdueDash.strokeDashoffset}
            strokeLinecap="butt"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{total}</span>
        <span className="text-xs text-gray-500">Total Bills</span>
      </div>
    </div>
  )
}

// ── Sparkline (monthly trend) ─────────────────────────────────────────────────

function SparkLine({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const W = 320, H = 80, pad = 10
  const xStep = (W - pad * 2) / (data.length - 1)

  const points = data.map((v, i) => {
    const x = pad + i * xStep
    const y = H - pad - ((v / max) * (H - pad * 2))
    return `${x},${y}`
  }).join(' ')

  const areaPoints = [
    `${pad},${H - pad}`,
    ...data.map((v, i) => `${pad + i * xStep},${H - pad - ((v / max) * (H - pad * 2))}`),
    `${pad + (data.length - 1) * xStep},${H - pad}`,
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparkGrad)" />
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((v, i) => (
        <circle key={i} cx={pad + i * xStep} cy={H - pad - ((v / max) * (H - pad * 2))} r="3" fill="#3b82f6" />
      ))}
    </svg>
  )
}

// ── Main Overview Content ─────────────────────────────────────────────────────

function OverviewContent() {
  const searchParams = useSearchParams()
  const coFilter     = searchParams.get('company') as Company | null

  const [bills,   setBills]   = useState<Bill[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: b }, { data: v }] = await Promise.all([
        supabase.from('utility_bills').select('*').order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('utility_vendors').select('id,company_id,name,service_type'),
      ])
      setBills((b as Bill[]) ?? [])
      setVendors((v as Vendor[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() =>
    coFilter ? bills.filter(b => b.company_id === coFilter) : bills,
    [bills, coFilter]
  )

  const filteredVendors = useMemo(() =>
    coFilter ? vendors.filter(v => v.company_id === coFilter) : vendors,
    [vendors, coFilter]
  )

  // ── Stats ──────────────────────────────────────────────────────────────────

  const today    = new Date()
  const thisYear = today.getFullYear()
  const thisMon  = today.getMonth() + 1
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7)

  const stats = useMemo(() => {
    const thisMonthBills = filtered.filter(b => {
      if (!b.due_date) return false
      const d = new Date(b.due_date)
      return d.getFullYear() === thisYear && (d.getMonth() + 1) === thisMon
    })

    const overdueBills = filtered.filter(isOverdue)

    const dueThisWeekBills = filtered.filter(b => {
      if (b.is_paid || !b.due_date) return false
      const d = new Date(b.due_date + 'T00:00:00')
      return d >= today && d <= nextWeek
    })

    const paidThisMonthBills = filtered.filter(b => {
      if (!b.is_paid || !b.paid_at) return false
      const d = new Date(b.paid_at)
      return d.getFullYear() === thisYear && (d.getMonth() + 1) === thisMon
    })

    return {
      totalMonthlySpend:  thisMonthBills.reduce((s, b) => s + toCAD(b.amount, b.currency), 0),
      overdueAmt:         overdueBills.reduce((s, b) => s + toCAD(b.amount, b.currency), 0),
      overdueCount:       overdueBills.length,
      dueThisWeekAmt:     dueThisWeekBills.reduce((s, b) => s + toCAD(b.amount, b.currency), 0),
      dueThisWeekCount:   dueThisWeekBills.length,
      paidThisMonthAmt:   paidThisMonthBills.reduce((s, b) => s + toCAD(b.amount, b.currency), 0),
      paidThisMonthCount: paidThisMonthBills.length,
      totalVendors:       filteredVendors.length,
    }
  }, [filtered, filteredVendors, thisYear, thisMon])

  // ── Monthly trend (last 6 months) ─────────────────────────────────────────

  const monthlyTrend = useMemo(() => {
    const months: { label: string; key: string }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(thisYear, thisMon - 1 - i, 1)
      months.push({
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      })
    }
    return months.map(m => ({
      label: m.label,
      value: filtered
        .filter(b => b.due_date && b.due_date.startsWith(m.key))
        .reduce((s, b) => s + toCAD(b.amount, b.currency), 0),
    }))
  }, [filtered, thisYear, thisMon])

  // ── Bill status ───────────────────────────────────────────────────────────

  const billStatus = useMemo(() => {
    const paid     = filtered.filter(b => b.is_paid).length
    const overdue  = filtered.filter(isOverdue).length
    const upcoming = filtered.filter(b => !b.is_paid && !isOverdue(b)).length
    return { paid, overdue, upcoming }
  }, [filtered])

  // ── Top 5 vendors by spend ────────────────────────────────────────────────

  const topVendors = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of filtered) {
      if (!b.provider) continue
      map.set(b.provider, (map.get(b.provider) ?? 0) + toCAD(b.amount, b.currency))
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount }))
  }, [filtered])

  const topMax = topVendors[0]?.amount ?? 1

  // ── Upcoming / Overdue lists ───────────────────────────────────────────────

  const upcomingBills = useMemo(() =>
    filtered
      .filter(b => !b.is_paid && !isOverdue(b) && b.due_date)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
      .slice(0, 5),
    [filtered]
  )

  const overdueBills = useMemo(() =>
    filtered
      .filter(isOverdue)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
      .slice(0, 5),
    [filtered]
  )

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard
          icon="💰"
          label="Total Monthly Spend"
          value={fmtAmt(stats.totalMonthlySpend)}
          sub={`${filtered.filter(b => { if (!b.due_date) return false; const d = new Date(b.due_date); return d.getFullYear() === thisYear && (d.getMonth()+1) === thisMon }).length} bills this month`}
          color="text-gray-900"
        />
        <StatCard
          icon="⚠️"
          label="Overdue Amount"
          value={fmtAmt(stats.overdueAmt)}
          sub={`${stats.overdueCount} bills`}
          color="text-red-600"
          bg="bg-red-50"
        />
        <StatCard
          icon="📅"
          label="Due This Week"
          value={fmtAmt(stats.dueThisWeekAmt)}
          sub={`${stats.dueThisWeekCount} bills`}
          color="text-amber-600"
          bg="bg-amber-50"
        />
        <StatCard
          icon="✅"
          label="Paid This Month"
          value={fmtAmt(stats.paidThisMonthAmt)}
          sub={`${stats.paidThisMonthCount} bills`}
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
        <StatCard
          icon="🏢"
          label="Total Vendors"
          value={String(stats.totalVendors)}
          sub="Active vendors"
          color="text-blue-600"
          bg="bg-blue-50"
        />
      </div>

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Monthly Spend Trend */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Monthly Spend Trend</h2>
          </div>
          <div className="h-24">
            <SparkLine data={monthlyTrend.map(m => m.value)} />
          </div>
          <div className="flex justify-between mt-2">
            {monthlyTrend.map(m => (
              <span key={m.label} className="text-xs text-gray-400">{m.label}</span>
            ))}
          </div>
        </div>

        {/* Bill Status Summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Bill Status Summary</h2>
          <div className="flex items-center gap-5">
            <DonutChart
              paid={billStatus.paid}
              upcoming={billStatus.upcoming}
              overdue={billStatus.overdue}
            />
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-gray-600">Paid</span>
                <span className="ml-auto font-semibold text-gray-900">{billStatus.paid}</span>
                <span className="text-gray-400 text-xs">({filtered.length > 0 ? Math.round(billStatus.paid / filtered.length * 100) : 0}%)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
                <span className="text-gray-600">Due (Upcoming)</span>
                <span className="ml-auto font-semibold text-gray-900">{billStatus.upcoming}</span>
                <span className="text-gray-400 text-xs">({filtered.length > 0 ? Math.round(billStatus.upcoming / filtered.length * 100) : 0}%)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
                <span className="text-gray-600">Overdue</span>
                <span className="ml-auto font-semibold text-gray-900">{billStatus.overdue}</span>
                <span className="text-gray-400 text-xs">({filtered.length > 0 ? Math.round(billStatus.overdue / filtered.length * 100) : 0}%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Top vendors + bottom panels ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Top 5 Vendors */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Top 5 Vendors by Spend</h2>
            <span className="text-xs text-gray-400">This Month</span>
          </div>
          {topVendors.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No data</p>
          ) : (
            <div className="space-y-3">
              {topVendors.map(v => (
                <div key={v.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 truncate max-w-[60%]">{v.name}</span>
                    <span className="font-medium text-gray-900">{fmtAmt(v.amount)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full">
                    <div
                      className="h-1.5 bg-blue-500 rounded-full"
                      style={{ width: `${(v.amount / topMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Bills */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Upcoming Bills</h2>
            <span className="text-xs text-gray-400">Next 7 Days</span>
          </div>
          {upcomingBills.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No upcoming bills</p>
          ) : (
            <div className="space-y-3">
              {upcomingBills.map(b => {
                const days = b.due_date
                  ? Math.ceil((new Date(b.due_date).getTime() - today.getTime()) / 86400000)
                  : null
                return (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{b.provider ?? b.utility_name}</p>
                      <p className="text-xs text-gray-400">{b.company_id.toUpperCase()} · {fmtShort(b.due_date)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="font-medium text-gray-900">{fmtAmt(toCAD(b.amount, b.currency))}</p>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`} left
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <Link href="/utilities/bills" className="mt-4 block text-xs text-blue-600 hover:underline">
            View all upcoming bills →
          </Link>
        </div>

        {/* Overdue Bills */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-red-600">Overdue Bills</h2>
          </div>
          {overdueBills.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No overdue bills 🎉</p>
          ) : (
            <div className="space-y-3">
              {overdueBills.map(b => {
                const days = b.due_date
                  ? Math.floor((today.getTime() - new Date(b.due_date + 'T00:00:00').getTime()) / 86400000)
                  : null
                return (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{b.provider ?? b.utility_name}</p>
                      <p className="text-xs text-gray-400">{b.company_id.toUpperCase()} · {fmtShort(b.due_date)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="font-medium text-gray-900">{fmtAmt(toCAD(b.amount, b.currency))}</p>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                        {days}d overdue
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <Link href="/utilities/bills" className="mt-4 block text-xs text-blue-600 hover:underline">
            View all overdue bills →
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, color = 'text-gray-900', bg = 'bg-white'
}: {
  icon: string; label: string; value: string; sub: string
  color?: string; bg?: string
}) {
  return (
    <div className={`${bg} rounded-xl border border-gray-200 p-4`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
          <p className={`text-xl font-bold ${color} leading-tight truncate`}>{value}</p>
          <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
        </div>
      </div>
    </div>
  )
}

// ── Page export (wrapped in Suspense for useSearchParams) ─────────────────────

export default function OverviewPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-4">
        {[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
      </div>
    }>
      <OverviewContent />
    </Suspense>
  )
}
