#!/usr/bin/env python3
"""Run in Codespaces terminal: python update-hr7.py"""
import os

def write(path, content):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content.lstrip('\n'))
    print(f'  updated: {path}')

# ─────────────────────────────────────────────
# app/hr/page.tsx  — main dashboard
# Fix: remove duplicate "직원 검색" h2
# Design: stronger card borders, section headings
# ─────────────────────────────────────────────
write('app/hr/page.tsx', """
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import HrSummaryCards from './components/HrSummaryCards'
import EmployeeSearch from './components/EmployeeSearch'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const COMPANIES = [
  { slug: 'afs', label: 'AFS 근태',  color: 'bg-blue-600  hover:bg-blue-700  text-white' },
  { slug: 'tnt', label: 'TNT 근태',  color: 'bg-green-600 hover:bg-green-700 text-white' },
  { slug: 'zfs', label: 'ZFS 준비중', color: 'bg-gray-200  text-gray-400 cursor-not-allowed', disabled: true },
]

export default function HrPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">HR Dashboard</h1>
          <div className="flex gap-2">
            {COMPANIES.map(c => (
              <button key={c.slug}
                onClick={() => !c.disabled && router.push(`/hr/${c.slug}`)}
                disabled={c.disabled}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${c.color}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* 요약 카드 */}
        <HrSummaryCards />

        {/* 직원 검색 */}
        <div className="mt-8 bg-white border border-gray-300 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-gray-900">직원 검색</h2>
          </div>
          <EmployeeSearch />
        </div>
      </div>
    </div>
  )
}
""")

# ─────────────────────────────────────────────
# app/hr/components/HrSummaryCards.tsx
# Design refresh: stronger borders, more contrast
# ─────────────────────────────────────────────
write('app/hr/components/HrSummaryCards.tsx', """
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Stats = { total: number; absent: number; wfh: number; highVac: number }

export default function HrSummaryCards() {
  const [stats, setStats] = useState<Stats>({ total: 0, absent: 0, wfh: 0, highVac: 0 })

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

  const cards = [
    {
      label: '전체 직원',
      value: stats.total,
      unit: '명',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      numColor: 'text-blue-700',
      labelColor: 'text-blue-600',
    },
    {
      label: '오늘 부재',
      value: stats.absent,
      unit: '명',
      bg: 'bg-red-50',
      border: 'border-red-200',
      numColor: 'text-red-600',
      labelColor: 'text-red-500',
    },
    {
      label: '오늘 재택',
      value: stats.wfh,
      unit: '명',
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      numColor: 'text-purple-700',
      labelColor: 'text-purple-500',
    },
    {
      label: '연차 18일+ 사용',
      value: stats.highVac,
      unit: '명',
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
""")

