#!/usr/bin/env python3
"""Run in Codespaces terminal: python update-hr5.py"""
import os

def write(path, content):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content.lstrip('\n'))
    print(f'  updated: {path}')

# ─────────────────────────────────────────────
# app/hr/components/AttendanceGrid.tsx
# Changes vs hr4:
#   - ⋮ menu shown for terminated employees too
#   - Terminated menu: "입사일 수정", "퇴사일 수정", "복직 처리"
#   - Active menu: "입사일 수정", "퇴사 처리"
#   - editEndEmp / editEndDate states for end_date editing
#   - reactivate() function
# ─────────────────────────────────────────────
write('app/hr/components/AttendanceGrid.tsx', """
'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type LeaveCode = 'L'|'L1'|'L2'|'L3'|'S'|'S1'|'S2'|'S3'|'W'|'T'|'B'
type Employee  = {
  id: string; name: string; team: string; manager_name: string
  vacation_allowance: number; position: string; sort_order: number
  is_exempt: boolean; uses_accrual: boolean
  start_date?: string; end_date?: string
}
type LeaveCell = { code: LeaveCode; hours?: number }
type YS        = { vacTaken: number; sick: number; wfh: number }

const CODE_COLOR: Record<string, string> = {
  L:  'bg-green-200 text-green-800',  L1: 'bg-green-100 text-green-700',
  L2: 'bg-green-100 text-green-700',  L3: 'bg-green-50  text-green-600',
  S:  'bg-red-200   text-red-800',    S1: 'bg-red-100   text-red-700',
  S2: 'bg-red-100   text-red-700',    S3: 'bg-red-50    text-red-600',
  W:  'bg-blue-200  text-blue-800',   T:  'bg-gray-200  text-gray-700',
  B:  'bg-gray-100  text-gray-500',
}

const CODE_OPTIONS: { code: LeaveCode; label: string; needsHours?: boolean }[] = [
  { code: 'L',  label: 'L  — 연차 (전일)'               },
  { code: 'L1', label: 'L1 — 오전 반일 연차'             },
  { code: 'L2', label: 'L2 — 오후 반일 연차'             },
  { code: 'L3', label: 'L3 — 시간 연차', needsHours: true },
  { code: 'S',  label: 'S  — 병가 (전일)'                },
  { code: 'S1', label: 'S1 — 오전 반일 병가'             },
  { code: 'S2', label: 'S2 — 오후 반일 병가'             },
  { code: 'S3', label: 'S3 — 시간 병가', needsHours: true },
  { code: 'W',  label: 'W  — 재택근무'                   },
  { code: 'T',  label: 'T  — Unpaid Time Off'            },
  { code: 'B',  label: 'B  — 공휴일'                     },
]

const DOW = ['일','월','화','수','목','금','토']
const TEAM_ORDER = ['Team Sales','Team Accounting','Team Operations','Department 1','Department 2','Department 3']

function calcAccrued(annual: number) {
  const today = new Date()
  const soy   = new Date(today.getFullYear(), 0, 1)
  return Math.min(((today.getTime() - soy.getTime()) / 86400000 / 365) * annual, annual)
}

function vacDisplay(emp: Employee, taken: number) {
  if (emp.is_exempt) return null
  if (emp.uses_accrual) {
    const acc  = Math.round(calcAccrued(emp.vacation_allowance) * 10) / 10
    const left = Math.max(0, Math.round((acc - taken) * 10) / 10)
    return { text: `${left}/${acc}`, alert: left <= 1 }
  }
  const left = emp.vacation_allowance - taken
  return { text: `${left}/${emp.vacation_allowance}`, alert: left <= 5 }
}

function fmtDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${+m}. ${+d}.`
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

type DateModal = { emp: Employee; field: 'start_date' | 'end_date' | 'reactivate' }

export default function AttendanceGrid({ companyId, year, month, onReactivate }: {
  companyId: string; year: number; month: number; onReactivate?: () => void
}) {
  const [employees,    setEmployees]    = useState<Employee[]>([])
  const [leaveMap,     setLeaveMap]     = useState<Record<string, LeaveCell>>({})
  const [ys,           setYS]           = useState<Record<string, YS>>({})
  const [editing,      setEditing]      = useState<{ empId: string; day: number } | null>(null)
  const [pendingCode,  setPendingCode]  = useState<LeaveCode | null>(null)
  const [pendingHours, setPendingHours] = useState('')
  const [saving,       setSaving]       = useState(false)
  const [managingEmp,  setManagingEmp]  = useState<Employee | null>(null)
  const [dateModal,    setDateModal]    = useState<DateModal | null>(null)
  const [dateValue,    setDateValue]    = useState('')
  const [addingToTeam, setAddingToTeam] = useState<string | null>(null)
  const [newEmp,       setNewEmp]       = useState({ name: '', position: '', start_date: '', vacation_allowance: 10, uses_accrual: true })
  const dropRef   = useRef<HTMLDivElement>(null)
  const manageRef = useRef<HTMLDivElement>(null)

  const daysInMonth    = new Date(year, month, 0).getDate()
  const days           = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const today          = new Date()
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1
  const pad            = (n: number) => String(n).padStart(2, '0')
  const firstDayStr    = `${year}-${pad(month)}-01`
  const lastDayStr     = `${year}-${pad(month)}-${pad(daysInMonth)}`

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current   && !dropRef.current.contains(e.target as Node))   setEditing(null)
      if (manageRef.current && !manageRef.current.contains(e.target as Node)) setManagingEmp(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { setPendingCode(null); setPendingHours('') }, [editing])
  useEffect(() => { load() }, [companyId, year, month])

  async function load() {
    const { data: emps } = await supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,position,sort_order,is_exempt,uses_accrual,start_date,end_date')
      .eq('company_id', companyId)
      .or(`is_active.eq.true,end_date.gte.${firstDayStr}`)
      .or(`start_date.is.null,start_date.lte.${lastDayStr}`)
      .order('sort_order').order('name')

    setEmployees(emps ?? [])
    if (!emps?.length) return

    const ids   = emps.map(e => e.id)
    const [{ data: me }, { data: ye }] = await Promise.all([
      supabase.from('leave_entries').select('employee_id,date,leave_code,hours')
        .in('employee_id', ids).gte('date', firstDayStr).lte('date', lastDayStr),
      supabase.from('leave_entries').select('employee_id,leave_code')
        .in('employee_id', ids).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
    ])

    const lm: Record<string, LeaveCell> = {}
    for (const e of (me ?? []))
      lm[`${e.employee_id}_${new Date(e.date).getDate()}`] = { code: e.leave_code as LeaveCode, hours: e.hours ?? undefined }
    setLeaveMap(lm)

    const ysMap: Record<string, YS> = {}
    for (const emp of emps) ysMap[emp.id] = { vacTaken: 0, sick: 0, wfh: 0 }
    for (const e of (ye ?? [])) {
      if (!ysMap[e.employee_id]) continue
      const d = ['L1','L2','S1','S2'].includes(e.leave_code) ? 0.5 : 1
      if      (['L','L1','L2','L3'].includes(e.leave_code)) ysMap[e.employee_id].vacTaken += d
      else if (['S','S1','S2','S3'].includes(e.leave_code)) ysMap[e.employee_id].sick     += d
      else if (e.leave_code === 'W')                        ysMap[e.employee_id].wfh      += 1
    }
    setYS(ysMap)
  }

  async function setCode(empId: string, day: number, code: LeaveCode | null, hours?: number) {
    setSaving(true)
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key     = `${empId}_${day}`
    if (code === null) {
      await supabase.from('leave_entries').delete().eq('employee_id', empId).eq('date', dateStr)
      setLeaveMap(p => { const n = { ...p }; delete n[key]; return n })
    } else {
      await supabase.from('leave_entries')
        .upsert({ employee_id: empId, date: dateStr, leave_code: code, hours: hours ?? null }, { onConflict: 'employee_id,date' })
      setLeaveMap(p => ({ ...p, [key]: { code, hours } }))
    }
    setSaving(false); setEditing(null); setPendingCode(null); setPendingHours('')
    load()
  }

  function openModal(emp: Employee, field: DateModal['field']) {
    setManagingEmp(null)
    if (field === 'start_date') setDateValue(emp.start_date ?? '')
    else if (field === 'end_date') setDateValue(emp.end_date ?? todayIso())
    else setDateValue('')
    setDateModal({ emp, field })
  }

  async function confirmDateModal() {
    if (!dateModal) return
    setSaving(true)
    const { emp, field } = dateModal
    if (field === 'reactivate') {
      await supabase.from('employees').update({ is_active: true, end_date: null }).eq('id', emp.id)
      onReactivate?.()
    } else {
      await supabase.from('employees').update({ [field]: dateValue || null }).eq('id', emp.id)
    }
    setDateModal(null); setDateValue('')
    setSaving(false); load()
  }

  async function handleAddEmployee() {
    if (!newEmp.name.trim() || !addingToTeam) return
    await supabase.from('employees').insert({
      company_id: companyId, name: newEmp.name.trim(), team: addingToTeam,
      position: newEmp.position || null, start_date: newEmp.start_date || null,
      vacation_allowance: newEmp.vacation_allowance, uses_accrual: newEmp.uses_accrual,
      is_active: true, sort_order: 99,
    })
    setAddingToTeam(null)
    setNewEmp({ name: '', position: '', start_date: '', vacation_allowance: 10, uses_accrual: true })
    load()
  }

  const teams = employees.reduce<Record<string, Employee[]>>((acc, e) => {
    const k = e.team || '기타'; acc[k] = [...(acc[k] ?? []), e]; return acc
  }, {})
  const sortedTeams = Object.entries(teams).sort(([a], [b]) => {
    const ai = TEAM_ORDER.indexOf(a) >= 0 ? TEAM_ORDER.indexOf(a) : 99
    const bi = TEAM_ORDER.indexOf(b) >= 0 ? TEAM_ORDER.indexOf(b) : 99
    return ai - bi || a.localeCompare(b)
  })

  return (
    <>
      <div className="overflow-x-auto border border-gray-300 rounded-xl shadow-sm">
        <table className="border-collapse text-xs min-w-full">
          <thead>
            <tr className="bg-slate-100">
              <th className="sticky left-0 z-10 bg-slate-100 border border-gray-300 px-3 py-2 text-left text-gray-700 min-w-44 font-semibold">직원</th>
              {days.map(d => {
                const dow     = new Date(year, month - 1, d).getDay()
                const isToday = isCurrentMonth && d === today.getDate()
                return (
                  <th key={d} className={`border border-gray-300 w-8 text-center py-1 font-medium
                    ${isToday ? 'bg-amber-100 text-amber-700' : dow === 0 ? 'bg-red-100/60 text-red-400' : dow === 6 ? 'bg-sky-100/60 text-sky-400' : 'text-gray-500'}`}>
                    <div className="font-semibold">{d}</div>
                    <div className="font-normal text-gray-400 text-xs">{DOW[dow]}</div>
                  </th>
                )
              })}
              <th className="border border-gray-300 px-2 py-2 text-center text-gray-700 min-w-20 whitespace-nowrap font-semibold">잔여연차</th>
              <th className="border border-gray-300 px-2 py-2 text-center text-gray-700 min-w-14 font-semibold">병가</th>
              <th className="border border-gray-300 px-2 py-2 text-center text-gray-700 min-w-12 font-semibold">재택</th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map(([team, emps]) => (
              <>
                <tr key={`th-${team}`}>
                  <td colSpan={daysInMonth + 4}
                    className="sticky left-0 bg-slate-200 border-y border-gray-300 border-l-4 border-l-blue-500 px-3 py-1.5 font-bold text-slate-700 text-xs">
                    {team}
                  </td>
                </tr>

                {emps.map((emp, idx) => {
                  const startDateObj  = emp.start_date ? new Date(emp.start_date) : null
                  const endDateObj    = emp.end_date   ? new Date(emp.end_date)   : null
                  const isUpcoming    = !!(startDateObj && startDateObj > today)
                  const isTerminated  = !!emp.end_date
                  const empYS         = ys[emp.id]
                  const vacInfo       = vacDisplay(emp, empYS?.vacTaken ?? 0)
                  const totalSick     = empYS?.sick ?? 0
                  const isManaging    = managingEmp?.id === emp.id
                  const rowBg         = isUpcoming ? 'bg-blue-50/40' : isTerminated ? 'bg-red-50/30' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'

                  return (
                    <tr key={emp.id} className={rowBg}>
                      <td className={`sticky left-0 z-10 border border-gray-200 px-3 py-1.5 group ${rowBg}`}>
                        <div className="relative flex items-center justify-between gap-1">
                          <div className="min-w-0">
                            <div className={`font-medium leading-4 ${isTerminated ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                              {emp.name}
                            </div>
                            {emp.position && <div className="text-xs text-gray-400">{emp.position}</div>}
                            {isUpcoming && emp.start_date && (
                              <div className="text-xs text-blue-400">{fmtDate(emp.start_date)} 입사예정</div>
                            )}
                            {isTerminated && emp.end_date && (
                              <div className="text-xs text-red-400">{fmtDate(emp.end_date)} 퇴사</div>
                            )}
                          </div>
                          {/* ⋮ button: shown for ALL employees (active + terminated) */}
                          <button
                            onClick={e => { e.stopPropagation(); setManagingEmp(isManaging ? null : emp) }}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 px-1 rounded text-base leading-none flex-shrink-0">
                            ⋮
                          </button>
                          {isManaging && (
                            <div ref={manageRef}
                              className="absolute right-0 top-full z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-40 py-1"
                              style={{ marginTop: 2 }}>
                              <div className="px-3 py-1.5 text-xs text-gray-500 border-b font-medium">{emp.name}</div>
                              <button onClick={e => { e.stopPropagation(); openModal(emp, 'start_date') }}
                                className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50">
                                입사일 수정{emp.start_date ? ` (${fmtDate(emp.start_date)})` : ''}
                              </button>
                              {isTerminated ? (
                                <>
                                  <button onClick={e => { e.stopPropagation(); openModal(emp, 'end_date') }}
                                    className="w-full text-left px-3 py-2 text-xs text-orange-600 hover:bg-orange-50">
                                    퇴사일 수정{emp.end_date ? ` (${fmtDate(emp.end_date)})` : ''}
                                  </button>
                                  <div className="border-t border-gray-100 my-1" />
                                  <button onClick={e => { e.stopPropagation(); openModal(emp, 'reactivate') }}
                                    className="w-full text-left px-3 py-2 text-xs text-green-600 hover:bg-green-50">
                                    복직 처리
                                  </button>
                                </>
                              ) : (
                                <>
                                  <div className="border-t border-gray-100 my-1" />
                                  <button onClick={e => { e.stopPropagation(); openModal(emp, 'end_date') }}
                                    className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                                    퇴사 처리
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {days.map(d => {
                        const entry         = leaveMap[`${emp.id}_${d}`]
                        const code          = entry?.code
                        const dow           = new Date(year, month - 1, d).getDay()
                        const isToday       = isCurrentMonth && d === today.getDate()
                        const isEdit        = editing?.empId === emp.id && editing?.day === d
                        const cellDate      = new Date(year, month - 1, d)
                        const isBeforeStart = !!(startDateObj && cellDate < startDateObj)
                        const isAfterEnd    = !!(endDateObj   && cellDate > endDateObj)
                        const blocked       = isBeforeStart || isAfterEnd
                        const cellBg        = blocked ? 'bg-gray-100'
                                            : isToday  ? 'bg-amber-50'
                                            : dow === 0 ? 'bg-red-50/50'
                                            : dow === 6 ? 'bg-sky-50/50'
                                            : ''

                        return (
                          <td key={d}
                            className={`border border-gray-200 w-8 h-7 text-center relative select-none
                              ${cellBg} ${blocked || code ? 'cursor-default' : 'hover:bg-blue-100/60 cursor-pointer'}`}
                            onClick={() => !blocked && setEditing({ empId: emp.id, day: d })}>
                            {blocked ? (
                              <span className="text-gray-300 text-xs">—</span>
                            ) : code ? (
                              <div className={`inline-flex flex-col items-center px-0.5 rounded font-medium ${CODE_COLOR[code]}`}>
                                <span className="leading-4">{code}</span>
                                {entry.hours && <span style={{ fontSize: 8 }}>{entry.hours}h</span>}
                              </div>
                            ) : null}

                            {isEdit && !blocked && (
                              <div ref={dropRef}
                                className="absolute top-full left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-44"
                                style={{ marginTop: 2 }}>
                                <button onClick={e => { e.stopPropagation(); setCode(emp.id, d, null) }}
                                  className="w-full text-left px-3 py-1 text-xs hover:bg-gray-100 text-gray-400">
                                  ✕ 비우기
                                </button>
                                <div className="border-t border-gray-100 my-1" />
                                {CODE_OPTIONS.map(opt => {
                                  if (opt.needsHours && pendingCode === opt.code) {
                                    return (
                                      <div key={opt.code} className="px-3 py-2 bg-gray-50">
                                        <div className="text-xs text-gray-600 mb-1.5">{opt.label}</div>
                                        <div className="flex gap-1 items-center">
                                          <input type="number" value={pendingHours}
                                            onChange={e => setPendingHours(e.target.value)}
                                            placeholder="예) 2" min="0.5" max="8" step="0.5" autoFocus
                                            className="w-16 border rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            onClick={e => e.stopPropagation()} />
                                          <span className="text-xs text-gray-500">시간</span>
                                          <button disabled={!pendingHours}
                                            onClick={e => { e.stopPropagation(); if (pendingHours) setCode(emp.id, d, opt.code, parseFloat(pendingHours)) }}
                                            className="bg-blue-500 disabled:bg-gray-300 text-white px-2 py-0.5 rounded text-xs ml-1">
                                            확인
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  }
                                  return (
                                    <button key={opt.code}
                                      onClick={e => {
                                        e.stopPropagation()
                                        if (opt.needsHours) { setPendingCode(opt.code); setPendingHours('') }
                                        else setCode(emp.id, d, opt.code)
                                      }}
                                      className={`w-full text-left px-3 py-1 text-xs hover:opacity-80 ${CODE_COLOR[opt.code]}`}>
                                      {opt.label}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                        )
                      })}

                      <td className="border border-gray-200 text-center px-1">
                        {isUpcoming || isTerminated ? <span className="text-xs text-gray-300">—</span>
                          : vacInfo ? <span className={`text-xs font-semibold ${vacInfo.alert ? 'text-red-600' : 'text-green-700'}`}>{vacInfo.text}</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="border border-gray-200 text-center">
                        <span className={`text-xs font-medium ${totalSick > 8 ? 'text-red-600 font-bold' : totalSick > 5 ? 'text-orange-500' : totalSick > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                          {totalSick > 0 ? totalSick : '—'}
                        </span>
                      </td>
                      <td className="border border-gray-200 text-center">
                        <span className={`text-xs ${(empYS?.wfh ?? 0) > 0 ? 'text-blue-500' : 'text-gray-300'}`}>
                          {(empYS?.wfh ?? 0) > 0 ? empYS!.wfh : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}

                <tr key={`add-${team}`}>
                  <td colSpan={daysInMonth + 4} className="border-b border-gray-200 bg-white">
                    <button onClick={() => setAddingToTeam(team)}
                      className="w-full px-4 py-1.5 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50/50 text-left transition-colors">
                      + {team}에 직원 추가
                    </button>
                  </td>
                </tr>
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* 날짜 편집 / 복직 모달 */}
      {dateModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setDateModal(null)}>
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            {dateModal.field === 'reactivate' ? (
              <>
                <h3 className="font-semibold text-gray-900 mb-1">복직 처리</h3>
                <p className="text-sm text-gray-500 mb-6">
                  <strong className="text-gray-800">{dateModal.emp.name}</strong>을(를) 복직 처리하시겠습니까?
                  <br /><span className="text-xs">퇴사일이 제거되고 재직 상태로 변경됩니다.</span>
                </p>
                <div className="flex gap-2">
                  <button onClick={confirmDateModal} disabled={saving}
                    className="flex-1 bg-green-600 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium">
                    복직 처리
                  </button>
                  <button onClick={() => setDateModal(null)}
                    className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-gray-900 mb-1">
                  {dateModal.field === 'start_date' ? '입사일 수정' : '퇴사일 수정'}
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  <strong className="text-gray-800">{dateModal.emp.name}</strong>
                  {dateModal.field === 'start_date'
                    ? <><br /><span className="text-xs">입사일 이전 날짜는 근태 입력이 잠깁니다.</span></>
                    : <><br /><span className="text-xs">퇴사일 이후 날짜는 근태 입력이 잠기며, 이전 기록은 유지됩니다.</span></>
                  }
                </p>
                <div className="mb-4">
                  <label className="text-xs text-gray-500 mb-1 block">
                    {dateModal.field === 'start_date' ? '입사일' : '퇴사일'}
                  </label>
                  <input type="date" value={dateValue}
                    onChange={e => setDateValue(e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                      dateModal.field === 'end_date' ? 'focus:ring-red-400' : 'focus:ring-blue-400'
                    }`} />
                  {dateModal.field === 'start_date' && dateValue && (
                    <button onClick={() => setDateValue('')}
                      className="mt-1 text-xs text-gray-400 hover:text-gray-600">
                      날짜 제거 (제한 없음으로)
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={confirmDateModal}
                    disabled={dateModal.field === 'end_date' && !dateValue || saving}
                    className={`flex-1 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium ${
                      dateModal.field === 'end_date' ? 'bg-red-600' : 'bg-blue-600'
                    }`}>
                    저장
                  </button>
                  <button onClick={() => setDateModal(null)}
                    className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 직원 추가 모달 */}
      {addingToTeam && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setAddingToTeam(null)}>
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">직원 추가</h3>
            <div className="text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg mb-4">{addingToTeam}</div>
            <div className="space-y-3">
              <input placeholder="이름 *" value={newEmp.name}
                onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <input placeholder="직급 (선택)" value={newEmp.position}
                onChange={e => setNewEmp(p => ({ ...p, position: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <div>
                <label className="text-xs text-gray-500 mb-1 block">입사일</label>
                <input type="date" value={newEmp.start_date}
                  onChange={e => setNewEmp(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">연간 연차 (일)</label>
                  <input type="number" value={newEmp.vacation_allowance}
                    onChange={e => setNewEmp(p => ({ ...p, vacation_allowance: +e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer pb-2">
                  <input type="checkbox" checked={newEmp.uses_accrual}
                    onChange={e => setNewEmp(p => ({ ...p, uses_accrual: e.target.checked }))} className="rounded" />
                  월별 적립
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleAddEmployee} disabled={!newEmp.name.trim()}
                className="flex-1 bg-blue-600 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium">추가</button>
              <button onClick={() => setAddingToTeam(null)}
                className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            </div>
          </div>
        </div>
      )}

      {saving && (
        <div className="fixed bottom-4 right-4 bg-gray-800 text-white text-xs px-3 py-2 rounded-lg shadow">저장 중...</div>
      )}
    </>
  )
}
""")

