#!/usr/bin/env python3
"""
Codespaces 터미널에서 실행: python setup-hr.py
afs-admin 프로젝트 루트에서 실행해야 합니다.
"""
import os

def write(path, content):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content.lstrip('\n'))
    print(f'  created: {path}')

# ─────────────────────────────────────────────
# app/hr/page.tsx
# ─────────────────────────────────────────────
write('app/hr/page.tsx', """
'use client'

import Link from 'next/link'
import HrSummaryCards from './components/HrSummaryCards'
import EmployeeSearch from './components/EmployeeSearch'

export default function HrPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">HR Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/hr/afs" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            AFS 근태
          </Link>
          <Link href="/hr/tnt" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">
            TNT 근태
          </Link>
          <span className="px-4 py-2 bg-gray-200 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed">
            ZFS 준비중
          </span>
        </div>
      </div>

      <HrSummaryCards />

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">직원 검색</h2>
        <EmployeeSearch />
      </div>
    </div>
  )
}
""")

# ─────────────────────────────────────────────
# app/hr/[company]/page.tsx
# ─────────────────────────────────────────────
write('app/hr/[company]/page.tsx', """
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import AttendanceGrid from '../components/AttendanceGrid'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const COMPANY_MAP: Record<string, string> = { afs: 'AFS', tnt: 'TNT', zfs: 'ZFS' }
const MONTHS_KR = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

const LEGEND = [
  { code: 'L/L1/L2', label: '연차',   color: 'bg-green-100 text-green-800'   },
  { code: 'S/S1/S2', label: '병가',   color: 'bg-red-100 text-red-800'       },
  { code: 'W',        label: '재택',   color: 'bg-blue-100 text-blue-800'     },
  { code: 'T',        label: 'TOIL',   color: 'bg-purple-100 text-purple-800' },
  { code: 'P',        label: '육아',   color: 'bg-orange-100 text-orange-800' },
  { code: 'C',        label: '경조',   color: 'bg-yellow-100 text-yellow-800' },
  { code: 'B',        label: '공휴일', color: 'bg-gray-200 text-gray-600'     },
]

export default function CompanyAttendancePage() {
  const { company } = useParams() as { company: string }
  const [companyId, setCompanyId] = useState<string | null>(null)
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  useEffect(() => {
    const label = COMPANY_MAP[company]
    if (!label) return
    supabase.from('companies').select('id').ilike('name', `%${label}%`).single()
      .then(({ data }) => setCompanyId(data?.id ?? null))
  }, [company])

  function shiftMonth(delta: number) {
    let m = month + delta, y = year
    if (m < 1)  { m = 12; y-- }
    if (m > 12) { m = 1;  y++ }
    setMonth(m); setYear(y)
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-5">
        <Link href="/hr" className="text-sm text-gray-400 hover:text-gray-700">← HR</Link>
        <h1 className="text-2xl font-bold text-gray-900">{COMPANY_MAP[company]} 근태 관리</h1>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => shiftMonth(-1)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">◀</button>
          <span className="text-base font-semibold w-28 text-center">{year}년 {MONTHS_KR[month - 1]}</span>
          <button onClick={() => shiftMonth(1)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">▶</button>
          <button
            onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1) }}
            className="px-3 py-1.5 border rounded-lg text-sm text-blue-600 hover:bg-blue-50"
          >
            이번달
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {LEGEND.map(l => (
          <span key={l.code} className={`px-2 py-1 rounded text-xs font-medium ${l.color}`}>
            {l.code} {l.label}
          </span>
        ))}
      </div>

      {companyId
        ? <AttendanceGrid companyId={companyId} year={year} month={month} />
        : <div className="text-center py-16 text-gray-400">로딩 중...</div>
      }
    </div>
  )
}
""")

