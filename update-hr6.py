#!/usr/bin/env python3
"""Run in Codespaces terminal: python update-hr6.py"""
import os

def write(path, content):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content.lstrip('\n'))
    print(f'  updated: {path}')

# ─────────────────────────────────────────────
# app/hr/components/AttendanceGrid.tsx
# Fix: render ⋮ dropdown as position:fixed outside scroll container
#      so it never gets clipped by overflow-x:auto
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
  const [, m, d] = iso.split('-'); return `${+m}. ${+d}.`
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
  // ⋮ menu — rendered as fixed overlay to avoid overflow clipping
  const [managingEmp,  setManagingEmp]  = useState<Employee | null>(null)
  const [menuPos,      setMenuPos]      = useState<{ top: number; left: number } | null>(null)
  const [dateModal,    setDateModal]    = useState<DateModal | null>(null)
  const [dateValue,    setDateValue]    = useState('')
  const [addingToTeam, setAddingToTeam] = useState<string | null>(null)
  const [newEmp,       setNewEmp]       = useState({ name: '', position: '', start_date: '', vacation_allowance: 10, uses_accrual: true })
  const dropRef  = useRef<HTMLDivElement>(null)
  const menuRef  = useRef<HTMLDivElement>(null)

  const daysInMonth    = new Date(year, month, 0).getDate()
  const days           = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const today          = new Date()
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1
  const pad            = (n: number) => String(n).padStart(2, '0')
  const firstDayStr    = `${year}-${pad(month)}-01`
  const lastDayStr     = `${year}-${pad(month)}-${pad(daysInMonth)}`

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setEditing(null)
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setManagingEmp(null); setMenuPos(null)
      }
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

    const ids = emps.map(e => e.id)
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

  function openManageMenu(e: React.MouseEvent, emp: Employee) {
    e.stopPropagation()
    if (managingEmp?.id === emp.id) { setManagingEmp(null); setMenuPos(null); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Position dropdown below button, aligned to right edge; clamp so it doesn't go off-screen
    const left = Math.min(rect.right - 168, window.innerWidth - 176)
    setMenuPos({ top: rect.bottom + 4, left: Math.max(4, left) })
    setManagingEmp(emp)
  }

  function openDateModal(field: DateModal['field']) {
    if (!managingEmp) return
    setManagingEmp(null); setMenuPos(null)
    if (field === 'start_date') setDateValue(managingEmp.start_date ?? '')
    else if (field === 'end_date') setDateValue(managingEmp.end_date ?? todayIso())
    else setDateValue('')
    setDateModal({ emp: managingEmp, field })
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
    setDateModal(null); setDateValue(''); setSaving(false); load()
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
                  const rowBg         = isUpcoming ? 'bg-blue-50/40' : isTerminated ? 'bg-red-50/30' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'

                  return (
                    <tr key={emp.id} className={rowBg}>
                      <td className={`sticky left-0 z-10 border border-gray-200 px-3 py-1.5 group ${rowBg}`}>
                        <div className="flex items-center justify-between gap-1">
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
                          {/* ⋮ — always shown on hover, for all employees */}
                          <button
                            onClick={e => openManageMenu(e, emp)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 px-1 rounded text-base leading-none flex-shrink-0">
                            ⋮
                          </button>
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
                                            : dow === 6 ? 'bg-sky-50/50' : ''

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

      {/* ⋮ dropdown — fixed overlay, never clipped */}
      {managingEmp && menuPos && (
        <div ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl min-w-44 py-1">
          <div className="px-3 py-1.5 text-xs text-gray-500 border-b font-medium">{managingEmp.name}</div>
          <button onClick={() => openDateModal('start_date')}
            className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50">
            입사일 수정{managingEmp.start_date ? ` (${fmtDate(managingEmp.start_date)})` : ''}
          </button>
          {managingEmp.end_date ? (
            <>
              <button onClick={() => openDateModal('end_date')}
                className="w-full text-left px-3 py-2 text-xs text-orange-600 hover:bg-orange-50">
                퇴사일 수정 ({fmtDate(managingEmp.end_date)})
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={() => openDateModal('reactivate')}
                className="w-full text-left px-3 py-2 text-xs text-green-600 hover:bg-green-50">
                복직 처리
              </button>
            </>
          ) : (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={() => openDateModal('end_date')}
                className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                퇴사 처리
              </button>
            </>
          )}
        </div>
      )}

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
                <p className="text-sm text-gray-800 font-medium mb-1">{dateModal.emp.name}</p>
                <p className="text-xs text-gray-400 mb-4">
                  {dateModal.field === 'start_date'
                    ? '입사일 이전 날짜는 근태 입력이 잠깁니다.'
                    : '퇴사일 이후 날짜는 근태 입력이 잠기며, 이전 기록은 유지됩니다.'}
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
                  {dateModal.field === 'start_date' && (
                    <button onClick={() => setDateValue('')}
                      className="mt-1 text-xs text-gray-400 hover:text-gray-600">
                      날짜 제거 (입사일 제한 없음)
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={confirmDateModal}
                    disabled={(dateModal.field === 'end_date' && !dateValue) || saving}
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
# app/hr/components/EmployeeSearch.tsx
# Add: start_date + end_date display & editing in detail panel
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

export default function EmployeeSearch() {
  const [query,        setQuery]        = useState('')
  const [compFilter,   setComp]         = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [employees,    setEmps]         = useState<Employee[]>([])
  const [selected,     setSel]          = useState<Employee | null>(null)
  const [summary,      setSum]          = useState<Summary | null>(null)
  const [monthly,      setMo]           = useState<Monthly>({})
  const [companies,    setComps]        = useState<{ id: string; name: string }[]>([])
  // date editing
  const [editField,    setEditField]    = useState<DateField | null>(null)
  const [editValue,    setEditValue]    = useState('')
  const [saving,       setSaving]       = useState(false)
  // terminate flow
  const [termModal,    setTermModal]    = useState(false)
  const [termDate,     setTermDate]     = useState('')

  useEffect(() => {
    supabase.from('companies').select('id,name').order('name')
      .then(({ data }) => setComps(data ?? []))
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
      <h2 className="text-lg font-semibold text-gray-900 mb-4">직원 검색</h2>

      <div className="flex gap-2 mb-3">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름 검색..."
          className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <select value={compFilter} onChange={e => setComp(e.target.value)}
          className="border rounded-lg px-2 text-sm focus:outline-none">
          <option value="all">전체</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="flex gap-2 mb-3">
        <button onClick={() => setShowInactive(false)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${!showInactive ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
          재직중
        </button>
        <button onClick={() => setShowInactive(true)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${showInactive ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:bg-gray-100'}`}>
          퇴사자
        </button>
      </div>

      <div className="flex gap-6">
        <div className="w-72 flex-shrink-0 border rounded-lg overflow-hidden max-h-[480px] overflow-y-auto">
          {employees.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              {showInactive ? '퇴사 직원 없음' : '검색 결과 없음'}
            </div>
          ) : employees.map(emp => (
            <button key={emp.id} onClick={() => select(emp)}
              className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-gray-50 transition-colors
                ${selected?.id === emp.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{emp.name}</span>
                {emp.is_exempt && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">임원</span>}
                {emp.is_active && emp.start_date && new Date(emp.start_date) > new Date() && (
                  <span className="text-xs bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded">입사예정</span>
                )}
              </div>
              <div className="text-xs text-gray-400">{(emp.companies as any)?.name} · {emp.position || emp.team}</div>
              {emp.end_date && <div className="text-xs text-red-400 mt-0.5">{emp.end_date} 퇴사</div>}
            </button>
          ))}
        </div>

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
                    <h3 className="text-lg font-bold text-gray-900">{selected.name}</h3>
                    {selected.position && (
                      <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{selected.position}</span>
                    )}
                    {!selected.is_active && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium">퇴사</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {(selected.companies as any)?.name} · {selected.team} · {selected.manager_name || '매니저 없음'}
                  </p>

                  {/* 입사일 / 퇴사일 — 클릭하면 편집 */}
                  <div className="flex gap-4 mt-2">
                    <button
                      onClick={() => { setEditField('start_date'); setEditValue(selected.start_date ?? '') }}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 group">
                      <span className="text-gray-400">입사일</span>
                      <span className={`font-medium ${selected.start_date ? 'text-gray-700' : 'text-gray-300'}`}>
                        {fmtDateLong(selected.start_date) ?? '미설정'}
                      </span>
                      <span className="text-gray-300 group-hover:text-blue-400 ml-0.5">✎</span>
                    </button>
                    {!selected.is_active && (
                      <button
                        onClick={() => { setEditField('end_date'); setEditValue(selected.end_date ?? todayIso()) }}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 group">
                        <span className="text-gray-400">퇴사일</span>
                        <span className={`font-medium ${selected.end_date ? 'text-red-500' : 'text-gray-300'}`}>
                          {fmtDateLong(selected.end_date) ?? '미설정'}
                        </span>
                        <span className="text-gray-300 group-hover:text-red-400 ml-0.5">✎</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 ml-4">
                  {selected.is_active ? (
                    <button onClick={() => { setTermDate(todayIso()); setTermModal(true) }}
                      className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                      퇴사 처리
                    </button>
                  ) : (
                    <button onClick={handleReactivate} disabled={saving}
                      className="px-3 py-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50">
                      복직 처리
                    </button>
                  )}
                </div>
              </div>

              {/* 연차 */}
              {vacStats ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
                  <div className="text-sm font-semibold text-green-800 mb-2">연차 현황</div>
                  <div className="flex gap-6 text-sm">
                    {vacStats.isAccrual && (
                      <div>
                        <span className="text-green-600 font-medium">현재 적립</span>
                        <span className="ml-2 text-green-800 font-bold">{vacStats.accrued}일</span>
                        <span className="text-green-500 text-xs ml-1">/ 연 {vacStats.annual}일</span>
                      </div>
                    )}
                    <div>
                      <span className="text-green-600 font-medium">사용</span>
                      <span className="ml-2 text-green-800 font-bold">{summary.vac}일</span>
                    </div>
                    <div>
                      <span className={`font-medium ${vacStats.remaining <= 1 ? 'text-red-500' : 'text-green-600'}`}>잔여</span>
                      <span className={`ml-2 font-bold ${vacStats.remaining <= 1 ? 'text-red-600' : 'text-green-800'}`}>{vacStats.remaining}일</span>
                    </div>
                  </div>
                  {vacStats.isAccrual && (
                    <div className="text-xs text-green-500 mt-1">매월 {(vacStats.annual/12).toFixed(2)}일 적립 · 사전 사용 불가</div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 text-sm text-gray-400">임원 — 연차 별도 카운트 없음</div>
              )}

              {/* 병가 */}
              <div className={`border rounded-xl p-4 mb-4 ${sickAlert ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-sm font-semibold mb-2 ${sickAlert ? 'text-red-700' : 'text-gray-700'}`}>병가 현황</div>
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="text-gray-500 font-medium">유급 사용</span>
                    <span className={`ml-2 font-bold ${paidSick >= 5 ? 'text-orange-600' : 'text-gray-800'}`}>{paidSick}/5일</span>
                  </div>
                  {unpaidSick > 0 && (
                    <div>
                      <span className="text-gray-500 font-medium">무급 사용</span>
                      <span className={`ml-2 font-bold ${unpaidSick > 3 ? 'text-red-600' : 'text-orange-500'}`}>{unpaidSick}/3일</span>
                    </div>
                  )}
                </div>
                {sickAlert && <div className="text-xs text-red-500 mt-1 font-medium">⚠ 무급 한도 초과 — 회사와 협의 필요</div>}
                {!sickAlert && summary.sick >= 5 && <div className="text-xs text-orange-500 mt-1">유급 한도 소진 — 이후 무급 처리</div>}
              </div>

              {/* 기타 */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: '재택',   val: summary.wfh,   color: 'bg-blue-50  text-blue-700' },
                  { label: 'Unpaid', val: summary.toil,  color: 'bg-gray-50  text-gray-600' },
                  { label: '기타',   val: summary.other, color: 'bg-gray-50  text-gray-500' },
                ].map(c => (
                  <div key={c.label} className={`rounded-xl p-3 ${c.color}`}>
                    <div className="text-xs opacity-70 mb-1">{c.label}</div>
                    <div className="text-xl font-bold">{c.val}<span className="text-xs font-normal ml-1">일</span></div>
                  </div>
                ))}
              </div>

              {/* 월별 */}
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
                      { key: 'vac',  label: '연차',   color: 'text-green-700' },
                      { key: 'sick', label: '병가',   color: 'text-red-600'   },
                      { key: 'wfh',  label: '재택',   color: 'text-blue-600'  },
                      { key: 'toil', label: 'Unpaid', color: 'text-gray-500'  },
                    ] as const).map(row => (
                      <tr key={row.key} className="border-t">
                        <td className="px-3 py-1.5 text-gray-500">{row.label}</td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const v = monthly[i+1]?.[row.key] ?? 0
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
          )
        })() : (
          <div className="flex-1 flex items-center justify-center border rounded-xl text-gray-400 text-sm min-h-48">
            좌측에서 직원을 선택하세요
          </div>
        )}
      </div>

      {/* 날짜 편집 모달 */}
      {editField && selected && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setEditField(null)}>
          <div className="bg-white rounded-xl p-6 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">
              {editField === 'start_date' ? '입사일 수정' : '퇴사일 수정'}
            </h3>
            <p className="text-sm text-gray-800 font-medium mb-3">{selected.name}</p>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">
                {editField === 'start_date' ? '입사일' : '퇴사일'}
              </label>
              <input type="date" value={editValue}
                onChange={e => setEditValue(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  editField === 'end_date' ? 'focus:ring-red-400' : 'focus:ring-blue-400'
                }`} />
              {editField === 'start_date' && (
                <button onClick={() => setEditValue('')}
                  className="mt-1 text-xs text-gray-400 hover:text-gray-600">날짜 제거</button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={saveDateEdit} disabled={(editField === 'end_date' && !editValue) || saving}
                className={`flex-1 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium ${
                  editField === 'end_date' ? 'bg-red-600' : 'bg-blue-600'
                }`}>
                저장
              </button>
              <button onClick={() => setEditField(null)}
                className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 퇴사 처리 모달 */}
      {termModal && selected && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setTermModal(false)}>
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">퇴사 처리</h3>
            <p className="text-sm text-gray-500 mb-4">
              <strong className="text-gray-800">{selected.name}</strong>의 퇴사일을 입력하세요.
              <br /><span className="text-xs">퇴사일 이후 근태 입력이 잠기며, 이전 기록은 유지됩니다.</span>
            </p>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">퇴사일</label>
              <input type="date" value={termDate} onChange={e => setTermDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleTerminate} disabled={!termDate || saving}
                className="flex-1 bg-red-600 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium">
                퇴사 처리
              </button>
              <button onClick={() => setTermModal(false)}
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
print('  app/hr/components/EmployeeSearch.tsx')