# ─────────────────────────────────────────────
# app/hr/[company]/page.tsx
# Changes:
#   - Terminated employees table: add "입사일" / "퇴사일" edit buttons per row
#   - Date edit modal in this page too
#   - Pass onReactivate to AttendanceGrid
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
  { code: 'L/L1/L2', label: '연차',    color: 'bg-green-100 text-green-800'  },
  { code: 'L3',       label: '시간연차', color: 'bg-green-50  text-green-600'  },
  { code: 'S/S1/S2', label: '병가',    color: 'bg-red-100   text-red-800'    },
  { code: 'W',        label: '재택',    color: 'bg-blue-100  text-blue-800'   },
  { code: 'T',        label: 'Unpaid',  color: 'bg-gray-200  text-gray-700'   },
  { code: 'B',        label: '공휴일',  color: 'bg-gray-100  text-gray-500'   },
]

type TermEmp = { id: string; name: string; team: string; position: string; start_date?: string; end_date?: string }
type DateEdit = { emp: TermEmp; field: 'start_date' | 'end_date' }

function fmtDate(iso?: string) {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${+m}. ${+d}.`
}

export default function CompanyAttendancePage() {
  const { company } = useParams() as { company: string }
  const [companyId,      setCompanyId]      = useState<string | null>(null)
  const [gridKey,        setGridKey]        = useState(0)
  const [showTerminated, setShowTerminated] = useState(false)
  const [terminated,     setTerminated]     = useState<TermEmp[]>([])
  const [dateEdit,       setDateEdit]       = useState<DateEdit | null>(null)
  const [dateValue,      setDateValue]      = useState('')
  const [saving,         setSaving]         = useState(false)
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  useEffect(() => {
    const label = COMPANY_MAP[company]
    if (!label) return
    supabase.from('companies').select('id').ilike('name', `%${label}%`).single()
      .then(({ data }) => setCompanyId(data?.id ?? null))
  }, [company])

  useEffect(() => {
    if (!showTerminated || !companyId) return
    loadTerminated()
  }, [showTerminated, companyId])

  async function loadTerminated() {
    const { data } = await supabase.from('employees')
      .select('id,name,team,position,start_date,end_date')
      .eq('company_id', companyId!).eq('is_active', false)
      .order('end_date', { ascending: false })
    setTerminated(data ?? [])
  }

  async function reactivate(empId: string) {
    await supabase.from('employees').update({ is_active: true, end_date: null }).eq('id', empId)
    setTerminated(p => p.filter(e => e.id !== empId))
    setGridKey(k => k + 1)
  }

  async function confirmDateEdit() {
    if (!dateEdit) return
    setSaving(true)
    await supabase.from('employees')
      .update({ [dateEdit.field]: dateValue || null })
      .eq('id', dateEdit.emp.id)
    setTerminated(p => p.map(e =>
      e.id === dateEdit.emp.id ? { ...e, [dateEdit.field]: dateValue || undefined } : e
    ))
    setDateEdit(null); setDateValue(''); setSaving(false)
    setGridKey(k => k + 1)
  }

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
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1) }}
            className="px-3 py-1.5 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">이번달</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {LEGEND.map(l => (
          <span key={l.code} className={`px-2 py-1 rounded text-xs font-medium ${l.color}`}>{l.code} {l.label}</span>
        ))}
      </div>

      {companyId
        ? <AttendanceGrid key={gridKey} companyId={companyId} year={year} month={month}
            onReactivate={() => { setGridKey(k => k + 1); loadTerminated() }} />
        : <div className="text-center py-16 text-gray-400">로딩 중...</div>
      }

      {/* 퇴사 직원 관리 */}
      <div className="mt-8">
        <button onClick={() => setShowTerminated(!showTerminated)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 py-2">
          <span className={`transition-transform inline-block ${showTerminated ? 'rotate-90' : ''}`}>▶</span>
          퇴사 직원 관리
          {showTerminated && terminated.length > 0 && (
            <span className="bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{terminated.length}</span>
          )}
        </button>

        {showTerminated && (
          <div className="border rounded-xl overflow-hidden mt-2">
            {terminated.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">이름</th>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">팀 / 직급</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">입사일</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">퇴사일</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {terminated.map(emp => (
                    <tr key={emp.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700 font-medium">{emp.name}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {emp.team || '—'}{emp.position ? ` · ${emp.position}` : ''}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => { setDateEdit({ emp, field: 'start_date' }); setDateValue(emp.start_date ?? '') }}
                          className="text-xs text-gray-600 hover:text-blue-600 hover:underline">
                          {fmtDate(emp.start_date)}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => { setDateEdit({ emp, field: 'end_date' }); setDateValue(emp.end_date ?? '') }}
                          className="text-xs text-red-500 hover:text-red-700 hover:underline">
                          {fmtDate(emp.end_date)}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right flex items-center justify-end gap-2">
                        <button onClick={() => reactivate(emp.id)}
                          className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50">
                          복직
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">퇴사 직원 없음</div>
            )}
          </div>
        )}
      </div>

      {/* 날짜 수정 모달 */}
      {dateEdit && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setDateEdit(null)}>
          <div className="bg-white rounded-xl p-6 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">
              {dateEdit.field === 'start_date' ? '입사일 수정' : '퇴사일 수정'}
            </h3>
            <p className="text-sm text-gray-800 font-medium mb-3">{dateEdit.emp.name}</p>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">
                {dateEdit.field === 'start_date' ? '입사일' : '퇴사일'}
              </label>
              <input type="date" value={dateValue}
                onChange={e => setDateValue(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  dateEdit.field === 'end_date' ? 'focus:ring-red-400' : 'focus:ring-blue-400'
                }`} />
            </div>
            <div className="flex gap-2">
              <button onClick={confirmDateEdit} disabled={!dateValue || saving}
                className={`flex-1 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium ${
                  dateEdit.field === 'end_date' ? 'bg-red-600' : 'bg-blue-600'
                }`}>
                저장
              </button>
              <button onClick={() => setDateEdit(null)}
                className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
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

print('\nDone!')
print('  app/hr/components/AttendanceGrid.tsx')
print('  app/hr/[company]/page.tsx')