# ─────────────────────────────────────────────
# app/hr/components/EmployeeSearch.tsx
# Changes vs hr6:
#   - Remove h2 (moved to parent page)
#   - "+ 직원 추가" button (adds active OR terminated)
#   - Stronger borders / better contrast throughout
# ─────────────────────────────────────────────
write('app/hr/components/EmployeeSearch.tsx', """
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Employee = {
  id: string; name: string; team: string; manager_name: string
  vacation_allowance: number; position: string
  is_exempt: boolean; uses_accrual: boolean; is_active: boolean
  start_date?: string; end_date?: string
  companies: { id: string; name: string }
}
type Summary = { vac: number; sick: number; wfh: number; toil: number; other: number }
type Monthly = Record<number, Summary>

const MO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

function calcDays(code: string) { return ['L1','L2','S1','S2'].includes(code) ? 0.5 : 1 }
function calcAccrued(annual: number) {
  const today = new Date()
  const soy   = new Date(today.getFullYear(), 0, 1)
  return Math.min(((today.getTime() - soy.getTime()) / 86400000 / 365) * annual, annual)
}
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtDateLong(iso?: string) {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  return `${y}년 ${+m}월 ${+d}일`
}

type DateField = 'start_date' | 'end_date'

type NewEmpForm = {
  company_id: string; name: string; team: string; position: string
  start_date: string; is_active: boolean; end_date: string
  vacation_allowance: number; uses_accrual: boolean; is_exempt: boolean
}

const BLANK_FORM: NewEmpForm = {
  company_id: '', name: '', team: '', position: '',
  start_date: '', is_active: true, end_date: '',
  vacation_allowance: 10, uses_accrual: true, is_exempt: false,
}

export default function EmployeeSearch() {
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
  const [newEmp,       setNewEmp]       = useState<NewEmpForm>(BLANK_FORM)

  useEffect(() => {
    supabase.from('companies').select('id,name').order('name')
      .then(({ data }) => {
        setComps(data ?? [])
        if (data?.length) setNewEmp(p => ({ ...p, company_id: data[0].id }))
      })
  }, [])

  useEffect(() => {
    let q = supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,position,is_exempt,uses_accrual,is_active,start_date,end_date,companies(id,name)')
      .eq('is_active', !showInactive).order('name')
    if (query)                q = q.ilike('name', `%${query}%`)
    if (compFilter !== 'all') q = q.eq('company_id', compFilter)
    q.then(({ data }) => { setEmps((data as Employee[]) ?? []); setSel(null) })
  }, [query, compFilter, showInactive])

  async function select(emp: Employee) {
    setSel(emp)
    const year = new Date().getFullYear()
    const { data } = await supabase.from('leave_entries')
      .select('date,leave_code').eq('employee_id', emp.id)
      .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)

    const s: Summary = { vac: 0, sick: 0, wfh: 0, toil: 0, other: 0 }
    const m: Monthly = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i+1, { vac:0, sick:0, wfh:0, toil:0, other:0 }]))
    for (const e of (data ?? [])) {
      const mo = new Date(e.date).getMonth() + 1
      const d  = calcDays(e.leave_code)
      if      (['L','L1','L2','L3'].includes(e.leave_code)) { s.vac  += d; m[mo].vac  += d }
      else if (['S','S1','S2','S3'].includes(e.leave_code)) { s.sick += d; m[mo].sick += d }
      else if (e.leave_code === 'W')                        { s.wfh  += 1; m[mo].wfh  += 1 }
      else if (e.leave_code === 'T')                        { s.toil += 1; m[mo].toil += 1 }
      else                                                  { s.other += d; m[mo].other += d }
    }
    setSum(s); setMo(m)
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

  async function handleAddEmployee() {
    if (!newEmp.company_id || !newEmp.name.trim()) return
    setSaving(true)
    await supabase.from('employees').insert({
      company_id:        newEmp.company_id,
      name:              newEmp.name.trim(),
      team:              newEmp.team || null,
      position:          newEmp.position || null,
      start_date:        newEmp.start_date || null,
      end_date:          !newEmp.is_active && newEmp.end_date ? newEmp.end_date : null,
      is_active:         newEmp.is_active,
      vacation_allowance: newEmp.vacation_allowance,
      uses_accrual:      newEmp.uses_accrual,
      is_exempt:         newEmp.is_exempt,
      sort_order:        99,
    })
    setAddModal(false)
    setNewEmp(p => ({ ...BLANK_FORM, company_id: p.company_id }))
    setSaving(false)
    // refresh list
    let q = supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,position,is_exempt,uses_accrual,is_active,start_date,end_date,companies(id,name)')
      .eq('is_active', !showInactive).order('name')
    if (compFilter !== 'all') q = q.eq('company_id', compFilter)
    q.then(({ data }) => setEmps((data as Employee[]) ?? []))
  }

  function getVacStats(emp: Employee, vacUsed: number) {
    if (emp.is_exempt) return null
    if (emp.uses_accrual) {
      const accrued   = Math.round(calcAccrued(emp.vacation_allowance) * 10) / 10
      const remaining = Math.max(0, Math.round((accrued - vacUsed) * 10) / 10)
      return { accrued, remaining, annual: emp.vacation_allowance, isAccrual: true }
    }
    return { accrued: emp.vacation_allowance, remaining: emp.vacation_allowance - vacUsed, annual: emp.vacation_allowance, isAccrual: false }
  }

  return (
    <div>
      {/* 검색 필터 + 추가 버튼 */}
      <div className="flex gap-2 mb-3">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름 검색..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
        <select value={compFilter} onChange={e => setComp(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white text-gray-700">
          <option value="all">전체 회사</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => setAddModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-colors">
          + 직원 추가
        </button>
      </div>

      {/* 재직/퇴사 토글 */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowInactive(false)}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            !showInactive ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-300 hover:border-gray-400 bg-white'
          }`}>
          재직중
        </button>
        <button onClick={() => setShowInactive(true)}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            showInactive ? 'bg-red-500 text-white border-red-500' : 'text-gray-600 border-gray-300 hover:border-gray-400 bg-white'
          }`}>
          퇴사자
        </button>
      </div>

      <div className="flex gap-5">
        {/* 목록 */}
        <div className="w-72 flex-shrink-0 border border-gray-300 rounded-xl overflow-hidden max-h-[520px] overflow-y-auto bg-white shadow-sm">
          {employees.length === 0 ? (
            <div className="px-4 py-10 text-center text-gray-400 text-sm">
              {showInactive ? '퇴사 직원 없음' : '검색 결과 없음'}
            </div>
          ) : employees.map(emp => (
            <button key={emp.id} onClick={() => select(emp)}
              className={`w-full text-left px-4 py-3 border-b border-gray-200 last:border-0 hover:bg-blue-50 transition-colors
                ${selected?.id === emp.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{emp.name}</span>
                {emp.is_exempt && (
                  <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">임원</span>
                )}
                {emp.is_active && emp.start_date && new Date(emp.start_date) > new Date() && (
                  <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">입사예정</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{(emp.companies as any)?.name} · {emp.position || emp.team || '—'}</div>
              {emp.end_date && <div className="text-xs text-red-500 mt-0.5 font-medium">{emp.end_date} 퇴사</div>}
            </button>
          ))}
        </div>

        {/* 상세 패널 */}
        {selected && summary ? (() => {
          const vacStats   = getVacStats(selected, summary.vac)
          const paidSick   = Math.min(summary.sick, 5)
          const unpaidSick = Math.max(0, summary.sick - 5)
          const sickAlert  = summary.sick > 8

          return (
            <div className="flex-1 min-w-0">
              {/* 헤더 */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xl font-bold text-gray-900">{selected.name}</h3>
                    {selected.position && (
                      <span className="text-sm text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded font-medium">{selected.position}</span>
                    )}
                    {!selected.is_active && (
                      <span className="text-xs bg-red-100 border border-red-200 text-red-600 px-2 py-0.5 rounded font-semibold">퇴사</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1 font-medium">
                    {(selected.companies as any)?.name} · {selected.team} · {selected.manager_name || '매니저 없음'}
                  </p>

                  {/* 입사일 / 퇴사일 편집 */}
                  <div className="flex gap-4 mt-2">
                    <button
                      onClick={() => { setEditField('start_date'); setEditValue(selected.start_date ?? '') }}
                      className="flex items-center gap-1.5 text-xs group">
                      <span className="text-gray-500 font-medium">입사일</span>
                      <span className={`font-semibold ${selected.start_date ? 'text-gray-800' : 'text-gray-300'}`}>
                        {fmtDateLong(selected.start_date) ?? '미설정'}
                      </span>
                      <span className="text-gray-300 group-hover:text-blue-500">✎</span>
                    </button>
                    {!selected.is_active && (
                      <button
                        onClick={() => { setEditField('end_date'); setEditValue(selected.end_date ?? todayIso()) }}
                        className="flex items-center gap-1.5 text-xs group">
                        <span className="text-gray-500 font-medium">퇴사일</span>
                        <span className={`font-semibold ${selected.end_date ? 'text-red-500' : 'text-gray-300'}`}>
                          {fmtDateLong(selected.end_date) ?? '미설정'}
                        </span>
                        <span className="text-gray-300 group-hover:text-red-400">✎</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 ml-4">
                  {selected.is_active ? (
                    <button onClick={() => { setTermDate(todayIso()); setTermModal(true) }}
                      className="px-4 py-2 text-sm font-semibold text-red-600 border-2 border-red-200 rounded-lg hover:bg-red-50 transition-colors">
                      퇴사 처리
                    </button>
                  ) : (
                    <button onClick={handleReactivate} disabled={saving}
                      className="px-4 py-2 text-sm font-semibold text-blue-600 border-2 border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50">
                      복직 처리
                    </button>
                  )}
                </div>
              </div>

              {/* 연차 */}
              {vacStats ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 mb-3">
                  <div className="text-sm font-bold text-green-800 mb-2">연차 현황</div>
                  <div className="flex gap-6 text-sm">
                    {vacStats.isAccrual && (
                      <div>
                        <span className="text-green-700 font-semibold">현재 적립</span>
                        <span className="ml-2 text-green-900 font-bold text-base">{vacStats.accrued}일</span>
                        <span className="text-green-600 text-xs ml-1">/ 연 {vacStats.annual}일</span>
                      </div>
                    )}
                    <div>
                      <span className="text-green-700 font-semibold">사용</span>
                      <span className="ml-2 text-green-900 font-bold text-base">{summary.vac}일</span>
                    </div>
                    <div>
                      <span className={`font-semibold ${vacStats.remaining <= 1 ? 'text-red-600' : 'text-green-700'}`}>잔여</span>
                      <span className={`ml-2 font-bold text-base ${vacStats.remaining <= 1 ? 'text-red-700' : 'text-green-900'}`}>
                        {vacStats.remaining}일
                      </span>
                    </div>
                  </div>
                  {vacStats.isAccrual && (
                    <div className="text-xs text-green-600 font-medium mt-1">매월 {(vacStats.annual/12).toFixed(2)}일 적립 · 사전 사용 불가</div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 mb-3 text-sm text-gray-500 font-medium">
                  임원 — 연차 별도 카운트 없음
                </div>
              )}

              {/* 병가 */}
              <div className={`border-2 rounded-xl p-4 mb-3 ${sickAlert ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-sm font-bold mb-2 ${sickAlert ? 'text-red-700' : 'text-gray-700'}`}>병가 현황</div>
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="text-gray-600 font-semibold">유급 사용</span>
                    <span className={`ml-2 font-bold text-base ${paidSick >= 5 ? 'text-orange-600' : 'text-gray-900'}`}>{paidSick}/5일</span>
                  </div>
                  {unpaidSick > 0 && (
                    <div>
                      <span className="text-gray-600 font-semibold">무급 사용</span>
                      <span className={`ml-2 font-bold text-base ${unpaidSick > 3 ? 'text-red-600' : 'text-orange-500'}`}>{unpaidSick}/3일</span>
                    </div>
                  )}
                </div>
                {sickAlert && <div className="text-xs text-red-600 font-bold mt-1">⚠ 무급 한도 초과 — 회사와 협의 필요</div>}
                {!sickAlert && summary.sick >= 5 && <div className="text-xs text-orange-600 font-medium mt-1">유급 한도 소진 — 이후 무급 처리</div>}
              </div>

              {/* 기타 */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: '재택',   val: summary.wfh,   bg: 'bg-blue-50  border-blue-200  text-blue-800'  },
                  { label: 'Unpaid', val: summary.toil,  bg: 'bg-gray-50  border-gray-200  text-gray-700'  },
                  { label: '기타',   val: summary.other, bg: 'bg-gray-50  border-gray-200  text-gray-600'  },
                ].map(c => (
                  <div key={c.label} className={`rounded-xl p-4 border-2 ${c.bg}`}>
                    <div className="text-xs font-semibold opacity-70 mb-1">{c.label}</div>
                    <div className="text-2xl font-bold">{c.val}<span className="text-sm font-semibold ml-1">일</span></div>
                  </div>
                ))}
              </div>

              {/* 월별 */}
              <div className="border-2 border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-200">
                      <th className="text-left px-3 py-2 text-gray-600 font-bold w-14">타입</th>
                      {MO.map(m => <th key={m} className="text-center px-1 py-2 text-gray-600 font-semibold min-w-8">{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { key: 'vac',  label: '연차',   color: 'text-green-700 font-bold' },
                      { key: 'sick', label: '병가',   color: 'text-red-600 font-bold'   },
                      { key: 'wfh',  label: '재택',   color: 'text-blue-600 font-bold'  },
                      { key: 'toil', label: 'Unpaid', color: 'text-gray-600 font-bold'  },
                    ] as const).map(row => (
                      <tr key={row.key} className="border-t border-gray-200">
                        <td className="px-3 py-2 text-gray-700 font-semibold">{row.label}</td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const v = monthly[i+1]?.[row.key] ?? 0
                          return (
                            <td key={i} className={`text-center py-2 ${v > 0 ? row.color : 'text-gray-300'}`}>
                              {v > 0 ? v : '·'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })() : (
          <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-300 rounded-xl text-gray-400 text-sm font-medium min-h-48 bg-gray-50">
            좌측에서 직원을 선택하세요
          </div>
        )}
      </div>

      {/* 직원 추가 모달 */}
      {addModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setAddModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">직원 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">회사 *</label>
                <select value={newEmp.company_id}
                  onChange={e => setNewEmp(p => ({ ...p, company_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">이름 *</label>
                <input placeholder="홍길동" value={newEmp.name}
                  onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">팀</label>
                  <input placeholder="Team Sales" value={newEmp.team}
                    onChange={e => setNewEmp(p => ({ ...p, team: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">직급</label>
                  <input placeholder="Sales Rep" value={newEmp.position}
                    onChange={e => setNewEmp(p => ({ ...p, position: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">입사일</label>
                <input type="date" value={newEmp.start_date}
                  onChange={e => setNewEmp(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>

              {/* 재직/퇴사 토글 */}
              <div className="flex gap-2">
                <button onClick={() => setNewEmp(p => ({ ...p, is_active: true }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                    newEmp.is_active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600'
                  }`}>
                  재직중
                </button>
                <button onClick={() => setNewEmp(p => ({ ...p, is_active: false }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                    !newEmp.is_active ? 'bg-red-500 border-red-500 text-white' : 'bg-white border-gray-300 text-gray-600'
                  }`}>
                  퇴사자
                </button>
              </div>

              {!newEmp.is_active && (
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">퇴사일</label>
                  <input type="date" value={newEmp.end_date}
                    onChange={e => setNewEmp(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                </div>
              )}

              <div className="flex gap-3 items-end pt-1">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">연간 연차 (일)</label>
                  <input type="number" value={newEmp.vacation_allowance}
                    onChange={e => setNewEmp(p => ({ ...p, vacation_allowance: +e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer pb-2 font-medium">
                  <input type="checkbox" checked={newEmp.uses_accrual}
                    onChange={e => setNewEmp(p => ({ ...p, uses_accrual: e.target.checked }))} className="rounded" />
                  월별 적립
                </label>
                <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer pb-2 font-medium">
                  <input type="checkbox" checked={newEmp.is_exempt}
                    onChange={e => setNewEmp(p => ({ ...p, is_exempt: e.target.checked }))} className="rounded" />
                  임원
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleAddEmployee}
                disabled={!newEmp.name.trim() || !newEmp.company_id || saving}
                className="flex-1 bg-blue-600 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold transition-colors">
                추가
              </button>
              <button onClick={() => setAddModal(false)}
                className="flex-1 border-2 border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 날짜 편집 모달 */}
      {editField && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setEditField(null)}>
          <div className="bg-white rounded-2xl p-6 w-72 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-1">
              {editField === 'start_date' ? '입사일 수정' : '퇴사일 수정'}
            </h3>
            <p className="text-sm text-gray-800 font-semibold mb-3">{selected.name}</p>
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                {editField === 'start_date' ? '입사일' : '퇴사일'}
              </label>
              <input type="date" value={editValue}
                onChange={e => setEditValue(e.target.value)}
                className={`w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  editField === 'end_date' ? 'border-red-200 focus:ring-red-400' : 'border-gray-300 focus:ring-blue-400'
                }`} />
              {editField === 'start_date' && (
                <button onClick={() => setEditValue('')}
                  className="mt-1 text-xs text-gray-400 hover:text-gray-600 font-medium">날짜 제거</button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={saveDateEdit} disabled={(editField === 'end_date' && !editValue) || saving}
                className={`flex-1 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold ${
                  editField === 'end_date' ? 'bg-red-600' : 'bg-blue-600'
                }`}>
                저장
              </button>
              <button onClick={() => setEditField(null)}
                className="flex-1 border-2 border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 퇴사 처리 모달 */}
      {termModal && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setTermModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-1">퇴사 처리</h3>
            <p className="text-sm text-gray-600 mb-4">
              <strong className="text-gray-900">{selected.name}</strong>의 퇴사일을 입력하세요.
              <br /><span className="text-xs">퇴사일 이후 근태 입력이 잠기며, 이전 기록은 유지됩니다.</span>
            </p>
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">퇴사일</label>
              <input type="date" value={termDate} onChange={e => setTermDate(e.target.value)}
                className="w-full border-2 border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleTerminate} disabled={!termDate || saving}
                className="flex-1 bg-red-600 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold">
                퇴사 처리
              </button>
              <button onClick={() => setTermModal(false)}
                className="flex-1 border-2 border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
""")

