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

const leaveLabel: Record<string, string> = {
  L: 'Paid Leave', L1: 'Paid Leave (AM Half)', L2: 'Paid Leave (PM Half)', L3: 'Paid Leave (Hourly)',
  S: 'Sick Leave', S1: 'Sick Leave (AM Half)', S2: 'Sick Leave (PM Half)', S3: 'Sick Leave (Hourly)',
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
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="border-l-4 border-amber-400 bg-amber-50/60 px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" aria-hidden="true">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.999 1.75a1.5 1.5 0 0 1 1.3.75l7.1 12.25a1.5 1.5 0 0 1-1.3 2.25H2.9a1.5 1.5 0 0 1-1.3-2.25L8.7 2.5a1.5 1.5 0 0 1 1.3-.75Zm0 4.25a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75Zm0 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">Unreported leave today</p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    {pendingReports.length} {pendingReports.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  The following leave entries have not been included in an email report yet.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {pendingReports.map((entry, index) => (
                    <span key={`${entry.employeeId}-${entry.leaveCode}-${index}`} className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink">
                      {entry.companyCode ? `${entry.companyCode} · ` : ''}{entry.employeeName}
                      <span className="ml-1.5 font-normal text-ink-muted">{leaveLabel[entry.leaveCode] ?? entry.leaveCode}</span>
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-ink-faint">Open the relevant company attendance page and select Report to send the notification.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
