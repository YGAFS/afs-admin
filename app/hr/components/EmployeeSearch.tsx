'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

type Employee = {
  id: string; name: string; team: string; manager_name: string
  vacation_allowance: number; position: string
  is_exempt: boolean; uses_accrual: boolean; is_active: boolean
  start_date?: string; end_date?: string
  probation_start?: string; probation_end?: string
  employment_type?: string
  companies: { id: string; name: string } | { id: string; name: string }[]
}
type Summary = { vac: number; sick: number; wfh: number; toil: number; other: number }
type Monthly = Record<number, Summary>
type License = {
  id: string; account_id: string; account_type: string
  display_name: string; email_address: string; alias?: string
  license_plan?: string; monthly_cost_cad: number; status: string; notes?: string
}
type Asset = {
  id: string; asset_id: string; category?: string; item_name?: string
  brand?: string; model?: string; serial_number?: string
  purchase_date?: string; purchase_price?: number; condition: string; notes?: string
}
type Subscription = {
  id: string; vendor: string | null; product: string | null; plan_name: string | null
  cost_cad: number; billing_cycle: string | null; status: string
  linked_count: number
}

function calcDays(code: string) { return ['L1','L2','S1','S2'].includes(code) ? 0.5 : 1 }

function positionRank(pos: string | null | undefined): number {
  if (!pos) return 99
  const p = pos.toLowerCase()
  if (/president|ceo|coo|cfo|cto|chief/.test(p)) return 1
  if (/vice.?president|\bvp\b/.test(p))           return 2
  if (/director/.test(p))                         return 3
  if (/manager/.test(p))                          return 4
  if (/senior|lead|executive/.test(p))            return 5
  if (/specialist|analyst|coordinator/.test(p))   return 6
  if (/associate|representative|\brep\b/.test(p)) return 7
  if (/assistant|junior|intern/.test(p))          return 8
  return 9
}

function sortEmployees(emps: Employee[], mode: 'hire' | 'name' = 'hire'): Employee[] {
  if (mode === 'name') return [...emps].sort((a, b) => a.name.localeCompare(b.name))
  return [...emps].sort((a, b) => {
    const da = a.start_date ?? '9999-12-31'
    const db = b.start_date ?? '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    return positionRank(a.position) - positionRank(b.position)
  })
}
type AnnivPeriod  = { periodStart: Date; periodEnd: Date; periodYear: number }
type PeriodStat   = {
  periodYear: number; periodStart: Date; periodEnd: Date
  accrued: number; carryIn: number; used: number
  remaining: number; carryOut: number; expired: number; isCurrent: boolean
}

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function getAnniversaryPeriod(startDateIso: string, asOf?: Date): AnnivPeriod | null {
  if (!startDateIso) return null
  const [sy, sm, sd] = startDateIso.split('-').map(Number)
  const start = new Date(sy, sm - 1, sd)   // local time — avoids UTC midnight → prev-day bug
  const today = asOf ?? new Date()
  if (start > today) return null
  let years = today.getFullYear() - start.getFullYear()
  const candidate = new Date(start)
  candidate.setFullYear(start.getFullYear() + years)
  if (candidate > today) years--
  years = Math.max(0, years)
  const periodStart = new Date(start)
  periodStart.setFullYear(start.getFullYear() + years)
  const periodEnd = new Date(start)
  periodEnd.setFullYear(start.getFullYear() + years + 1)
  periodEnd.setDate(periodEnd.getDate() - 1)
  return { periodStart, periodEnd, periodYear: years + 1 }
}

function getAllAnnivPeriods(startDateIso: string, asOf?: Date): AnnivPeriod[] {
  const [sy, sm, sd] = startDateIso.split('-').map(Number)
  const start = new Date(sy, sm - 1, sd)
  const today = asOf ?? new Date()
  const periods: AnnivPeriod[] = []
  let y = 0
  while (true) {
    const pStart = new Date(start); pStart.setFullYear(start.getFullYear() + y)
    if (pStart > today) break
    const pEnd = new Date(start); pEnd.setFullYear(start.getFullYear() + y + 1); pEnd.setDate(pEnd.getDate() - 1)
    periods.push({ periodStart: pStart, periodEnd: pEnd, periodYear: y + 1 })
    y++
  }
  return periods
}