# ─────────────────────────────────────────────
# app/hr/components/AttendanceGrid.tsx
# Design only: border-gray-200 -> border-gray-300, stronger contrast
# (keeping all logic from hr6 exactly the same)
# ─────────────────────────────────────────────
# Read the existing file and patch border colors
import re

grid_path = 'app/hr/components/AttendanceGrid.tsx'
if os.path.exists(grid_path):
    with open(grid_path, 'r', encoding='utf-8') as f:
        content = f.read()
    # Strengthen cell borders
    content = content.replace('border border-gray-200 w-8 h-7', 'border border-gray-300 w-8 h-7')
    content = content.replace('border border-gray-200 text-center px-1', 'border border-gray-300 text-center px-1')
    content = content.replace('border border-gray-200 text-center\n', 'border border-gray-300 text-center\n')
    content = re.sub(r'border border-gray-200 text-center(?!\s*px)', 'border border-gray-300 text-center', content)
    # Strengthen outer container
    content = content.replace('border border-gray-300 rounded-xl shadow-sm', 'border-2 border-gray-300 rounded-xl shadow-md')
    # Stronger team header
    content = content.replace('bg-slate-200 border-y border-gray-300 border-l-4 border-l-blue-500', 'bg-gray-200 border-y-2 border-gray-400 border-l-4 border-l-blue-600')
    # thead stronger
    content = content.replace('border border-gray-300 px-3 py-2 text-left text-gray-700', 'border border-gray-400 px-3 py-2 text-left text-gray-800')
    content = content.replace("border border-gray-300 w-8 text-center py-1 font-medium", "border border-gray-400 w-8 text-center py-1 font-medium")
    content = content.replace("bg-slate-100 border border-gray-300", "bg-slate-100 border border-gray-400")
    content = content.replace("bg-slate-100 border border-gray-400 px-3 py-2 text-left text-gray-800 min-w-44 font-semibold", "bg-slate-100 border border-gray-400 px-3 py-2 text-left text-gray-800 min-w-44 font-bold")
    with open(grid_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  patched: {grid_path}')
else:
    print(f'  WARNING: {grid_path} not found — run update-hr6.py first')

print('\nDone!')
print('  app/hr/page.tsx')
print('  app/hr/components/HrSummaryCards.tsx')
print('  app/hr/components/EmployeeSearch.tsx')
print('  app/hr/components/AttendanceGrid.tsx  (border patch)')
