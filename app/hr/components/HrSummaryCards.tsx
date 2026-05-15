'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Stats = { total: number; absent: number; wfh: number; highVac: number }

export default function HrSummaryCards() {
  const [stats, setStats] = useState<Stats>({ total: 0, absent: 0, wfh: 0, highVac: 0 })
  const { locale } = useLocale()

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]

      const [{ data: emps }, { data: todayEntries }] = await Promise.all([
        supabase.from('employees').select('id,vacation_allowance,uses_accrual,is_exempt')
          .eq('is_active', true),
        supabase.from('leave_entries').select('employee_id,leave_code')
          .eq('date', today),
      ])

      if (!emps) return

      const entryMap: Record<string, string> = {}
      for (const e of (todayEntries ?? [])) entryMap[e.employee_id] = e.leave_code

      let absent = 0, wfh = 0

      for (const emp of emps) {
        const code = entryMap[emp.id]
        if (!code) continue
        if (['L','L1','L2','L3','S','S1','S2','S3','T'].includes(code)) absent++
        if (code === 'W') wfh++
      }

      // High vacation usage: used >= 18 days this year
      const year = new Date().getFullYear()
      const { data: yearEntries } = await supabase.from('leave_entries')
        .select('employee_id,leave_code')
        .in('employee_id', emps.map(e => e.id))
        .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)

      const vacUsed: Record<string, number> = {}
      for (const e of (yearEntries ?? [])) {
        if (!['L','L1','L2','L3'].includes(e.leave_code)) continue
        const d = ['L1','L2'].includes(e.leave_code) ? 0.5 : 1
        vacUsed[e.employee_id] = (vacUsed[e.employee_id] ?? 0) + d
      }
      const highVac = Object.values(vacUsed).filter(v => v >= 18).length

      setStats({ total: emps.length, absent, wfh, highVac })
    }
    load()
  }, [])

  const unit = t('hr.cards.unit', locale)

  const cards = [
    {
      label: t('hr.cards.total', locale),
      value: stats.total,
      unit,
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      numColor: 'text-blue-700',
      labelColor: 'text-blue-600',
    },
    {
      label: t('hr.cards.absent', locale),
      value: stats.absent,
      unit,
      bg: 'bg-red-50',
      border: 'border-red-200',
      numColor: 'text-red-600',
      labelColor: 'text-red-500',
    },
    {
      label: t('hr.cards.wfh', locale),
      value: stats.wfh,
      unit,
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      numColor: 'text-purple-700',
      labelColor: 'text-purple-500',
    },
    {
      label: t('hr.cards.high_vac', locale),
      value: stats.highVac,
      unit,
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      numColor: 'text-amber-700',
      labelColor: 'text-amber-600',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className={`${c.bg} border ${c.border} rounded-2xl px-6 py-5 shadow-sm`}>
          <div className={`text-sm font-semibold ${c.labelColor} mb-2`}>{c.label}</div>
          <div className={`text-4xl font-bold ${c.numColor}`}>
            {c.value}<span className="text-xl font-semibold ml-1">{c.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