function calcAccruedInPeriod(allowance: number, periodStart: Date, asOf?: Date): number {
  const ref = asOf ?? new Date()
  const daysElapsed = Math.floor((ref.getTime() - periodStart.getTime()) / 86400000)
  return Math.round(Math.max(0, daysElapsed) / 365 * allowance * 100) / 100
}
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtDateLong(iso?: string, locale: 'en' | 'ko' = 'en') {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  if (locale === 'ko') return `${y}년 ${+m}월 ${+d}일`
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[+m - 1]} ${+d}, ${y}`
}

type DateField = 'start_date' | 'end_date'

type NewEmpForm = {
  company_id: string; name: string; team: string; position: string
  start_date: string; is_active: boolean; end_date: string
  vacation_allowance: number; uses_accrual: boolean; is_exempt: boolean
  employment_type: string
}

const BLANK_FORM: NewEmpForm = {
  company_id: '', name: '', team: '', position: '',
  start_date: '', is_active: true, end_date: '',
  vacation_allowance: 10, uses_accrual: true, is_exempt: false,
  employment_type: 'office',
}

export default function EmployeeSearch() {
  const { locale } = useLocale()
  const [query,        setQuery]        = useState('')
  const [compFilter,   setComp]         = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [employees,    setEmps]         = useState<Employee[]>([])
  const [selected,     setSel]          = useState<Employee | null>(null)
  const [summary,      setSum]          = useState<Summary | null>(null)
  const [monthly,      setMo]           = useState<Monthly>({})
  const [companies,    setComps]        = useState<{ id: string; name: string }[]>([])
  const [editField,    setEditField]    = useState<DateField | null>(null)
  const [editValue,    setEditValue]    = useState('')
  const [saving,       setSaving]       = useState(false)
  const [termModal,    setTermModal]    = useState(false)
  const [termDate,     setTermDate]     = useState('')
  const [addModal,     setAddModal]     = useState(false)
  const [addError,     setAddError]     = useState('')
  const [deleteConfirm,setDeleteConfirm]= useState(false)
  const [newEmp,       setNewEmp]       = useState<NewEmpForm>(BLANK_FORM)
  const [posEdit,      setPosEdit]      = useState(false)
  const [posValue,     setPosValue]     = useState('')
  const [teamEdit,     setTeamEdit]     = useState(false)
  const [teamValue,    setTeamValue]    = useState('')
  const [sortMode,     setSortMode]     = useState<'hire'|'name'>('hire')
  const [quickDeleteId,setQuickDeleteId]= useState<string | null>(null)
  const [probModal,    setProbModal]    = useState(false)
  const [probStartMode,setProbStartMode]= useState<'hire'|'custom'>('hire')
  const [probStartVal, setProbStartVal] = useState('')
  const [probEndMode,  setProbEndMode]  = useState<'90d'|'custom'>('90d')
  const [probEndVal,   setProbEndVal]   = useState('')
  const [statsYear,    setStatsYear]    = useState(new Date().getFullYear())
  const [periodVacUsed,  setPeriodVacUsed]  = useState(0)
  const [carryover,      setCarryover]      = useState(0)
  const [paidOutPrev,    setPaidOutPrev]    = useState(0)
  const [periodHistory,  setPeriodHistory]  = useState<PeriodStat[]>([])
  const [histOpen,       setHistOpen]       = useState(false)
  const [licenses,     setLicenses]     = useState<License[]>([])
  const [assets,       setAssets]       = useState<Asset[]>([])
  const [subscriptions,setSubs]         = useState<Subscription[]>([])

  useEffect(() => {
    supabase.from('companies').select('id,name').order('name')
      .then(({ data }) => {
        setComps(data ?? [])
        if (data?.length) setNewEmp(p => ({ ...p, company_id: data[0].id }))
      })
  }, [])

  useEffect(() => {
    let q = supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,position,is_exempt,uses_accrual,is_active,start_date,end_date,probation_start,probation_end,employment_type,companies(id,name)')
      .order('name')
    // Active: is_active=true AND no end_date. Terminated: is_active=false OR has end_date.
    if (!showInactive) {
      q = q.eq('is_active', true)
    } else {
      q = q.or('is_active.eq.false,end_date.not.is.null')
    }
    if (query)                q = q.ilike('name', `%${query}%`)
    if (compFilter !== 'all') q = q.eq('company_id', compFilter)
    q.then(({ data }) => {
      let emps = (data as Employee[]) ?? []
      if (!showInactive) emps = emps.filter(e => !e.end_date)
      setEmps(sortEmployees(emps, sortMode)); setSel(null)
    })
  }, [query, compFilter, showInactive, sortMode])

  async function loadStats(emp: Employee, year: number) {
    const today      = new Date()
    const todayIsoStr = isoFromDate(today)
    const effectiveDate = emp.end_date
      ? (() => { const [ey,em,ed] = emp.end_date!.split('-').map(Number); return new Date(ey, em-1, ed) })()
      : today
    const effectiveDateIso = emp.end_date ?? todayIsoStr
    const vacCodes   = ['L','L1','L2','L3']

    const [yearRes, allVacRes] = await Promise.all([
      supabase.from('leave_entries').select('date,leave_code').eq('employee_id', emp.id)
        .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
      emp.start_date
        ? supabase.from('leave_entries').select('date,leave_code').eq('employee_id', emp.id)
            .gte('date', emp.start_date).lte('date', effectiveDateIso)
            .in('leave_code', vacCodes)
        : Promise.resolve({ data: [] as { date: string; leave_code: string }[], error: null }),
    ])

    // Calendar-year summary for monthly overview table
    const s: Summary = { vac: 0, sick: 0, wfh: 0, toil: 0, other: 0 }
    const m: Monthly = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i+1, { vac:0, sick:0, wfh:0, toil:0, other:0 }]))
    for (const e of (yearRes.data ?? [])) {
      const mo = parseInt(e.date.split('-')[1], 10)
      const d  = calcDays(e.leave_code)
      if      (['L','L1','L2','L3'].includes(e.leave_code)) { s.vac  += d; m[mo].vac  += d }
      else if (['S','S1','S2','S3'].includes(e.leave_code)) { s.sick += d; m[mo].sick += d }
      else if (e.leave_code === 'W')                        { s.wfh  += 1; m[mo].wfh  += 1 }
      else if (['T','T1','T2','T3'].includes(e.leave_code)) { const td = ['T1','T2'].includes(e.leave_code) ? 0.5 : 1; s.toil += td; m[mo].toil += td }
      else                                                  { s.other += d; m[mo].other += d }
    }
    setSum(s); setMo(m)

    // Per-anniversary-period cascade (handles multi-year carryover correctly)
    if (!emp.start_date || !emp.uses_accrual || emp.is_exempt) {
      setPeriodVacUsed(0); setCarryover(0); setPaidOutPrev(0); setPeriodHistory([])
      return
    }

    const periods   = getAllAnnivPeriods(emp.start_date, effectiveDate)
    const vacEntries = allVacRes.data ?? []
    let carryIn = 0
    const history: PeriodStat[] = []

    for (let i = 0; i < periods.length; i++) {
      const p         = periods[i]
      const isCurrent = i === periods.length - 1
      const pStartIso = isoFromDate(p.periodStart)
      const pEndIso   = isCurrent ? effectiveDateIso : isoFromDate(p.periodEnd)

      const used = Math.round(
        vacEntries
          .filter(e => e.date >= pStartIso && e.date <= pEndIso)
          .reduce((sum, e) => sum + (['L1','L2'].includes(e.leave_code) ? 0.5 : 1), 0)
        * 100) / 100

      const accrued   = isCurrent
        ? calcAccruedInPeriod(emp.vacation_allowance, p.periodStart, effectiveDate)
        : emp.vacation_allowance
      const remaining = Math.max(0, Math.round((accrued + carryIn - used) * 100) / 100)
      const carryOut  = isCurrent ? 0 : Math.min(5, remaining)
      const expired   = isCurrent ? 0 : Math.max(0, Math.round((remaining - 5) * 100) / 100)

      history.push({ periodYear: p.periodYear, periodStart: p.periodStart, periodEnd: p.periodEnd, accrued, carryIn, used, remaining, carryOut, expired, isCurrent })
      carryIn = carryOut
    }

    const cur  = history[history.length - 1]
    const prev = history[history.length - 2]
    setPeriodVacUsed(cur?.used ?? 0)
    setCarryover(cur?.carryIn ?? 0)
    setPaidOutPrev(prev?.expired ?? 0)
    setPeriodHistory(history)
  }

  async function select(emp: Employee) {
    setSel(emp)
    setLicenses([]); setAssets([]); setSubs([])
    await Promise.all([
      loadStats(emp, statsYear),
      supabase.from('licenses').select('id,account_id,account_type,display_name,email_address,alias,license_plan,monthly_cost_cad,status,notes').eq('employee_id', emp.id).then(({ data }) => setLicenses(data ?? [])),
      supabase.from('assets').select('id,asset_id,category,item_name,brand,model,serial_number,purchase_date,purchase_price,condition,notes').eq('employee_id', emp.id).then(({ data }) => setAssets(data ?? [])),
      supabase.from('subscription_employees')
        .select('subscriptions(id,vendor,product,plan_name,cost_cad,billing_cycle,status), subscription_id')
        .eq('employee_id', emp.id)
        .then(async ({ data: seRows }) => {
          if (!seRows?.length) { setSubs([]); return }
          const subIds = seRows.map(r => r.subscription_id)
          const { data: counts } = await supabase.from('subscription_employees')
            .select('subscription_id').in('subscription_id', subIds)
          const countMap: Record<string, number> = {}
          for (const r of (counts ?? [])) {
            countMap[r.subscription_id] = (countMap[r.subscription_id] ?? 0) + 1
          }
          const subs: Subscription[] = seRows
            .map(r => {
              const s = r.subscriptions as any
              if (!s) return null
              return { ...s, linked_count: countMap[r.subscription_id] ?? 1 }
            })
            .filter(Boolean) as Subscription[]
          setSubs(subs)
        }),
    ])
  }

  async function changeYear(y: number) {
    if (!selected) return
    setStatsYear(y)
    await loadStats(selected, y)
  }

  function exportEmployee() {
    if (!selected || !summary) return
    const companyName = (selected.companies as any)?.name ?? ''
    const monthlyCost = licenses.filter(l => l.account_type === 'Individual').reduce((s, l) => s + l.monthly_cost_cad, 0)
    const rows: string[][] = [
      ['항목', '값'],
      ['이름', selected.name],
      ['회사', companyName],
      ['팀', selected.team ?? ''],
      ['직급', selected.position ?? ''],
      ['입사일', selected.start_date ?? ''],
      ['퇴사일', selected.end_date ?? ''],
      [''],
      ['연차 사용', String(summary.vac)],
      ['병가 사용', String(summary.sick)],
      ['재택', String(summary.wfh)],
      ['Unpaid', String(summary.toil)],
      [''],
      ['[이메일 계정]', '', '', ''],
      ['Account ID', '이메일', '유형', '라이선스', '월 비용 CAD'],
      ...licenses.map(l => [l.account_id, l.email_address ?? '', l.account_type, l.license_plan ?? '', l.account_type === 'Individual' ? String(l.monthly_cost_cad) : '(Shared-제외)']),
      [''],
      ['[IT 자산]', '', '', ''],
      ['Asset ID', '장비', '모델', '시리얼'],
      ...assets.map(a => [a.asset_id, a.item_name ?? '', a.model ?? '', a.serial_number ?? '']),
      [''],
      ['월 라이선스 비용 합계 (Individual)', `$${monthlyCost.toFixed(2)} CAD`],
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${selected.name}_profile.csv`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  async function saveDateEdit() {
    if (!selected || !editField) return
    setSaving(true)
    const val = editValue || null
    await supabase.from('employees').update({ [editField]: val }).eq('id', selected.id)
    const updated = { ...selected, [editField]: val ?? undefined }
    setSel(updated)
    setEmps(p => p.map(e => e.id === selected.id ? updated : e))
    setEditField(null); setEditValue(''); setSaving(false)
  }

  async function handleTerminate() {
    if (!selected || !termDate) return
    setSaving(true)
    await supabase.from('employees').update({ is_active: false, end_date: termDate }).eq('id', selected.id)
    setEmps(p => p.filter(e => e.id !== selected.id))
    setSel(null); setTermModal(false); setTermDate(''); setSaving(false)
  }

  async function handleReactivate() {
    if (!selected) return
    setSaving(true)
    await supabase.from('employees').update({ is_active: true, end_date: null }).eq('id', selected.id)
    setEmps(p => p.filter(e => e.id !== selected.id))
    setSel(null); setSaving(false)
  }

  async function handleDeleteEmployee() {
    if (!selected) return
    setSaving(true)
    await supabase.from('employees').delete().eq('id', selected.id)
    setEmps(p => p.filter(e => e.id !== selected.id))
    setSel(null); setDeleteConfirm(false); setSaving(false)
  }

  async function handleDeleteDirect(empId: string) {
    setSaving(true)
    await supabase.from('employees').delete().eq('id', empId)
    setEmps(p => p.filter(e => e.id !== empId))
    if (selected?.id === empId) setSel(null)
    setQuickDeleteId(null)
    setSaving(false)
  }

  async function handleAddEmployee() {
    if (!newEmp.company_id || !newEmp.name.trim()) return
    setSaving(true); setAddError('')
    const basePayload = {
      company_id:         newEmp.company_id,
      name:               newEmp.name.trim(),
      team:               newEmp.team || null,
      position:           newEmp.position || null,
      start_date:         newEmp.start_date || null,
      end_date:           !newEmp.is_active && newEmp.end_date ? newEmp.end_date : null,
      is_active:          newEmp.is_active,
      vacation_allowance: newEmp.vacation_allowance,
      uses_accrual:       newEmp.uses_accrual,
      is_exempt:          newEmp.is_exempt,
      sort_order:         99,
    }
    let { error } = await supabase.from('employees')
      .insert({ ...basePayload, employment_type: newEmp.employment_type })
    if (error?.message?.includes('employment_type')) {
      ;({ error } = await supabase.from('employees').insert(basePayload))
    }
    if (error) { setAddError(error.message); setSaving(false); return }
    setAddModal(false)
    setNewEmp(p => ({ ...BLANK_FORM, company_id: p.company_id }))
    setSaving(false)
    let q = supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,position,is_exempt,uses_accrual,is_active,start_date,end_date,probation_start,probation_end,employment_type,companies(id,name)')
      .order('name')
    if (!showInactive) { q = q.eq('is_active', true) } else { q = q.or('is_active.eq.false,end_date.not.is.null') }
    if (compFilter !== 'all') q = q.eq('company_id', compFilter)
    q.then(({ data }) => {
      let emps = (data as Employee[]) ?? []
      if (!showInactive) emps = emps.filter(e => !e.end_date)
      setEmps(sortEmployees(emps, sortMode))
    })
  }

  function getVacStats(emp: Employee, periodUsed: number, co: number, asOf?: Date) {
    if (emp.is_exempt) return null
    if (emp.uses_accrual) {
      const period = emp.start_date ? getAnniversaryPeriod(emp.start_date, asOf) : null
      if (!period) return null
      const accrued    = calcAccruedInPeriod(emp.vacation_allowance, period.periodStart, asOf)
      const totalAvail = Math.round((accrued + co) * 100) / 100
      const remaining  = Math.max(0, Math.round((totalAvail - periodUsed) * 100) / 100)
      return { accrued, carryover: co, totalAvail, remaining, annual: emp.vacation_allowance, isAccrual: true, period, periodUsed }
    }
    return { accrued: emp.vacation_allowance, carryover: 0, totalAvail: emp.vacation_allowance, remaining: emp.vacation_allowance - periodUsed, annual: emp.vacation_allowance, isAccrual: false, period: null, periodUsed }
  }

  const days = (n: number) => locale === 'ko' ? `${n.toFixed(2)}일` : `${n.toFixed(2)} days`

  return (
    <div>
      {/* Search filter + add button */}
      <div className="flex gap-2 mb-2">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('emp.search_ph', locale)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
        <select value={compFilter} onChange={e => setComp(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white text-gray-700">
          <option value="all">{t('emp.all_companies', locale)}</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => setAddModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-colors">
          {t('emp.add', locale)}
        </button>
      </div>
      {/* Sort toggle */}
      <div className="flex items-center gap-1 mb-3">
        <span className="text-xs text-gray-400 mr-1">{locale === 'ko' ? '정렬:' : 'Sort:'}</span>
        {([['hire', locale === 'ko' ? '입사일순' : 'Hire Date'], ['name', locale === 'ko' ? '이름순' : 'Name']] as const).map(([mode, label]) => (
          <button key={mode} onClick={() => setSortMode(mode)}
            className={`px-2.5 py-1 text-xs rounded-lg font-semibold border transition-colors ${
              sortMode === mode
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400 hover:text-blue-600'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Active / Terminated tabs */}
      <div className="flex border-b-2 border-gray-200 mb-4">
        <button onClick={() => { setShowInactive(false); setSel(null) }}
          className={`px-5 py-2.5 text-sm font-bold border-b-2 -mb-0.5 transition-colors ${
            !showInactive
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}>
          {t('emp.tab.active', locale)}
        </button>
        <button onClick={() => { setShowInactive(true); setSel(null) }}
          className={`px-5 py-2.5 text-sm font-bold border-b-2 -mb-0.5 transition-colors ${
            showInactive
              ? 'border-red-500 text-red-500'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}>
          {t('emp.tab.terminated', locale)}
        </button>
      </div>

      <div className="flex gap-5">
        {/* Employee list */}
        <div className="w-72 flex-shrink-0 border border-gray-300 rounded-xl overflow-hidden max-h-[520px] overflow-y-auto bg-white shadow-sm">
          {employees.length === 0 ? (
            <div className="px-4 py-10 text-center text-gray-400 text-sm">
              {showInactive ? t('emp.no_terminated', locale) : t('emp.no_results', locale)}
            </div>
          ) : employees.map(emp => (
            <div key={emp.id}
              className={`group relative border-b border-gray-200 last:border-0 transition-colors cursor-pointer
                ${selected?.id === emp.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-blue-50'}`}>
              {quickDeleteId === emp.id ? (
                <div className="px-4 py-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">
                    {locale === 'ko' ? `${emp.name} 삭제할까요?` : `Delete ${emp.name}?`}
                  </span>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteDirect(emp.id) }}
                      disabled={saving}
                      className="text-xs bg-red-600 text-white px-2 py-0.5 rounded hover:bg-red-700 disabled:opacity-50">
                      {locale === 'ko' ? '삭제' : 'Delete'}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setQuickDeleteId(null) }}
                      className="text-xs border border-gray-300 text-gray-500 px-2 py-0.5 rounded hover:bg-gray-100">
                      {locale === 'ko' ? '취소' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ) : (
                <div onClick={() => select(emp)} className="px-4 py-3 pr-8">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{emp.name}</span>
                    {emp.is_exempt && (
                      <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                        {t('emp.badge.executive', locale)}
                      </span>
                    )}
                    {emp.employment_type === 'remote' && (
                      <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">Remote</span>
                    )}
                    {emp.employment_type === 'contractor' && (
                      <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">IC</span>
                    )}
                    {emp.is_active && emp.start_date && new Date(emp.start_date) > new Date() && (
                      <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                        {t('emp.badge.upcoming', locale)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{(emp.companies as any)?.name} · {emp.position || emp.team || '—'}</div>
                  {emp.end_date && (
                    <div className="text-xs text-red-500 mt-0.5 font-medium">
                      {emp.end_date} {t('emp.badge.terminated', locale)}
                    </div>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); setQuickDeleteId(emp.id) }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-100 text-gray-300 hover:text-red-500 text-xs">
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {selected && summary ? (() => {
          const asOf = selected.end_date
            ? (() => { const [y,m,d] = selected.end_date!.split('-').map(Number); return new Date(y,m-1,d) })()
            : undefined
          const vacStats   = getVacStats(selected, periodVacUsed, carryover, asOf)
          const paidSick   = Math.min(summary.sick, 5)
          const unpaidSick = Math.max(0, summary.sick - 5)
          const sickAlert  = summary.sick > 8

          return (
            <div className="flex-1 min-w-0">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xl font-bold text-gray-900">{selected.name}</h3>
                    {posEdit ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input autoFocus type="text" value={posValue}
                          onChange={e => setPosValue(e.target.value)}
                          onKeyDown={async e => {
                            if (e.key === 'Enter') {
                              await supabase.from('employees').update({ position: posValue || null }).eq('id', selected.id)
                              setEmps(prev => prev.map(em => em.id === selected.id ? { ...em, position: posValue } : em))
                              setSel(s => s ? { ...s, position: posValue } : s)
                              setPosEdit(false)
                            } else if (e.key === 'Escape') setPosEdit(false)
                          }}
                          className="text-sm border border-blue-400 rounded px-2 py-0.5 w-36 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        <button onClick={async () => {
                          await supabase.from('employees').update({ position: posValue || null }).eq('id', selected.id)
                          setEmps(prev => prev.map(em => em.id === selected.id ? { ...em, position: posValue } : em))
                          setSel(s => s ? { ...s, position: posValue } : s)
                          setPosEdit(false)
                        }} className="text-xs text-white bg-blue-600 px-2 py-0.5 rounded hover:bg-blue-700">
                          {t('common.save', locale)}
                        </button>
                        <button onClick={() => setPosEdit(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setPosValue(selected.position ?? ''); setPosEdit(true) }}
                        className="text-sm text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded font-medium hover:border-blue-400 hover:bg-blue-50 transition-colors group">
                        {selected.position || <span className="text-gray-400 text-xs">{t('emp.add_position', locale)}</span>}
                        <span className="ml-1 text-gray-300 group-hover:text-blue-400 text-xs">✎</span>
                      </button>
                    )}
                    {!selected.is_active && (
                      <span className="text-xs bg-red-100 border border-red-200 text-red-600 px-2 py-0.5 rounded font-semibold">
                        {t('emp.badge.terminated', locale)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-sm text-gray-600 font-medium flex-wrap">
                    <span>{(selected.companies as any)?.name}</span>
                    <span className="text-gray-400">·</span>
                    {teamEdit ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input autoFocus type="text" value={teamValue}
                          onChange={e => setTeamValue(e.target.value)}
                          onKeyDown={async e => {
                            if (e.key === 'Enter') {
                              await supabase.from('employees').update({ team: teamValue || null }).eq('id', selected.id)
                              setEmps(prev => prev.map(em => em.id === selected.id ? { ...em, team: teamValue } : em))
                              setSel(s => s ? { ...s, team: teamValue } : s)
                              setTeamEdit(false)
                            } else if (e.key === 'Escape') setTeamEdit(false)
                          }}
                          className="text-sm border border-blue-400 rounded px-2 py-0.5 w-32 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        <button onClick={async () => {
                          await supabase.from('employees').update({ team: teamValue || null }).eq('id', selected.id)
                          setEmps(prev => prev.map(em => em.id === selected.id ? { ...em, team: teamValue } : em))
                          setSel(s => s ? { ...s, team: teamValue } : s)
                          setTeamEdit(false)
                        }} className="text-xs text-white bg-blue-600 px-2 py-0.5 rounded hover:bg-blue-700">
                          {t('common.save', locale)}
                        </button>
                        <button onClick={() => setTeamEdit(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setTeamValue(selected.team ?? ''); setTeamEdit(true) }}
                        className="hover:text-blue-600 group flex items-center gap-0.5">
                        <span>{selected.team || <span className="text-gray-400 text-xs">{locale === 'ko' ? '부서 없음' : 'No team'}</span>}</span>
                        <span className="text-gray-300 group-hover:text-blue-400 text-xs ml-0.5">✎</span>
                      </button>
                    )}
                    <span className="text-gray-400">·</span>
                    <span>{selected.manager_name || t('emp.no_manager', locale)}</span>
                  </div>

                  {/* Probation */}
                  {(() => {
                    const todStr = todayIso()
                    const on = !!(selected.probation_start &&
                      selected.probation_start <= todStr &&
                      (!selected.probation_end || selected.probation_end >= todStr))
                    const openProbEdit = () => {
                      setProbStartMode(selected.start_date ? 'hire' : 'custom')
                      setProbStartVal(selected.probation_start ?? selected.start_date ?? '')
                      if (selected.probation_end) {
                        setProbEndMode('custom'); setProbEndVal(selected.probation_end)
                      } else if (selected.start_date) {
                        setProbEndMode('90d')
                        const d = new Date(selected.start_date); d.setDate(d.getDate() + 90)
                        setProbEndVal(d.toISOString().split('T')[0])
                      } else {
                        setProbEndMode('custom'); setProbEndVal('')
                      }
                      setProbModal(true)
                    }
                    return (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500 font-medium">{t('emp.probation', locale)}</span>
                        {selected.probation_start ? (
                          <>
                            <span className="text-xs font-medium text-gray-700">
                              {fmtDateLong(selected.probation_start, locale)}
                              {selected.probation_end
                                ? ` ~ ${fmtDateLong(selected.probation_end, locale)}`
                                : ` ~ ${t('common.not_set', locale)}`}
                            </span>
                            {on
                              ? <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-semibold">
                                  {t('emp.probation_active', locale)}
                                </span>
                              : <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">
                                  {t('emp.probation_done', locale)}
                                </span>
                            }
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">{t('common.not_set', locale)}</span>
                        )}
                        <button onClick={openProbEdit}
                          className="text-gray-300 hover:text-blue-500 text-xs transition-colors">✎</button>
                      </div>
                    )
                  })()}

                  {/* Start / End date edit */}
                  <div className="flex gap-4 mt-2">
                    <button
                      onClick={() => { setEditField('start_date'); setEditValue(selected.start_date ?? '') }}
                      className="flex items-center gap-1.5 text-xs group">
                      <span className="text-gray-500 font-medium">{t('emp.start_date', locale)}</span>
                      <span className={`font-semibold ${selected.start_date ? 'text-gray-800' : 'text-gray-300'}`}>
                        {fmtDateLong(selected.start_date, locale) ?? t('common.not_set', locale)}
                      </span>
                      <span className="text-gray-300 group-hover:text-blue-500">✎</span>
                    </button>
                    {!selected.is_active && (
                      <button
                        onClick={() => { setEditField('end_date'); setEditValue(selected.end_date ?? todayIso()) }}
                        className="flex items-center gap-1.5 text-xs group">
                        <span className="text-gray-500 font-medium">{t('emp.end_date', locale)}</span>
                        <span className={`font-semibold ${selected.end_date ? 'text-red-500' : 'text-gray-300'}`}>
                          {fmtDateLong(selected.end_date, locale) ?? t('common.not_set', locale)}
                        </span>
                        <span className="text-gray-300 group-hover:text-red-400">✎</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 ml-4 flex flex-col items-end gap-2">
                  {selected.is_active ? (
                    <button onClick={() => { setTermDate(todayIso()); setTermModal(true) }}
                      className="px-4 py-2 text-sm font-semibold text-red-600 border-2 border-red-200 rounded-lg hover:bg-red-50 transition-colors">
                      {t('emp.terminate', locale)}
                    </button>
                  ) : (
                    <button onClick={handleReactivate} disabled={saving}
                      className="px-4 py-2 text-sm font-semibold text-blue-600 border-2 border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50">
                      {t('emp.reactivate', locale)}
                    </button>
                  )}
                  <button onClick={exportEmployee}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    ↓ Export CSV
                  </button>
                  <button onClick={() => setDeleteConfirm(true)}
                    className="px-3 py-1.5 text-xs text-gray-400 border border-gray-200 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors">
                    {t('emp.delete', locale)}
                  </button>
                </div>
              </div>

              {/* Leave status */}
              {vacStats ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-bold text-green-800">{t('emp.vac.title', locale)}</div>
                    {vacStats.period && (
                      <div className="text-xs text-green-600 font-medium">
                        {isoFromDate(vacStats.period.periodStart)} ~ {isoFromDate(vacStats.period.periodEnd)}
                        <span className="ml-1.5 bg-green-200 text-green-800 px-1.5 py-0.5 rounded font-semibold">
                          {locale === 'ko' ? `${vacStats.period.periodYear}년차` : `Year ${vacStats.period.periodYear}`}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-5 text-sm flex-wrap">
                    {vacStats.isAccrual && (
                      <div>
                        <span className="text-green-700 font-semibold">{t('emp.vac.accrued', locale)}</span>
                        <span className="ml-2 text-green-900 font-bold text-base">{days(vacStats.accrued)}</span>
                      </div>
                    )}
                    {vacStats.carryover > 0 && (
                      <div>
                        <span className="text-blue-600 font-semibold">
                          {locale === 'ko' ? '이월' : 'Carried over'}
                        </span>
                        <span className="ml-2 text-blue-700 font-bold text-base">+{days(vacStats.carryover)}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-green-700 font-semibold">{t('emp.vac.used', locale)}</span>
                      <span className="ml-2 text-green-900 font-bold text-base">{days(vacStats.periodUsed)}</span>
                    </div>
                    <div>
                      <span className={`font-semibold ${vacStats.remaining <= 1 ? 'text-red-600' : 'text-green-700'}`}>
                        {t('emp.vac.remaining', locale)}
                      </span>
                      <span className={`ml-2 font-bold text-base ${vacStats.remaining <= 1 ? 'text-red-700' : 'text-green-900'}`}>
                        {days(vacStats.remaining)}
                      </span>
                    </div>
                  </div>
                  {vacStats.isAccrual && (
                    <div className="text-xs text-green-600 font-medium mt-1.5">
                      {locale === 'ko'
                        ? `입사일 기준 매월 ${(vacStats.annual/12).toFixed(2)}일 적립 · 미사용 최대 5일 이월, 초과분 수당 정산`
                        : `Accrual from hire: ${(vacStats.annual/12).toFixed(2)} days/month · up to 5 days carry over, excess paid out`}
                    </div>
                  )}
                  {paidOutPrev > 0 && (
                    <div className="text-xs text-orange-600 font-semibold mt-1">
                      {locale === 'ko'
                        ? `전년도 수당 정산: ${paidOutPrev.toFixed(2)}일 소멸 (5일 초과분)`
                        : `Prior year payout: ${paidOutPrev.toFixed(2)} days expired (over 5-day limit)`}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 mb-3 text-sm text-gray-500 font-medium">
                  {t('emp.vac.executive', locale)}
                </div>
              )}

              {/* Sick leave */}
              <div className={`border-2 rounded-xl p-4 mb-3 ${sickAlert ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-sm font-bold mb-2 ${sickAlert ? 'text-red-700' : 'text-gray-700'}`}>
                  {t('emp.sick.title', locale)}
                </div>
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="text-gray-600 font-semibold">{t('emp.sick.paid', locale)}</span>
                    <span className={`ml-2 font-bold text-base ${paidSick >= 5 ? 'text-orange-600' : 'text-gray-900'}`}>
                      {days(paidSick)}
                    </span>
                    <span className="text-gray-400 text-xs ml-1">
                      {locale === 'ko' ? '/ 5일' : '/ 5 days'}
                    </span>
                  </div>
                  {paidSick < 5 && (
                    <div>
                      <span className="text-gray-600 font-semibold">{t('emp.sick.remaining', locale)}</span>
                      <span className="ml-2 font-bold text-base text-gray-900">
                        {days(Math.round((5 - paidSick) * 10) / 10)}
                      </span>
                    </div>
                  )}
                  {unpaidSick > 0 && (
                    <div>
                      <span className="text-gray-600 font-semibold">{t('emp.sick.unpaid', locale)}</span>
                      <span className={`ml-2 font-bold text-base ${unpaidSick > 3 ? 'text-red-600' : 'text-orange-500'}`}>
                        {days(unpaidSick)}
                      </span>
                      <span className="text-gray-400 text-xs ml-1">
                        {locale === 'ko' ? '/ 3일' : '/ 3 days'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400 font-medium mt-1">
                  {locale === 'ko' ? '매해 1월 1일 초기화 · 연차와 별도 타임라인' : 'Resets Jan 1 each year · separate from vacation'}
                </div>
                {sickAlert && (
                  <div className="text-xs text-red-600 font-bold mt-1">{t('emp.sick.alert', locale)}</div>
                )}
                {!sickAlert && summary.sick >= 5 && (
                  <div className="text-xs text-orange-600 font-medium mt-1">{t('emp.sick.paid_exhausted', locale)}</div>
                )}
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { labelKey: 'emp.wfh',   val: summary.wfh,   bg: 'bg-blue-50  border-blue-200  text-blue-800'  },
                  { labelKey: 'emp.toil',  val: summary.toil,  bg: 'bg-gray-50  border-gray-200  text-gray-700'  },
                  { labelKey: 'emp.other', val: summary.other, bg: 'bg-gray-50  border-gray-200  text-gray-600'  },
                ].map(c => (
                  <div key={c.labelKey} className={`rounded-xl p-4 border-2 ${c.bg}`}>
                    <div className="text-xs font-semibold opacity-70 mb-1">
                      {c.labelKey === 'emp.toil' ? 'Unpaid' : t(c.labelKey, locale)}
                    </div>
                    <div className="text-2xl font-bold">
                      {c.val}<span className="text-sm font-semibold ml-1">{locale === 'ko' ? '일' : ' days'}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Monthly table */}
              <div className="border-2 border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-200">
                  <span className="text-xs font-bold text-gray-700">{t('emp.monthly.title', locale)}</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => changeYear(statsYear - 1)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 text-xs font-bold transition-colors">◀</button>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${statsYear === new Date().getFullYear() ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>
                      {locale === 'ko' ? `${statsYear}년` : String(statsYear)}
                    </span>
                    <button onClick={() => changeYear(statsYear + 1)}
                      disabled={statsYear >= new Date().getFullYear()}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 text-xs font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed">▶</button>
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 py-2 text-gray-600 font-bold w-14">{t('emp.monthly.type', locale)}</th>
                      {Array.from({ length: 12 }, (_, i) => {
                        const [hy, hm] = selected.start_date ? selected.start_date.split('-').map(Number) : [null, null]
                        const beforeHire = hy != null && (statsYear < hy || (statsYear === hy && (i + 1) < hm!))
                        return (
                          <th key={i+1} className={`text-center px-1 py-2 font-semibold min-w-8 ${beforeHire ? 'bg-gray-100 text-gray-300' : 'text-gray-600'}`}>
                            {t(`month.${i+1}`, locale)}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { key: 'vac',  labelKey: 'emp.monthly.leave', color: 'text-green-700 font-bold' },
                      { key: 'sick', labelKey: 'emp.monthly.sick',  color: 'text-red-600 font-bold'   },
                      { key: 'wfh',  labelKey: 'emp.monthly.wfh',   color: 'text-blue-600 font-bold'  },
                      { key: 'toil', labelKey: null,                 color: 'text-gray-600 font-bold'  },
                    ] as const).map(row => (
                      <tr key={row.key} className="border-t border-gray-200">
                        <td className="px-3 py-2 text-gray-700 font-semibold">
                          {row.labelKey ? t(row.labelKey, locale) : 'Unpaid'}
                        </td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const [hy, hm] = selected.start_date ? selected.start_date.split('-').map(Number) : [null, null]
                          const beforeHire = hy != null && (statsYear < hy || (statsYear === hy && (i + 1) < hm!))
                          const v = monthly[i+1]?.[row.key] ?? 0
                          return (
                            <td key={i} className={`text-center py-2 ${beforeHire ? 'bg-gray-100' : v > 0 ? row.color : 'text-gray-300'}`}>
                              {beforeHire ? '' : v > 0 ? v : '·'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Anniversary period history */}
              {selected.uses_accrual && !selected.is_exempt && periodHistory.length > 0 && (
                <div className="border-2 border-gray-200 rounded-xl overflow-hidden mt-3">
                  <button
                    onClick={() => setHistOpen(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-gray-100 hover:bg-gray-200 transition-colors">
                    <span className="text-xs font-bold text-gray-700">
                      {locale === 'ko'
                        ? `연차 기간별 통계 (${periodHistory.length}개 기간)`
                        : `Vacation Period History (${periodHistory.length} period${periodHistory.length > 1 ? 's' : ''})`}
                    </span>
                    <span className={`text-gray-500 text-xs font-bold inline-block transition-transform ${histOpen ? 'rotate-180' : ''}`}>▾</span>
                  </button>
                  {histOpen && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                            <th className="text-left px-3 py-2 font-bold">{locale === 'ko' ? '기간' : 'Period'}</th>
                            <th className="text-center px-2 py-2">{locale === 'ko' ? '적립' : 'Accrued'}</th>
                            <th className="text-center px-2 py-2">{locale === 'ko' ? '+이월' : '+Carry'}</th>
                            <th className="text-center px-2 py-2">{locale === 'ko' ? '사용' : 'Used'}</th>
                            <th className="text-center px-2 py-2">{locale === 'ko' ? '잔여' : 'Balance'}</th>
                            <th className="text-center px-2 py-2">{locale === 'ko' ? '→이월' : '→Next'}</th>
                            <th className="text-center px-2 py-2">{locale === 'ko' ? '소멸' : 'Expired'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {periodHistory.map(stat => (
                            <tr key={stat.periodYear} className={`border-t border-gray-200 ${stat.isCurrent ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-gray-800 flex items-center gap-1.5">
                                  {locale === 'ko' ? `${stat.periodYear}년차` : `Year ${stat.periodYear}`}
                                  {stat.isCurrent && (
                                    <span className="text-green-700 bg-green-100 px-1.5 py-0.5 rounded text-xs font-medium">
                                      {locale === 'ko' ? '진행중' : 'current'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-gray-400 text-xs">
                                  {isoFromDate(stat.periodStart)} ~ {isoFromDate(stat.isCurrent ? new Date() : stat.periodEnd)}
                                </div>
                              </td>
                              <td className="text-center px-2 py-2 text-gray-700">{days(stat.accrued)}</td>
                              <td className="text-center px-2 py-2 text-blue-600">{stat.carryIn > 0 ? `+${days(stat.carryIn)}` : '—'}</td>
                              <td className="text-center px-2 py-2 text-gray-700">{days(stat.used)}</td>
                              <td className={`text-center px-2 py-2 font-bold ${stat.remaining <= 1 && stat.isCurrent ? 'text-red-600' : 'text-gray-900'}`}>
                                {days(stat.remaining)}
                              </td>
                              <td className="text-center px-2 py-2 text-green-700">
                                {stat.isCurrent ? '—' : stat.carryOut > 0 ? days(stat.carryOut) : '—'}
                              </td>
                              <td className="text-center px-2 py-2 text-orange-600 font-medium">
                                {stat.isCurrent ? '—' : stat.expired > 0 ? days(stat.expired) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Monthly cost + email accounts + assets + subscriptions */}
              {(licenses.length > 0 || assets.length > 0 || subscriptions.length > 0) && (() => {
                const individualCost = licenses.filter(l => l.account_type === 'Individual').reduce((s, l) => s + (l.monthly_cost_cad ?? 0), 0)
                const subMonthlyCost = subscriptions.reduce((s, sub) => {
                  const mo = sub.billing_cycle === 'Annual' ? sub.cost_cad / 12 : sub.cost_cad
                  return s + mo / sub.linked_count
                }, 0)
                const totalCost = individualCost + subMonthlyCost
                return (
                  <div className="mt-3 space-y-3">
                    <div className="border-2 border-indigo-100 bg-indigo-50 rounded-xl px-4 py-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-indigo-800">{t('emp.cost.title', locale)}</span>
                      <span className="text-xl font-bold text-indigo-900">
                        ${totalCost.toFixed(2)} <span className="text-sm font-semibold text-indigo-600">{t('emp.cost.per_month', locale)}</span>
                      </span>
                    </div>

                    {licenses.length > 0 && (
                      <div className="border-2 border-gray-200 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-gray-100 text-xs font-bold text-gray-700">{t('emp.licenses.title', locale)}</div>
                        {licenses.map(l => (
                          <div key={l.id} className="px-3 py-2.5 border-t border-gray-100 flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-800 truncate">{l.email_address}</div>
                              <div className="text-xs text-gray-400">{l.license_plan}</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {l.account_type === 'Shared' && (
                                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">Shared</span>
                              )}
                              <span className={`text-xs font-semibold ${l.account_type === 'Shared' ? 'text-gray-300' : 'text-blue-600'}`}>
                                {l.account_type === 'Shared' ? '—' : `$${l.monthly_cost_cad}${locale === 'ko' ? '/월' : '/mo'}`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {assets.length > 0 && (
                      <div className="border-2 border-gray-200 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-gray-100 text-xs font-bold text-gray-700">{t('emp.assets.title', locale)}</div>
                        {assets.map(a => (
                          <div key={a.id} className="px-3 py-2.5 border-t border-gray-100 flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-800">{a.item_name}{a.model ? ` — ${a.model}` : ''}</div>
                              <div className="text-xs text-gray-400">{a.asset_id}{a.serial_number ? ` · ${a.serial_number}` : ''}</div>
                            </div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ml-2 ${a.condition === 'In Use' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {a.condition}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {subscriptions.length > 0 && (
                      <div className="border-2 border-violet-100 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-violet-50 text-xs font-bold text-violet-700">{t('emp.subs.title', locale)}</div>
                        {subscriptions.map(sub => {
                          const mo = sub.billing_cycle === 'Annual' ? sub.cost_cad / 12 : sub.cost_cad
                          const perPerson = mo / sub.linked_count
                          return (
                            <div key={sub.id} className="px-3 py-2.5 border-t border-violet-100 flex items-center justify-between">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-gray-800">
                                  {sub.vendor}{sub.product ? ` — ${sub.product}` : ''}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {sub.plan_name ?? sub.billing_cycle ?? ''}
                                  {sub.linked_count > 1 && ` · ${locale === 'ko' ? `${sub.linked_count}명 공유` : `shared by ${sub.linked_count}`}`}
                                </div>
                              </div>
                              <span className="text-xs font-semibold text-violet-600 flex-shrink-0 ml-2">
                                ${perPerson.toFixed(2)}{locale === 'ko' ? '/월' : '/mo'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })() : (
          <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-300 rounded-xl text-gray-400 text-sm font-medium min-h-48 bg-gray-50">
            {t('emp.empty', locale)}
          </div>
        )}
      </div>

      {/* Add employee modal */}
      {addModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => { setAddModal(false); setAddError('') }}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">{t('emp.add_modal.title', locale)}</h3>
            {addError && (
              <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{addError}</div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.company', locale)}</label>
                <select value={newEmp.company_id}
                  onChange={e => setNewEmp(p => ({ ...p, company_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.name', locale)}</label>
                <input placeholder={t('emp.add_modal.name_ph', locale)} value={newEmp.name}
                  onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.team', locale)}</label>
                  <input placeholder="Team Sales" value={newEmp.team}
                    onChange={e => setNewEmp(p => ({ ...p, team: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.position', locale)}</label>
                  <input placeholder="Sales Rep" value={newEmp.position}
                    onChange={e => setNewEmp(p => ({ ...p, position: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.start_date', locale)}</label>
                <input type="date" value={newEmp.start_date}
                  onChange={e => setNewEmp(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>

              <div className="flex gap-2">
                <button onClick={() => setNewEmp(p => ({ ...p, is_active: true }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                    newEmp.is_active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600'
                  }`}>
                  {t('emp.add_modal.active', locale)}
                </button>
                <button onClick={() => setNewEmp(p => ({ ...p, is_active: false }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                    !newEmp.is_active ? 'bg-red-500 border-red-500 text-white' : 'bg-white border-gray-300 text-gray-600'
                  }`}>
                  {t('emp.add_modal.terminated', locale)}
                </button>
              </div>

              {!newEmp.is_active && (
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.end_date', locale)}</label>
                  <input type="date" value={newEmp.end_date}
                    onChange={e => setNewEmp(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.emp_type', locale)}</label>
                <div className="flex gap-2">
                  {([
                    { val: 'office',     label: t('emp.add_modal.office', locale) },
                    { val: 'remote',     label: 'Remote' },
                    { val: 'contractor', label: locale === 'ko' ? 'IC/외주' : 'IC/Subcontract' },
                  ] as const).map(opt => (
                    <button key={opt.val} type="button"
                      onClick={() => setNewEmp(p => ({ ...p, employment_type: opt.val }))}
                      className={`flex-1 py-1.5 text-xs rounded-lg border-2 font-semibold transition-colors ${
                        newEmp.employment_type === opt.val
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:border-blue-300'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 items-end pt-1">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.add_modal.annual_leave', locale)}</label>
                  <input type="number" value={newEmp.vacation_allowance}
                    onChange={e => setNewEmp(p => ({ ...p, vacation_allowance: +e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer pb-2 font-medium">
                  <input type="checkbox" checked={newEmp.uses_accrual}
                    onChange={e => setNewEmp(p => ({ ...p, uses_accrual: e.target.checked }))} className="rounded" />
                  {t('emp.add_modal.accrual', locale)}
                </label>
                <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer pb-2 font-medium">
                  <input type="checkbox" checked={newEmp.is_exempt}
                    onChange={e => setNewEmp(p => ({ ...p, is_exempt: e.target.checked }))} className="rounded" />
                  {t('emp.add_modal.executive', locale)}
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleAddEmployee}
                disabled={!newEmp.name.trim() || !newEmp.company_id || saving}
                className="flex-1 bg-blue-600 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold transition-colors">
                {t('common.add', locale)}
              </button>
              <button onClick={() => setAddModal(false)}
                className="flex-1 border-2 border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Date edit modal */}
      {editField && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setEditField(null)}>
          <div className="bg-white rounded-2xl p-6 w-72 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-1">
              {editField === 'start_date'
                ? t('emp.date_modal.start_title', locale)
                : t('emp.date_modal.end_title', locale)}
            </h3>
            <p className="text-sm text-gray-800 font-semibold mb-3">{selected.name}</p>
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                {editField === 'start_date'
                  ? t('emp.date_modal.start_label', locale)
                  : t('emp.date_modal.end_label', locale)}
              </label>
              <input type="date" value={editValue}
                onChange={e => setEditValue(e.target.value)}
                className={`w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  editField === 'end_date' ? 'border-red-200 focus:ring-red-400' : 'border-gray-300 focus:ring-blue-400'
                }`} />
              {editField === 'start_date' && (
                <button onClick={() => setEditValue('')}
                  className="mt-1 text-xs text-gray-400 hover:text-gray-600 font-medium">
                  {t('emp.date_modal.clear', locale)}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={saveDateEdit} disabled={(editField === 'end_date' && !editValue) || saving}
                className={`flex-1 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold ${
                  editField === 'end_date' ? 'bg-red-600' : 'bg-blue-600'
                }`}>
                {t('common.save', locale)}
              </button>
              <button onClick={() => setEditField(null)}
                className="flex-1 border-2 border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Probation modal */}
      {probModal && selected && (() => {
        const saveProb = async () => {
          const finalStart = probStartMode === 'hire' ? (selected.start_date ?? null) : (probStartVal || null)
          const finalEnd   = probEndVal || null
          await supabase.from('employees').update({ probation_start: finalStart, probation_end: finalEnd }).eq('id', selected.id)
          const updated = { ...selected, probation_start: finalStart ?? undefined, probation_end: finalEnd ?? undefined }
          setSel(updated)
          setEmps(p => p.map(e => e.id === selected.id ? updated : e))
          setProbModal(false)
        }
        const deleteProb = async () => {
          await supabase.from('employees').update({ probation_start: null, probation_end: null }).eq('id', selected.id)
          const updated = { ...selected, probation_start: undefined, probation_end: undefined }
          setSel(updated)
          setEmps(p => p.map(e => e.id === selected.id ? updated : e))
          setProbModal(false)
        }
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
               onClick={e => { if (e.target === e.currentTarget) setProbModal(false) }}>
            <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900">{t('emp.prob_modal.start', locale)} — {selected.name}</h3>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-600">{t('emp.prob_modal.start', locale)}</p>
                <div className="flex gap-2">
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode==='hire'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbStartMode('hire')
                      if (probEndMode==='90d' && selected.start_date) {
                        const d=new Date(selected.start_date); d.setDate(d.getDate()+90)
                        setProbEndVal(d.toISOString().split('T')[0])
                      }
                    }}>{t('emp.prob_modal.hire', locale)}</button>
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode==='custom'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbStartMode('custom')}>{t('emp.prob_modal.custom', locale)}</button>
                </div>
                {probStartMode==='hire'
                  ? <p className="text-xs text-gray-400">
                      {t('emp.prob_modal.start_label', locale)} {selected.start_date ?? t('common.not_set', locale)}
                    </p>
                  : <input type="date" value={probStartVal}
                      onChange={e => {
                        setProbStartVal(e.target.value)
                        if (probEndMode==='90d' && e.target.value) {
                          const d=new Date(e.target.value); d.setDate(d.getDate()+90)
                          setProbEndVal(d.toISOString().split('T')[0])
                        }
                      }}
                      className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                }
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-600">{t('emp.prob_modal.end', locale)}</p>
                <div className="flex gap-2">
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode==='90d'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbEndMode('90d')
                      const ref = probStartMode==='hire' ? selected.start_date : probStartVal
                      if (ref) { const d=new Date(ref); d.setDate(d.getDate()+90); setProbEndVal(d.toISOString().split('T')[0]) }
                    }}>+90{locale === 'ko' ? '일' : ' days'}</button>
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode==='custom'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbEndMode('custom')}>{t('emp.prob_modal.custom', locale)}</button>
                </div>
                <input type="date" value={probEndVal} readOnly={probEndMode==='90d'}
                  onChange={e => { if (probEndMode==='custom') setProbEndVal(e.target.value) }}
                  className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${probEndMode==='90d'?'bg-gray-50 text-gray-500':''}`} />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={saveProb}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-2 text-sm font-bold hover:bg-blue-700">
                  {t('common.save', locale)}
                </button>
                <button onClick={() => setProbModal(false)}
                  className="px-4 border-2 border-gray-200 rounded-xl py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  {t('common.cancel', locale)}
                </button>
                {selected.probation_start && (
                  <button onClick={deleteProb}
                    className="px-4 border-2 border-red-200 text-red-600 rounded-xl py-2 text-sm font-semibold hover:bg-red-50">
                    {t('common.delete', locale)}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Delete confirm modal */}
      {deleteConfirm && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-1">{t('emp.delete_modal.title', locale)}</h3>
            <p className="text-sm text-gray-600 mb-1">
              <strong className="text-gray-900">{selected.name}</strong>
            </p>
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-4">
              {t('emp.delete_modal.warning', locale)}
            </p>
            <div className="flex gap-2">
              <button onClick={handleDeleteEmployee} disabled={saving}
                className="flex-1 bg-red-600 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold">
                {t('common.delete', locale)}
              </button>
              <button onClick={() => setDeleteConfirm(false)}
                className="flex-1 border-2 border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terminate modal */}
      {termModal && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setTermModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-1">{t('emp.term_modal.title', locale)}</h3>
            <p className="text-sm text-gray-600 mb-4">
              <strong className="text-gray-900">{selected.name}</strong>
              <br /><span className="text-xs">{t('emp.term_modal.note', locale)}</span>
            </p>
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">{t('emp.end_date', locale)}</label>
              <input type="date" value={termDate} onChange={e => setTermDate(e.target.value)}
                className="w-full border-2 border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleTerminate} disabled={!termDate || saving}
                className="flex-1 bg-red-600 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold">
                {t('emp.term_modal.confirm', locale)}
              </button>
              <button onClick={() => setTermModal(false)}
                className="flex-1 border-2 border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
