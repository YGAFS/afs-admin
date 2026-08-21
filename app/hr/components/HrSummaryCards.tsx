'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

type Stats = { total: number; absent: number; wfh: number; highVac: number }
type EmployeeRow = {
  id: string
  vacation_allowance: number
  uses_accrual: boolean
  is_exempt: boolean
  employment_type?: string | null
}

export default function HrSummaryCards() {
  const [stats, setStats] = useState<Stats>({ total: 0, absent: 0, wfh: 0, highVac: 0 })
  const { locale } = useLocale()

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]

      const [{ data: emps }, { data: todayEntries }] = await Promise.all([
        supabase.from('employees').select('id,vacation_allowance,uses_accrual,is_exempt,employment_type')
          .eq('is_active', true),
        supabase.from('leave_entries').select('employee_id,leave_code')
          .eq('date', today),
      ])

      if (!emps) return
      const payrollEmps = (emps as EmployeeRow[]).filter(e => !e.employment_type || e.employment_type === 'office')

      const entryMap: Record<string, string[]> = {}
      for (const e of (todayEntries ?? [])) (entryMap[e.employee_id] ??= []).push(e.leave_code)

      let absent = 0, wfh = 0

      for (const emp of payrollEmps) {
        const codes = entryMap[emp.id]
        if (!codes) continue
        if (codes.some(c => ['L','L1','L2','L3','S','S1','S2','S3','T'].includes(c))) absent++
        if (codes.includes('W')) wfh++
      }

      // High vacation usage: used >= 18 days this year
      const year = new Date().getFullYear()
      const { data: yearEntries } = await supabase.from('leave_entries')
        .select('employee_id,leave_code')
        .in('employee_id', payrollEmps.map(e => e.id))
        .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)

      const vacUsed: Record<string, number> = {}
      for (const e of (yearEntries ?? [])) {
        if (!['L','L1','L2','L3'].includes(e.leave_code)) continue
        const d = ['L1','L2'].includes(e.leave_code) ? 0.5 : 1
        vacUsed[e.employee_id] = (vacUsed[e.employee_id] ?? 0) + d
      }
      const highVac = Object.values(vacUsed).filter(v => v >= 18).length

      setStats({ total: payrollEmps.length, absent, wfh, highVac })
    }
    load()
  }, [])

  const unit = t('hr.cards.unit', locale)

  const cards = [
    {
      label: t('hr.cards.total', locale),
      value: stats.total,
      unit,
      numColor: 'text-ink',
    },
    {
      label: t('hr.cards.absent', locale),
      value: stats.absent,
      unit,
      numColor: 'text-signal-neg',
    },
    {
      label: t('hr.cards.wfh', locale),
      value: stats.wfh,
      unit,
      numColor: 'text-ink',
    },
    {
      label: t('hr.cards.high_vac', locale),
      value: stats.highVac,
      unit,
      numColor: 'text-amber-600',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-white border border-line rounded-2xl px-6 py-5">
          <div className="text-sm font-medium text-ink-muted mb-2">{c.label}</div>
          <div className={`text-4xl font-semibold ${c.numColor}`}>
            {c.value}<span className="text-xl font-medium ml-1">{c.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
