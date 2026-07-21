'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

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
  current_charges: number | null
  previous_balance: number | null
  currency: string
  billing_month: number | null
  billing_year: number | null
  is_paid: boolean
  due_date: string | null
}

const USD_RATE = 1.36

function toCAD(amount: number | null, currency: string) {
  if (amount == null) return 0
  return currency === 'USD' ? amount * USD_RATE : amount
}

function effectiveCharges(b: Bill) {
  if (b.current_charges != null) return toCAD(b.current_charges, b.currency)
  return toCAD(b.amount, b.currency)
}

const CO_LABEL: Record<Company, string> = { afs: 'AFS Transco', tnt: 'TNT', zfs: 'ZFS Trans Co' }
const CO_COLOR: Record<Company, string> = {
  afs: 'bg-blue-500',
  tnt: 'bg-amber-500',
  zfs: 'bg-emerald-500',
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function ReportsPage() {
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('utility_bills')
      .select('id,company_id,utility_name,provider,amount,current_charges,previous_balance,currency,billing_month,billing_year,is_paid,due_date')
      .then(({ data }) => {
        setBills((data as Bill[]) ?? [])
        setLoading(false)
      })
  }, [])

  const now = new Date()
  const thisYear = now.getFullYear()

  // Monthly spend by company (this year, by billing_month)
  const monthlyByCompany = useMemo(() => {
    const result: Record<Company, number[]> = { afs: Array(12).fill(0), tnt: Array(12).fill(0), zfs: Array(12).fill(0) }
    for (const b of bills) {
      if (b.billing_year === thisYear && b.billing_month != null) {
        result[b.company_id][b.billing_month - 1] += effectiveCharges(b)
      }
    }
    return result
  }, [bills, thisYear])

  // Spend by utility type
  const byUtility = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of bills) {
      const key = b.utility_name
      map.set(key, (map.get(key) ?? 0) + effectiveCharges(b))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [bills])

  // YTD totals by company
  const ytdByCompany = useMemo(() => {
    const map: Record<Company, number> = { afs: 0, tnt: 0, zfs: 0 }
    for (const b of bills) {
      if (b.billing_year === thisYear) map[b.company_id] += effectiveCharges(b)
    }
    return map
  }, [bills, thisYear])

  const totalYTD = Object.values(ytdByCompany).reduce((a, b) => a + b, 0)

  const maxMonthly = Math.max(...(['afs','tnt','zfs'] as Company[]).flatMap(co => monthlyByCompany[co]))

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  return (
    <div className="p-6 space-y-6">
      {/* YTD Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">YTD Total ({thisYear})</div>
          <div className="text-2xl font-bold text-gray-900">CA${totalYTD.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
        </div>
        {(['afs','tnt','zfs'] as Company[]).map(co => (
          <div key={co} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 mb-1">{CO_LABEL[co]}</div>
            <div className="text-2xl font-bold text-gray-900">CA${ytdByCompany[co].toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            <div className="text-xs text-gray-400 mt-1">{totalYTD > 0 ? ((ytdByCompany[co] / totalYTD) * 100).toFixed(1) : '0'}% of total</div>
          </div>
        ))}
      </div>

      {/* Monthly trend chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly Charges by Company ({thisYear})</h2>
        <div className="flex items-end gap-1 h-40">
          {MONTHS.map((mo, i) => {
            const total = (['afs','tnt','zfs'] as Company[]).reduce((s, co) => s + monthlyByCompany[co][i], 0)
            const heightPct = maxMonthly > 0 ? (total / maxMonthly) * 100 : 0
            return (
              <div key={mo} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                  {(['afs','tnt','zfs'] as Company[]).map(co => {
                    const h = maxMonthly > 0 ? (monthlyByCompany[co][i] / maxMonthly) * 120 : 0
                    return h > 0 ? (
                      <div key={co} className={`w-full ${CO_COLOR[co]} first:rounded-t`} style={{ height: `${h}px` }} title={`${CO_LABEL[co]}: CA$${monthlyByCompany[co][i].toFixed(0)}`} />
                    ) : null
                  })}
                </div>
                <div className="text-[9px] text-gray-400">{mo}</div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-3">
          {(['afs','tnt','zfs'] as Company[]).map(co => (
            <div key={co} className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className={`w-2.5 h-2.5 rounded-sm ${CO_COLOR[co]}`} />
              {CO_LABEL[co]}
            </div>
          ))}
        </div>
      </div>

      {/* Spend by utility type */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Spend by Utility Type (All Time)</h2>
        <div className="space-y-3">
          {byUtility.map(([name, total]) => {
            const pct = byUtility[0][1] > 0 ? (total / byUtility[0][1]) * 100 : 0
            return (
              <div key={name} className="flex items-center gap-3">
                <div className="w-28 text-sm text-gray-600 truncate">{name}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-sm font-medium text-gray-700 w-24 text-right">
                  CA${total.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