# ─────────────────────────────────────────────
# app/hr/components/HrSummaryCards.tsx
# ─────────────────────────────────────────────
write('app/hr/components/HrSummaryCards.tsx', """
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Stats = { total: number; absent: number; wfh: number; lowVac: number }

export default function HrSummaryCards() {
  const [stats,   setStats]   = useState<Stats>({ total: 0, absent: 0, wfh: 0, lowVac: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const year  = new Date().getFullYear()

      const [{ count }, { data: todayEntries }, { data: vacEntries }] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('leave_entries').select('leave_code').eq('date', today),
        supabase.from('leave_entries').select('employee_id,leave_code')
          .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
          .in('leave_code', ['L','L1','L2']),
      ])

      const absent = (todayEntries ?? []).filter(e => e.leave_code !== 'W').length
      const wfh    = (todayEntries ?? []).filter(e => e.leave_code === 'W').length

      const vacByEmp: Record<string, number> = {}
      for (const e of (vacEntries ?? [])) {
        vacByEmp[e.employee_id] = (vacByEmp[e.employee_id] ?? 0) + (['L1','L2'].includes(e.leave_code) ? 0.5 : 1)
      }
      const lowVac = Object.values(vacByEmp).filter(d => d >= 18).length

      setStats({ total: count ?? 0, absent, wfh, lowVac })
      setLoading(false)
    }
    load()
  }, [])

  const cards = [
    { label: '전체 직원',      value: stats.total,  color: 'bg-blue-50   border-blue-200   text-blue-700'   },
    { label: '오늘 부재',      value: stats.absent, color: 'bg-red-50    border-red-200    text-red-700'    },
    { label: '오늘 재택',      value: stats.wfh,    color: 'bg-purple-50 border-purple-200 text-purple-700' },
    { label: '연차 18일+ 사용', value: stats.lowVac, color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className={`border rounded-xl p-4 ${c.color}`}>
          <div className="text-sm font-medium opacity-70">{c.label}</div>
          <div className="text-3xl font-bold mt-1">
            {loading ? '…' : c.value}
            <span className="text-base font-normal ml-1">명</span>
          </div>
        </div>
      ))}
    </div>
  )
}
""")

# ─────────────────────────────────────────────
# app/hr/components/EmployeeSearch.tsx
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
  id: string; name: string; team: string
  manager_name: string; vacation_allowance: number
  companies: { name: string }
}
type Summary = { vac: number; sick: number; wfh: number; toil: number; other: number }
type Monthly = Record<number, Summary>

const MO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

function calcDays(code: string) { return ['L1','L2','S1','S2'].includes(code) ? 0.5 : 1 }

