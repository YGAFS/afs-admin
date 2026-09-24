'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'
import { hrFetch } from '@/lib/hrApi'

type Stats = { total: number; absent: number; wfh: number; highVac: number }
type PendingReport = {
  employeeId: string
  employeeName: string
  companyCode: string
  leaveCode: string
}
type EmployeeRow = {
  id: string
  name: string
  vacation_allowance: number
  uses_accrual: boolean
  is_exempt: boolean
  employment_type?: string | null
}

export default function HrSummaryCards() {
  const [stats, setStats] = useState<Stats>({ total: 0, absent: 0, wfh: 0, highVac: 0 })
  const [pendingReports, setPendingReports] = useState<PendingReport[]>([])
  const { locale } = useLocale()

  useEffect(() => {
    async function load() {
      const current = new Date()
      const today = [current.getFullYear(), current.getMonth() + 1, current.getDate()]
        .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0')).join('-')

      const { data: result } = await hrFetch<{
        employees: Array<EmployeeRow & { company?: { code?: string } | null }>
        entries: Array<{ employee_id: string; leave_code: string; date?: string; reported_at?: string | null }>
      }>('/api/hr/summary')
      const emps = result?.employees ?? []
      const todayEntries = (result?.entries ?? []).filter(e => e.date === today)

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
      const yearEntries = (result?.entries ?? []).filter(e => e.date?.startsWith(`${year}-`) && payrollEmps.some(emp => emp.id === e.employee_id))

      const vacUsed: Record<string, number> = {}
      for (const e of yearEntries) {
        if (!['L','L1','L2','L3'].includes(e.leave_code)) continue
        const d = ['L1','L2'].includes(e.leave_code) ? 0.5 : 1
        vacUsed[e.employee_id] = (vacUsed[e.employee_id] ?? 0) + d
      }
      const highVac = Object.values(vacUsed).filter(v => v >= 18).length

      const reportableToday = new Set(['L', 'L1', 'L2', 'L3', 'S', 'S1', 'S2', 'S3'])
      const employeeById = new Map(emps.map(emp => [emp.id, emp]))
      setPendingReports(todayEntries
        .filter(entry => reportableToday.has(entry.leave_code) && !entry.reported_at)
        .map(entry => {
          const employee = employeeById.get(entry.employee_id)
          return {
            employeeId: entry.employee_id,
            employeeName: employee?.name ?? 'Unknown employee',
            companyCode: employee?.company?.code ?? '',
            leaveCode: entry.leave_code,
          }
        }))

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
    <>
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
      {pendingReports.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg" aria-hidden="true">⚠</span>
            <div className="min-w-0">
              <p className="font-semibold">
                오늘 보고되지 않은 휴가가 {pendingReports.length}건 있습니다.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                {pendingReports.map((entry, index) => (
                  <span key={`${entry.employeeId}-${entry.leaveCode}-${index}`}>
                    {index > 0 && ', '}{entry.companyCode ? `${entry.companyCode} ` : ''}{entry.employeeName} ({entry.leaveCode})
                  </span>
                ))}
              </p>
              <p className="mt-2 text-xs text-amber-700">각 회사 출근부의 Report 버튼에서 이메일 보고를 완료해 주세요.</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
