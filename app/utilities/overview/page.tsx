'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState, Suspense } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { computeBillStatus, isActiveOutstanding } from '@/lib/billStatus'
import type { BalanceStatus, InvoiceStatus } from '@/lib/billStatus'

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
  previous_balance: number | null
  current_charges: number | null
  currency: string
  issue_date: string | null
  due_date: string | null
  billing_month: number | null
  billing_year: number | null
  billing_period: string | null
  is_paid: boolean
  paid_at: string | null
  onedrive_file_url: string | null
  account_number: string | null
  location_id: string | null
  balance_status: BalanceStatus
  invoice_status: InvoiceStatus | null
  total_due: number | null
  remaining_balance: number | null
}

interface Vendor {
  id: string
  company_id: Company
  name: string
  service_type: string | null
}

interface Location {
  id: string
  company_id: Company
  name: string
  city: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const USD_RATE = 1.36

function toCAD(amount: number | null, currency: string): number {
  if (amount == null) return 0
  return currency === 'USD' ? amount * USD_RATE : amount
}

function currentChargesCAD(b: Bill): number {
  // Prefer current_charges if available, else fall back to amount
  if (b.current_charges != null) return toCAD(b.current_charges, b.currency)
  return toCAD(b.amount, b.currency)
}

function totalDueCAD(b: Bill): number {
  // Total = previous_balance + current_charges, or fall back to amount
  if (b.current_charges != null) {
    const prev = b.previous_balance ?? 0
    return toCAD(prev + b.current_charges, b.currency)
  }
  return toCAD(b.amount, b.currency)
}

function fmtAmt(n: number, prefix = 'CA$') {
  return `${prefix}${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtShort(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

// ── Abnormal detection ────────────────────────────────────────────────────────
// Returns true if current_charges is >25% above or below the trailing 3-month avg

function isAbnormal(bill: Bill, allBills: Bill[]): boolean {
  const charges = bill.current_charges ?? bill.amount
  if (charges == null || charges <= 0) return false

  const key = `${bill.provider ?? bill.utility_name}|${bill.account_number ?? ''}`
  const billYYMM = bill.billing_year && bill.billing_month
    ? monthKey(bill.billing_year, bill.billing_month)
    : bill.due_date?.slice(0, 7) ?? null

  if (!billYYMM) return false

  // Get last 3 completed months for same provider/account (exclude this bill)
  const peers = allBills
    .filter(b => {
      if (b.id === bill.id) return false
      const bKey = `${b.provider ?? b.utility_name}|${b.account_number ?? ''}`
      if (bKey !== key) return false
      const bYYMM = b.billing_year && b.billing_month
        ? monthKey(b.billing_year, b.billing_month)
        : b.due_date?.slice(0, 7) ?? null
      return bYYMM !== null && bYYMM < billYYMM
    })
    .sort((a, b) => {
      const aK = a.billing_year && a.billing_month ? monthKey(a.billing_year, a.billing_month) : a.due_date?.slice(0, 7) ?? ''
      const bK = b.billing_year && b.billing_month ? monthKey(b.billing_year, b.billing_month) : b.due_date?.slice(0, 7) ?? ''
      return bK.localeCompare(aK)
    })
    .slice(0, 3)

  if (peers.length < 2) return false

  const avg = peers.reduce((s, b) => s + (b.current_charges ?? b.amount ?? 0), 0) / peers.length
  if (avg === 0) return false

  const ratio = charges / avg
  return ratio > 1.25 || ratio < 0.75
}

// ── Missing bill detection ────────────────────────────────────────────────────
// A provider/account is "missing" if it had a bill last month but nothing this month

interface MissingBill {
  provider: string
  account_number: string | null
  company_id: Company
  lastBillDate: string
  expectedMonth: string
}

function detectMissing(bills: Bill[], today: Date): MissingBill[] {
  const thisYear  = today.getFullYear()
  const thisMon   = today.getMonth() + 1
  const lastYear  = thisMon === 1 ? thisYear - 1 : thisYear
  const lastMon   = thisMon === 1 ? 12 : thisMon - 1

  const thisMonKey = monthKey(thisYear, thisMon)
  const lastMonKey = monthKey(lastYear, lastMon)

  // Group bills by provider+account
  const grouped = new Map<string, Bill[]>()
  bills.forEach(b => {
    const k = `${b.provider ?? b.utility_name}|${b.account_number ?? ''}|${b.company_id}`
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(b)
  })

  const missing: MissingBill[] = []
  grouped.forEach((group, k) => {
    const hadLastMonth = group.some(b => {
      const bKey = b.billing_year && b.billing_month
        ? monthKey(b.billing_year, b.billing_month)
        : b.due_date?.slice(0, 7) ?? ''
      return bKey === lastMonKey
    })
    const hasThisMonth = group.some(b => {
      const bKey = b.billing_year && b.billing_month
        ? monthKey(b.billing_year, b.billing_month)
        : b.due_date?.slice(0, 7) ?? ''
      return bKey === thisMonKey
    })

    // Only flag if we're past the 5th (bills usually arrive early month)
    if (hadLastMonth && !hasThisMonth && today.getDate() >= 5) {
      const [provider, account_number, company_id] = k.split('|')
      const lastBill = group.find(b => {
        const bKey = b.billing_year && b.billing_month
          ? monthKey(b.billing_year, b.billing_month)
          : b.due_date?.slice(0, 7) ?? ''
        return bKey === lastMonKey
      })
      missing.push({
        provider,
        account_number: account_number || null,
        company_id: company_id as Company,
        lastBillDate: lastBill?.due_date ?? '',
        expectedMonth: new Date(thisYear, thisMon - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      })
    }
  })

  return missing
}

// ── Next expected billing date ────────────────────────────────────────────────

function nextExpectedDate(bills: Bill[], provider: string, account: string | null): Date | null {
  const group = bills
    .filter(b => (b.provider ?? b.utility_name) === provider && (b.account_number ?? null) === account && b.due_date)
    .sort((a, b) => b.due_date!.localeCompare(a.due_date!))

  if (group.length < 2) return null

  const gaps: number[] = []
  for (let i = 0; i < Math.min(group.length - 1, 3); i++) {
    const a = new Date(group[i].due_date! + 'T00:00:00')
    const b = new Date(group[i + 1].due_date! + 'T00:00:00')
    gaps.push(Math.round((a.getTime() - b.getTime()) / 86400000))
  }

  const avgGap = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)
  if (avgGap < 15 || avgGap > 95) return null

  const last = new Date(group[0].due_date! + 'T00:00:00')
  last.setDate(last.getDate() + avgGap)
  return last
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

function DonutChart({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return <div className="w-36 h-36 rounded-full bg-gray-100 mx-auto" />

  const R = 52, CX = 66, CY = 66, strokeW = 18
  const circ = 2 * Math.PI * R

  let offset = 0
  const slices = segments.map(seg => {
    const dash = (seg.value / total) * circ
    const s = { dash, dashoffset: -offset * circ / total, color: seg.color }
    offset += seg.value
    return s
  })

  return (
    <div className="relative flex-shrink-0">
      <svg width={132} height={132} className="rotate-[-90deg]">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#e5e7eb" strokeWidth={strokeW} />
        {slices.map((s, i) => s.dash > 0 && (
          <circle key={i} cx={CX} cy={CY} r={R} fill="none" stroke={s.color} strokeWidth={strokeW}
            strokeDasharray={`${s.dash} ${circ - s.dash}`}
            strokeDashoffset={s.dashoffset}
            strokeLinecap="butt" />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{total}</span>
        <span className="text-[10px] text-gray-500">Bills</span>
      </div>
    </div>
  )
}

// ── Bar Chart (monthly trend) ─────────────────────────────────────────────────

function BarChart({ data, months }: { data: number[]; months: string[] }) {
  const max = Math.max(...data, 1)
  const W = 100, H = 60

  return (
    <div className="flex items-end gap-1.5 h-16 w-full">
      {data.map((v, i) => {
        const pct = v / max
        const isLast = i === data.length - 1
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div className="relative w-full flex items-end" style={{ height: `${H}px` }}>
              <div
                className={`w-full rounded-t transition-all ${isLast ? 'bg-blue-500' : 'bg-blue-200'}`}
                style={{ height: `${Math.max(pct * H, v > 0 ? 3 : 0)}px` }}
                title={`${months[i]}: ${fmtAmt(v)}`}
              />
            </div>
            <span className="text-[9px] text-gray-400 truncate">{months[i]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function SparkLine({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const W = 320, H = 72, pad = 8
  const xStep = (W - pad * 2) / (data.length - 1)
  const pts = data.map((v, i) => ({
    x: pad + i * xStep,
    y: H - pad - ((v / max) * (H - pad * 2)),
  }))
  const line = pts.map(p => `${p.x},${p.y}`).join(' ')
  const area = [`${pts[0].x},${H - pad}`, ...pts.map(p => `${p.x},${p.y}`), `${pts[pts.length-1].x},${H - pad}`].join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#sparkGrad)" />
      <polyline points={line} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#3b82f6" />
      ))}
    </svg>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color = 'text-gray-900', bg = 'bg-white' }: {
  icon: string; label: string; value: string; sub: string
  color?: string; bg?: string
}) {
  return (
    <div className={`${bg} rounded-xl border border-gray-200 p-4`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
          <p className={`text-xl font-bold ${color} leading-tight truncate`}>{value}</p>
          <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
        </div>
      </div>
    </div>
  )
}

// ── AlertRow ──────────────────────────────────────────────────────────────────

function AlertRow({ icon, color, label, value, sub, href }: {
  icon: string; color: string; label: string; value: string | number
  sub?: string; href?: string
}) {
  const content = (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${color} group`}>
      <span className="text-lg shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm">{label}</span>
        {sub && <span className="text-xs ml-2 opacity-70">{sub}</span>}
      </div>
      <span className="font-bold text-lg shrink-0">{value}</span>
      {href && <span className="text-xs opacity-50 group-hover:opacity-100 transition-opacity">→</span>}
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

// ── Main ──────────────────────────────────────────────────────────────────────

function OverviewContent() {
  const searchParams = useSearchParams()
  const coFilter     = searchParams.get('company') as Company | null

  const [bills,     setBills]     = useState<Bill[]>([])
  const [vendors,   setVendors]   = useState<Vendor[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading,   setLoading]   = useState(true)
  const [trendWindow, setTrendWindow] = useState<6 | 12>(6)

  const today     = useMemo(() => new Date(), [])
  const thisYear  = today.getFullYear()
  const thisMon   = today.getMonth() + 1

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: b }, { data: v }, { data: l }] = await Promise.all([
        supabase.from('utility_bills').select('*,balance_status,invoice_status,total_due,remaining_balance').order('due_date', { ascending: false, nullsFirst: false }),
        supabase.from('utility_vendors').select('id,company_id,name,service_type'),
        supabase.from('utility_locations').select('id,company_id,name,city'),
      ])
      setBills((b as Bill[]) ?? [])
      setVendors((v as Vendor[]) ?? [])
      setLocations((l as Location[]) ?? [])
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

  // ── Build month keys for trend window ─────────────────────────────────────

  const trendMonths = useMemo(() => {
    const result: { label: string; key: string }[] = []
    for (let i = trendWindow - 1; i >= 0; i--) {
      const d = new Date(thisYear, thisMon - 1 - i, 1)
      result.push({
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        key: monthKey(d.getFullYear(), d.getMonth() + 1),
      })
    }
    return result
  }, [thisYear, thisMon, trendWindow])

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const thisMonKey = monthKey(thisYear, thisMon)

    const thisMonthBills = filtered.filter(b => {
      const k = b.billing_year && b.billing_month
        ? monthKey(b.billing_year, b.billing_month)
        : b.due_date?.slice(0, 7) ?? ''
      return k === thisMonKey
    })

    const overdueBills  = filtered.filter(b => computeBillStatus(b) === 'overdue')

    const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7)
    const dueThisWeekBills = filtered.filter(b => {
      if (!isActiveOutstanding(b) || !b.due_date) return false
      const d = new Date(b.due_date + 'T00:00:00')
      return d >= today && d <= nextWeek
    })

    const paidThisMonthBills = filtered.filter(b => {
      if (!b.is_paid || !b.paid_at) return false
      const d = new Date(b.paid_at)
      return d.getFullYear() === thisYear && (d.getMonth() + 1) === thisMon
    })

    // Current-charges based spend (exclude previous_balance from monthly calc)
    const thisMonthSpend = thisMonthBills.reduce((s, b) => s + currentChargesCAD(b), 0)
    // Active outstanding = remaining_balance for bills where isActiveOutstanding
    const activeOutstandingAmt = filtered
      .filter(b => isActiveOutstanding(b))
      .reduce((s, b) => s + (b.remaining_balance != null ? b.remaining_balance : totalDueCAD(b)), 0)
    const overdueAmt     = overdueBills.reduce((s, b) => s + (b.remaining_balance != null ? b.remaining_balance : totalDueCAD(b)), 0)
    const carriedFwdAmt  = filtered
      .filter(b => b.balance_status === 'carried_forward')
      .reduce((s, b) => s + totalDueCAD(b), 0)
    const dueThisWeekAmt = dueThisWeekBills.reduce((s, b) => s + (b.remaining_balance != null ? b.remaining_balance : totalDueCAD(b)), 0)
    const paidThisMonAmt = paidThisMonthBills.reduce((s, b) => s + totalDueCAD(b), 0)

    // Avg monthly based on current_charges last 3 months
    const last3Keys: string[] = []
    for (let i = 1; i <= 3; i++) {
      const m = thisMon - i <= 0 ? thisMon - i + 12 : thisMon - i
      const y = thisMon - i <= 0 ? thisYear - 1 : thisYear
      last3Keys.push(monthKey(y, m))
    }
    const last3Bills = filtered.filter(b => {
      const k = b.billing_year && b.billing_month
        ? monthKey(b.billing_year, b.billing_month)
        : b.due_date?.slice(0, 7) ?? ''
      return last3Keys.includes(k)
    })
    const avgMonthly = last3Keys.length > 0
      ? last3Bills.reduce((s, b) => s + currentChargesCAD(b), 0) / 3
      : 0

    return {
      thisMonthSpend,
      activeOutstandingAmt,
      overdueAmt,
      overdueCount: overdueBills.length,
      carriedFwdAmt,
      dueThisWeekAmt,
      dueThisWeekCount: dueThisWeekBills.length,
      paidThisMonAmt,
      paidThisMonCount: paidThisMonthBills.length,
      avgMonthly,
      totalVendors: filteredVendors.length,
      thisMonthCount: thisMonthBills.length,
    }
  }, [filtered, filteredVendors, thisYear, thisMon, today])

  // ── Trend data ────────────────────────────────────────────────────────────

  const trendData = useMemo(() =>
    trendMonths.map(m => ({
      label: m.label,
      value: filtered
        .filter(b => {
          const k = b.billing_year && b.billing_month
            ? monthKey(b.billing_year, b.billing_month)
            : b.due_date?.slice(0, 7) ?? ''
          return k === m.key
        })
        .reduce((s, b) => s + currentChargesCAD(b), 0),
    })),
    [filtered, trendMonths]
  )

  // ── Bill status (donut) ───────────────────────────────────────────────────

  const billStatus = useMemo(() => ({
    paid:            filtered.filter(b => computeBillStatus(b) === 'paid').length,
    overdue:         filtered.filter(b => computeBillStatus(b) === 'overdue' || computeBillStatus(b) === 'overdue_partial').length,
    upcoming:        filtered.filter(b => computeBillStatus(b) === 'upcoming' || computeBillStatus(b) === 'due_today' || computeBillStatus(b) === 'open').length,
    carriedForward:  filtered.filter(b => computeBillStatus(b) === 'carried_forward').length,
  }), [filtered])

  // ── Abnormal charges ──────────────────────────────────────────────────────

  const abnormalBills = useMemo(() => {
    const thisMonKey = monthKey(thisYear, thisMon)
    return filtered.filter(b => {
      const k = b.billing_year && b.billing_month
        ? monthKey(b.billing_year, b.billing_month)
        : b.due_date?.slice(0, 7) ?? ''
      return k === thisMonKey && isAbnormal(b, filtered)
    })
  }, [filtered, thisYear, thisMon])

  // ── Missing bills ─────────────────────────────────────────────────────────

  const missingBills = useMemo(() => detectMissing(filtered, today), [filtered, today])

  // ── Top vendors by current_charges ────────────────────────────────────────

  const topVendors = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of filtered) {
      const key = b.provider ?? b.utility_name
      map.set(key, (map.get(key) ?? 0) + currentChargesCAD(b))
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount }))
  }, [filtered])

  const topMax = topVendors[0]?.amount ?? 1

  // ── Location spend ────────────────────────────────────────────────────────

  const locationSpend = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of filtered) {
      if (!b.location_id) continue
      map.set(b.location_id, (map.get(b.location_id) ?? 0) + currentChargesCAD(b))
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, amount]) => ({
        name: locations.find(l => l.id === id)?.name ?? id,
        amount,
      }))
  }, [filtered, locations])

  // ── Upcoming / Overdue lists ──────────────────────────────────────────────

  const nextWeekDate = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + 7); return d }, [today])

  const upcomingBills = useMemo(() =>
    filtered
      .filter(b => {
        const s = computeBillStatus(b)
        return (s === 'upcoming' || s === 'due_today' || s === 'open') && b.due_date
      })
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
      .slice(0, 5),
    [filtered]
  )

  const overdueBills = useMemo(() =>
    filtered
      .filter(b => computeBillStatus(b) === 'overdue' || computeBillStatus(b) === 'overdue_partial')
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
      .slice(0, 5),
    [filtered]
  )

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">

      {/* ── Alert bar ─────────────────────────────────────────────────────── */}
      {(stats.overdueCount > 0 || missingBills.length > 0 || abnormalBills.length > 0) && (
        <div className="space-y-2">
          {stats.overdueCount > 0 && (
            <AlertRow
              icon="🔴" color="border-red-200 bg-red-50 text-red-800"
              label="Overdue Bills" value={stats.overdueCount}
              sub={fmtAmt(stats.overdueAmt) + ' total due'}
              href="/utilities/bills?status=overdue"
            />
          )}
          {missingBills.length > 0 && (
            <AlertRow
              icon="🔍" color="border-orange-200 bg-orange-50 text-orange-800"
              label="Missing Bills (not yet received)"
              value={missingBills.length}
              sub={missingBills.map(m => m.provider).join(', ')}
            />
          )}
          {abnormalBills.length > 0 && (
            <AlertRow
              icon="📈" color="border-yellow-200 bg-yellow-50 text-yellow-800"
              label="Abnormal Charges (±25% from avg)"
              value={abnormalBills.length}
              sub={abnormalBills.map(b => b.provider ?? b.utility_name).join(', ')}
            />
          )}
        </div>
      )}

      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard
          icon="💰"
          label="Monthly Charges (Current)"
          value={fmtAmt(stats.thisMonthSpend)}
          sub={`${stats.thisMonthCount} bills · excl. prev. balance`}
          color="text-gray-900"
        />
        <StatCard
          icon="📊"
          label="3-Month Avg (Charges)"
          value={fmtAmt(stats.avgMonthly)}
          sub="Trailing 3 months"
          color="text-blue-700"
          bg="bg-blue-50"
        />
        <StatCard
          icon="⚠️"
          label="Overdue Total Due"
          value={fmtAmt(stats.overdueAmt)}
          sub={`${stats.overdueCount} unpaid past due date`}
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
          value={fmtAmt(stats.paidThisMonAmt)}
          sub={`${stats.paidThisMonCount} bills`}
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
      </div>

      {/* ── Trend chart + Bill Status ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Monthly Charges Trend</h2>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {([6, 12] as const).map(w => (
                <button key={w} onClick={() => setTrendWindow(w)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    trendWindow === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{w}M</button>
              ))}
            </div>
          </div>
          <BarChart
            data={trendData.map(m => m.value)}
            months={trendData.map(m => m.label)}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Bill Status</h2>
          <div className="flex items-center gap-4">
            <DonutChart segments={[
              { value: billStatus.paid,           color: '#10b981', label: 'Paid' },
              { value: billStatus.upcoming,        color: '#f59e0b', label: 'Upcoming' },
              { value: billStatus.overdue,         color: '#ef4444', label: 'Overdue' },
              { value: billStatus.carriedForward,  color: '#a855f7', label: 'Carried Fwd' },
            ]} />
            <div className="space-y-2 text-sm">
              {[
                { label: 'Paid',          count: billStatus.paid,           color: 'bg-emerald-500' },
                { label: 'Upcoming',      count: billStatus.upcoming,        color: 'bg-amber-400' },
                { label: 'Overdue',       count: billStatus.overdue,         color: 'bg-red-500' },
                { label: 'Carried Fwd',   count: billStatus.carriedForward,  color: 'bg-purple-400' },
                { label: 'Missing',       count: missingBills.length,        color: 'bg-orange-400' },
                { label: 'Abnormal',      count: abnormalBills.length,       color: 'bg-yellow-400' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${item.color} shrink-0`} />
                  <span className="text-gray-600 text-xs">{item.label}</span>
                  <span className="ml-auto font-semibold text-gray-900 text-xs">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Vendors + Locations spend ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Vendor Spend (All Time)</h2>
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
                    <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${(v.amount / topMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Location Spend (All Time)</h2>
          {locationSpend.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No location data linked to bills yet</p>
          ) : (
            <div className="space-y-3">
              {locationSpend.map((l, i) => (
                <div key={l.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 truncate max-w-[60%]">{l.name}</span>
                    <span className="font-medium text-gray-900">{fmtAmt(l.amount)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full">
                    <div className="h-1.5 bg-emerald-500 rounded-full"
                      style={{ width: `${(l.amount / (locationSpend[0]?.amount ?? 1)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Upcoming / Overdue / Abnormal ──────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Upcoming */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Upcoming Bills</h2>
            <span className="text-xs text-gray-400">Next 7 days</span>
          </div>
          {upcomingBills.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No upcoming bills</p>
          ) : (
            <div className="space-y-3">
              {upcomingBills.map(b => {
                const days = b.due_date
                  ? Math.ceil((new Date(b.due_date + 'T00:00:00').getTime() - today.getTime()) / 86400000)
                  : null
                return (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{b.provider ?? b.utility_name}</p>
                      <p className="text-xs text-gray-400">{b.company_id.toUpperCase()} · {fmtShort(b.due_date)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="font-medium text-gray-900">{fmtAmt(totalDueCAD(b))}</p>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <Link href="/utilities/bills" className="mt-4 block text-xs text-blue-600 hover:underline">View all →</Link>
        </div>

        {/* Overdue */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-red-600">Overdue Bills</h2>
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
                      <p className="font-medium text-red-600">{fmtAmt(totalDueCAD(b))}</p>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">{days}d overdue</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <Link href="/utilities/bills?status=overdue" className="mt-4 block text-xs text-blue-600 hover:underline">View all →</Link>
        </div>

        {/* Abnormal + Missing */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Abnormal &amp; Missing</h2>

          {abnormalBills.length === 0 && missingBills.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">All charges look normal 👍</p>
          ) : (
            <div className="space-y-3">
              {abnormalBills.map(b => {
                const charges = b.current_charges ?? b.amount ?? 0
                return (
                  <div key={b.id} className="flex items-start justify-between text-sm gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium shrink-0">Abnormal</span>
                        <p className="font-medium text-gray-800 truncate">{b.provider ?? b.utility_name}</p>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{fmtShort(b.due_date)}</p>
                    </div>
                    <p className="font-medium text-gray-900 shrink-0">{fmtAmt(toCAD(charges, b.currency))}</p>
                  </div>
                )
              })}
              {missingBills.map(m => (
                <div key={`${m.provider}-${m.account_number}`} className="flex items-start justify-between text-sm gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium shrink-0">Missing</span>
                      <p className="font-medium text-gray-800 truncate">{m.provider}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Expected: {m.expectedMonth}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{m.company_id.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OverviewPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-4">
        {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
      </div>
    }>
      <OverviewContent />
    </Suspense>
  )
}