export default function EmployeeSearch() {
  const [query,      setQuery]  = useState('')
  const [compFilter, setComp]   = useState('all')
  const [employees,  setEmps]   = useState<Employee[]>([])
  const [selected,   setSel]    = useState<Employee | null>(null)
  const [summary,    setSum]    = useState<Summary | null>(null)
  const [monthly,    setMo]     = useState<Monthly>({})
  const [companies,  setComps]  = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    supabase.from('companies').select('id,name').order('name')
      .then(({ data }) => setComps(data ?? []))
  }, [])

  useEffect(() => {
    let q = supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,companies(name)')
      .eq('is_active', true).order('name')
    if (query)               q = q.ilike('name', `%${query}%`)
    if (compFilter !== 'all') q = q.eq('company_id', compFilter)
    q.then(({ data }) => setEmps((data as Employee[]) ?? []))
  }, [query, compFilter])

  async function select(emp: Employee) {
    setSel(emp)
    const year = new Date().getFullYear()
    const { data } = await supabase.from('leave_entries')
      .select('date,leave_code').eq('employee_id', emp.id)
      .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)

    const s: Summary = { vac: 0, sick: 0, wfh: 0, toil: 0, other: 0 }
    const m: Monthly = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [i + 1, { vac: 0, sick: 0, wfh: 0, toil: 0, other: 0 }])
    )

    for (const e of (data ?? [])) {
      const mo = new Date(e.date).getMonth() + 1
      const d  = calcDays(e.leave_code)
      if      (['L','L1','L2'].includes(e.leave_code)) { s.vac  += d; m[mo].vac  += d }
      else if (['S','S1','S2'].includes(e.leave_code)) { s.sick += d; m[mo].sick += d }
      else if (e.leave_code === 'W')                   { s.wfh  += 1; m[mo].wfh  += 1 }
      else if (e.leave_code === 'T')                   { s.toil += 1; m[mo].toil += 1 }
      else                                             { s.other += d; m[mo].other += d }
    }
    setSum(s); setMo(m)
  }

  return (
    <div className="flex gap-6">
      <div className="w-72 flex-shrink-0">
        <div className="flex gap-2 mb-3">
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="이름 검색..."
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <select
            value={compFilter} onChange={e => setComp(e.target.value)}
            className="border rounded-lg px-2 text-sm focus:outline-none"
          >
            <option value="all">전체</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
          {employees.map(emp => (
            <button
              key={emp.id} onClick={() => select(emp)}
              className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-gray-50 transition-colors ${selected?.id === emp.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
            >
              <div className="text-sm font-medium text-gray-900">{emp.name}</div>
              <div className="text-xs text-gray-400">{(emp.companies as any)?.name} · {emp.team}</div>
            </button>
          ))}
          {!employees.length && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">검색 결과 없음</div>
          )}
        </div>
      </div>

      {selected && summary ? (
        <div className="flex-1 min-w-0">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-gray-900">{selected.name}</h3>
            <p className="text-sm text-gray-500">
              {(selected.companies as any)?.name} · {selected.team} · 매니저: {selected.manager_name}
            </p>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
            {[
              { label: '연차 사용', val: summary.vac, extra: `/${selected.vacation_allowance}일`, color: 'bg-green-50 text-green-700' },
              { label: '연차 잔여', val: selected.vacation_allowance - summary.vac, extra: '일', color: 'bg-green-100 text-green-800 font-bold' },
              { label: '병가',     val: summary.sick,  extra: '일', color: 'bg-red-50    text-red-700'    },
              { label: '재택',     val: summary.wfh,   extra: '일', color: 'bg-blue-50   text-blue-700'   },
              { label: 'TOIL',    val: summary.toil,  extra: '일', color: 'bg-purple-50 text-purple-700' },
              { label: '기타',     val: summary.other, extra: '일', color: 'bg-gray-50   text-gray-600'   },
            ].map(c => (
              <div key={c.label} className={`rounded-xl p-3 ${c.color}`}>
                <div className="text-xs opacity-70 mb-1">{c.label}</div>
                <div className="text-xl font-bold">{c.val}<span className="text-xs font-normal">{c.extra}</span></div>
              </div>
            ))}
          </div>

          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 text-gray-500 w-14">타입</th>
                  {MO.map(m => <th key={m} className="text-center px-1 py-2 text-gray-500 min-w-8">{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {([
                  { key: 'vac',  label: '연차', color: 'text-green-700'  },
                  { key: 'sick', label: '병가', color: 'text-red-600'    },
                  { key: 'wfh',  label: '재택', color: 'text-blue-600'   },
                  { key: 'toil', label: 'TOIL', color: 'text-purple-600' },
                ] as const).map(row => (
                  <tr key={row.key} className="border-t">
                    <td className="px-3 py-1.5 text-gray-500">{row.label}</td>
                    {Array.from({ length: 12 }, (_, i) => {
                      const v = monthly[i + 1]?.[row.key] ?? 0
                      return (
                        <td key={i} className={`text-center py-1.5 ${v > 0 ? row.color : 'text-gray-200'}`}>
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
      ) : (
        <div className="flex-1 flex items-center justify-center border rounded-xl text-gray-400 text-sm min-h-48">
          좌측에서 직원을 선택하세요
        </div>
      )}
    </div>
  )
}
""")

# ─────────────────────────────────────────────
# app/hr/components/AttendanceGrid.tsx
# ─────────────────────────────────────────────
write('app/hr/components/AttendanceGrid.tsx', """
'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type LeaveCode = 'L'|'L1'|'L2'|'S'|'S1'|'S2'|'P'|'C'|'T'|'W'|'B'
type Employee  = { id: string; name: string; team: string; manager_name: string; vacation_allowance: number }
type YS        = { vacTaken: number; vacLeft: number; sick: number; wfh: number }

const CODE_COLOR: Record<string, string> = {
  L:  'bg-green-200 text-green-800',  L1: 'bg-green-100 text-green-700',  L2: 'bg-green-100 text-green-700',
  S:  'bg-red-200   text-red-800',    S1: 'bg-red-100   text-red-700',    S2: 'bg-red-100   text-red-700',
  W:  'bg-blue-200  text-blue-800',   T:  'bg-purple-200 text-purple-800',
  P:  'bg-orange-200 text-orange-800',C:  'bg-yellow-200 text-yellow-800', B:  'bg-gray-200 text-gray-500',
}

const CODE_OPTIONS: { code: LeaveCode; label: string }[] = [
  { code: 'L',  label: 'L  — 연차'       }, { code: 'L1', label: 'L1 — 오전 반차' }, { code: 'L2', label: 'L2 — 오후 반차' },
  { code: 'S',  label: 'S  — 병가'       }, { code: 'S1', label: 'S1 — 오전 병가' }, { code: 'S2', label: 'S2 — 오후 병가' },
  { code: 'W',  label: 'W  — 재택'       }, { code: 'T',  label: 'T  — TOIL'       },
  { code: 'P',  label: 'P  — 육아휴가'   }, { code: 'C',  label: 'C  — 경조휴가'   }, { code: 'B',  label: 'B  — 공휴일'   },
]

const DOW = ['일','월','화','수','목','금','토']

export default function AttendanceGrid({ companyId, year, month }: { companyId: string; year: number; month: number }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [leaveMap,  setLeaveMap]  = useState<Record<string, LeaveCode>>({})
  const [ys,        setYS]        = useState<Record<string, YS>>({})
  const [editing,   setEditing]   = useState<{ empId: string; day: number } | null>(null)
  const [saving,    setSaving]    = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const daysInMonth = new Date(year, month, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setEditing(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => { load() }, [companyId, year, month])

  async function load() {
    const { data: emps } = await supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance')
      .eq('company_id', companyId).eq('is_active', true).order('team').order('name')
    setEmployees(emps ?? [])
    if (!emps?.length) return

    const ids  = emps.map(e => e.id)
    const pad  = (n: number) => String(n).padStart(2, '0')
    const start = `${year}-${pad(month)}-01`
    const end   = `${year}-${pad(month)}-${pad(daysInMonth)}`

    const [{ data: monthEntries }, { data: yearEntries }] = await Promise.all([
      supabase.from('leave_entries').select('employee_id,date,leave_code')
        .in('employee_id', ids).gte('date', start).lte('date', end),
      supabase.from('leave_entries').select('employee_id,leave_code')
        .in('employee_id', ids).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
    ])

    const lm: Record<string, LeaveCode> = {}
    for (const e of (monthEntries ?? []))
      lm[`${e.employee_id}_${new Date(e.date).getDate()}`] = e.leave_code as LeaveCode
    setLeaveMap(lm)

    const ysMap: Record<string, YS> = {}
    for (const emp of emps) ysMap[emp.id] = { vacTaken: 0, vacLeft: emp.vacation_allowance, sick: 0, wfh: 0 }
    for (const e of (yearEntries ?? [])) {
      if (!ysMap[e.employee_id]) continue
      const d = ['L1','L2','S1','S2'].includes(e.leave_code) ? 0.5 : 1
      if      (['L','L1','L2'].includes(e.leave_code)) { ysMap[e.employee_id].vacTaken += d; ysMap[e.employee_id].vacLeft -= d }
      else if (['S','S1','S2'].includes(e.leave_code)) { ysMap[e.employee_id].sick += d }
      else if (e.leave_code === 'W')                   { ysMap[e.employee_id].wfh  += 1 }
    }
    setYS(ysMap)
  }

  async function setCode(empId: string, day: number, code: LeaveCode | null) {
    setSaving(true)
    const pad    = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key     = `${empId}_${day}`

    if (code === null) {
      await supabase.from('leave_entries').delete().eq('employee_id', empId).eq('date', dateStr)
      setLeaveMap(p => { const n = { ...p }; delete n[key]; return n })
    } else {
      await supabase.from('leave_entries')
        .upsert({ employee_id: empId, date: dateStr, leave_code: code }, { onConflict: 'employee_id,date' })
      setLeaveMap(p => ({ ...p, [key]: code }))
    }
    setSaving(false)
    setEditing(null)
    load()
  }

  const teams = employees.reduce<Record<string, Employee[]>>((acc, e) => {
    const k = e.team || '기타'
    acc[k] = [...(acc[k] ?? []), e]
    return acc
  }, {})

  return (
    <div className="overflow-x-auto border rounded-xl">
      <table className="border-collapse text-xs min-w-full">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 z-10 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-gray-600 min-w-36">
              직원
            </th>
            {days.map(d => {
              const dow = new Date(year, month - 1, d).getDay()
              return (
                <th key={d} className={`border-b border-gray-200 w-8 text-center py-1 font-medium
                  ${dow === 0 ? 'bg-red-50 text-red-400' : dow === 6 ? 'bg-sky-50 text-sky-400' : 'text-gray-500'}`}>
                  <div>{d}</div>
                  <div className="font-normal text-gray-400">{DOW[dow]}</div>
                </th>
              )
            })}
            <th className="border-b border-gray-200 px-2 py-2 text-center text-gray-600 min-w-20 whitespace-nowrap">잔여연차</th>
            <th className="border-b border-gray-200 px-2 py-2 text-center text-gray-600 min-w-12">병가</th>
            <th className="border-b border-gray-200 px-2 py-2 text-center text-gray-600 min-w-12">재택</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(teams).map(([team, emps]) => (
            <>
              <tr key={`t-${team}`}>
                <td colSpan={daysInMonth + 4}
                  className="sticky left-0 bg-gray-100 border-y border-gray-200 px-3 py-1 font-semibold text-gray-600 text-xs">
                  {team}
                </td>
              </tr>
              {emps.map(emp => {
                const empYS = ys[emp.id]
                return (
                  <tr key={emp.id} className="hover:bg-gray-50/50">
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap">
                      {emp.name}
                    </td>
                    {days.map(d => {
                      const code    = leaveMap[`${emp.id}_${d}`]
                      const dow     = new Date(year, month - 1, d).getDay()
                      const weekend = dow === 0 || dow === 6
                      const isEdit  = editing?.empId === emp.id && editing?.day === d
                      return (
                        <td key={d}
                          className={`border-b border-gray-100 w-8 h-7 text-center relative cursor-pointer select-none
                            ${weekend ? 'bg-gray-50' : ''} ${!weekend && !code ? 'hover:bg-blue-50' : ''}`}
                          onClick={() => setEditing({ empId: emp.id, day: d })}
                        >
                          {code && (
                            <span className={`inline-block px-0.5 rounded font-medium leading-5 ${CODE_COLOR[code]}`}>
                              {code}
                            </span>
                          )}
                          {isEdit && (
                            <div ref={dropRef}
                              className="absolute top-full left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-40"
                              style={{ marginTop: 2 }}>
                              <button
                                onClick={e => { e.stopPropagation(); setCode(emp.id, d, null) }}
                                className="w-full text-left px-3 py-1 text-xs hover:bg-gray-100 text-gray-400"
                              >
                                ✕ 비우기
                              </button>
                              <div className="border-t border-gray-100 my-1" />
                              {CODE_OPTIONS.map(opt => (
                                <button key={opt.code}
                                  onClick={e => { e.stopPropagation(); setCode(emp.id, d, opt.code) }}
                                  className={`w-full text-left px-3 py-1 text-xs hover:opacity-80 ${CODE_COLOR[opt.code]}`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="border-b border-gray-100 text-center">
                      {empYS ? (
                        <span className={`text-xs font-semibold ${empYS.vacLeft <= 5 ? 'text-red-600' : 'text-green-700'}`}>
                          {empYS.vacLeft}/{emp.vacation_allowance}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="border-b border-gray-100 text-center text-xs text-red-500">{empYS?.sick  ?? '—'}</td>
                    <td className="border-b border-gray-100 text-center text-xs text-blue-500">{empYS?.wfh   ?? '—'}</td>
                  </tr>
                )
              })}
            </>
          ))}
        </tbody>
      </table>
      {saving && (
        <div className="fixed bottom-4 right-4 bg-gray-800 text-white text-xs px-3 py-2 rounded-lg shadow">
          저장 중...
        </div>
      )}
    </div>
  )
}
""")

print('\nDone! Created 5 files:')
print('  app/hr/page.tsx')
print('  app/hr/[company]/page.tsx')
print('  app/hr/components/HrSummaryCards.tsx')
print('  app/hr/components/EmployeeSearch.tsx')
print('  app/hr/components/AttendanceGrid.tsx')
print('\nNext: npm run dev 로 확인')
