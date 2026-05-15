'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type LeaveCode = 'L'|'L1'|'L2'|'L3'|'S'|'S1'|'S2'|'S3'|'W'|'T'|'T1'|'T2'|'T3'|'B'
type Employee  = {
  id: string; name: string; team: string; manager_name: string
  vacation_allowance: number; position: string | null; sort_order: number
  is_exempt: boolean; uses_accrual: boolean
  start_date?: string; end_date?: string
  probation_start?: string; probation_end?: string
}
type LeaveCell = { code: LeaveCode; hours?: number }
type YS        = { vacTaken: number; sick: number; wfh: number }

const CODE_COLOR: Record<string, string> = {
  L:  'bg-green-200 text-green-800',  L1: 'bg-green-100 text-green-700',
  L2: 'bg-green-100 text-green-700',  L3: 'bg-green-50  text-green-600',
  S:  'bg-red-200   text-red-800',    S1: 'bg-red-100   text-red-700',
  S2: 'bg-red-100   text-red-700',    S3: 'bg-red-50    text-red-600',
  W:  'bg-blue-200  text-blue-800',   T:  'bg-gray-200  text-gray-700',
  T1: 'bg-gray-100  text-gray-600',   T2: 'bg-gray-100  text-gray-600',
  T3: 'bg-gray-50   text-gray-500',   B:  'bg-gray-100  text-gray-500',
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
  { code: 'T',  label: 'T  — Unpaid 전일'                },
  { code: 'T1', label: 'T1 — Unpaid 오전 반일'           },
  { code: 'T2', label: 'T2 — Unpaid 오후 반일'           },
  { code: 'T3', label: 'T3 — Unpaid 시간', needsHours: true },
  { code: 'B',  label: 'B  — 공휴일'                     },
]

const DOW = ['일','월','화','수','목','금','토']
const TEAM_ORDER = ['Team Sales','Team Accounting','Team Operations','Department 1','Department 2','Department 3']

// refDate: 뷰 월 말일 기준으로 적립 계산 (미래 월이면 오늘로 클램프)
function calcAccrued(emp: Employee, refYear: number, refMonth: number): number {
  const today    = new Date()
  const monthEnd = new Date(refYear, refMonth, 0)
  const calcTo   = monthEnd < today ? monthEnd : today
  // 입사 전 연도면 적립 없음
  if (emp.start_date && new Date(emp.start_date) > calcTo) return 0
  if (emp.probation_end) {
    const pe = new Date(emp.probation_end)
    if (pe > calcTo) return 0
    const accrualStart = pe.getFullYear() < refYear ? new Date(refYear, 0, 1) : pe
    return Math.min(((calcTo.getTime() - accrualStart.getTime()) / 86400000 / 365) * emp.vacation_allowance, emp.vacation_allowance)
  }
  const soy          = new Date(refYear, 0, 1)
  const accrualStart = emp.start_date && new Date(emp.start_date) > soy ? new Date(emp.start_date) : soy
  return Math.min(((calcTo.getTime() - accrualStart.getTime()) / 86400000 / 365) * emp.vacation_allowance, emp.vacation_allowance)
}
function vacDisplay(emp: Employee, taken: number, year: number, month: number, carryover: number) {
  if (emp.is_exempt) return null
  if (emp.uses_accrual) {
    const acc  = Math.round((calcAccrued(emp, year, month) + carryover) * 10) / 10
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

// Returns the date from which vacation accrual should be counted.
// If the employee is still in probation for the given year/month, returns null (= 0 accrual).
// If probation has ended, returns probation_end. Otherwise returns start_date.
function effectiveAccrualStart(
  emp: { uses_accrual: boolean; is_exempt: boolean; start_date: string | null; probation_end: string | null },
  year: number, month: number
): string | null {
  if (emp.is_exempt || !emp.uses_accrual) return emp.start_date
  if (emp.probation_end) {
    const [py, pm] = emp.probation_end.split('-').map(Number)
    if (year < py || (year === py && month <= pm)) return null // still in probation
    return emp.probation_end
  }
  return emp.start_date
}

export default function AttendanceGrid({ companyId, year, month, onReactivate }: {
  companyId: string; year: number; month: number; onReactivate?: () => void
}) {
  const [employees,    setEmployees]    = useState<Employee[]>([])
  const [leaveMap,     setLeaveMap]     = useState<Record<string, LeaveCell>>({})
  const [ys,           setYS]           = useState<Record<string, YS>>({})
  const [carryovers,   setCarryovers]   = useState<Record<string, number>>({})
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
  const [posModal,      setPosModal]      = useState<{ emp: Employee } | null>(null)
  const [posValue,      setPosValue]      = useState('')
  const [probModal,     setProbModal]     = useState<{ emp: Employee } | null>(null)
  const [probStartMode, setProbStartMode] = useState<'hire' | 'custom'>('hire')
  const [probStartVal,  setProbStartVal]  = useState('')
  const [probEndMode,   setProbEndMode]   = useState<'90d' | 'custom'>('90d')
  const [probEndVal,    setProbEndVal]    = useState('')
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
    const baseQ = () => supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,position,sort_order,is_exempt,uses_accrual,start_date,end_date,probation_start,probation_end')
      .eq('company_id', companyId)
      .or(`is_active.eq.true,end_date.gte.${firstDayStr}`)
      .or(`start_date.is.null,start_date.lte.${lastDayStr}`)
      .order('sort_order').order('name')

    // employment_type 컬럼이 없으면(migration 미실행) 필터 없이 폴백
    let { data: emps, error: empErr } = await baseQ()
      .or('employment_type.eq.office,employment_type.is.null')
    if (empErr) {
      ;({ data: emps } = await baseQ())
    }

    setEmployees(emps ?? [])
    if (!emps?.length) return

    const ids = emps.map(e => e.id)
    const [{ data: me }, { data: ye }, { data: prevYe }] = await Promise.all([
      supabase.from('leave_entries').select('employee_id,date,leave_code,hours')
        .in('employee_id', ids).gte('date', firstDayStr).lte('date', lastDayStr),
      supabase.from('leave_entries').select('employee_id,leave_code')
        .in('employee_id', ids).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
      supabase.from('leave_entries').select('employee_id,leave_code')
        .in('employee_id', ids).gte('date', `${year-1}-01-01`).lte('date', `${year-1}-12-31`),
    ])

    const lm: Record<string, LeaveCell> = {}
    for (const e of (me ?? []))
      lm[`${e.employee_id}_${parseInt(e.date.split('-')[2], 10)}`] = { code: e.leave_code as LeaveCode, hours: e.hours ?? undefined }
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

    // 전년도 연차 사용량 → 이월 계산 (최대 5일)
    const prevVac: Record<string, number> = {}
    for (const emp of emps) prevVac[emp.id] = 0
    for (const e of (prevYe ?? [])) {
      if (!(e.employee_id in prevVac)) continue
      if (['L','L1','L2','L3'].includes(e.leave_code))
        prevVac[e.employee_id] += ['L1','L2'].includes(e.leave_code) ? 0.5 : 1
    }
    const coMap: Record<string, number> = {}
    for (const emp of emps) {
      const prevAccrued = calcAccrued(emp, year - 1, 12)
      coMap[emp.id] = Math.min(5, Math.max(0, prevAccrued - prevVac[emp.id]))
    }
    setCarryovers(coMap)
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
      <div className="overflow-x-auto border-2 border-gray-300 rounded-xl shadow-md">
        <table className="border-collapse text-xs min-w-full">
          <thead>
            <tr className="bg-slate-100">
              <th className="sticky left-0 z-10 bg-slate-100 border border-gray-400 px-3 py-2 text-left text-gray-800 min-w-44 font-bold">직원</th>
              {days.map(d => {
                const dow     = new Date(year, month - 1, d).getDay()
                const isToday = isCurrentMonth && d === today.getDate()
                return (
                  <th key={d} className={`border border-gray-400 w-8 text-center py-1 font-medium
                    ${isToday ? 'bg-amber-100 text-amber-700' : dow === 0 ? 'bg-red-100/60 text-red-400' : dow === 6 ? 'bg-sky-100/60 text-sky-400' : 'text-gray-500'}`}>
                    <div className="font-semibold">{d}</div>
                    <div className="font-normal text-gray-400 text-xs">{DOW[dow]}</div>
                  </th>
                )
              })}
              <th className="border border-gray-300 px-2 py-2 text-center text-gray-700 min-w-20 whitespace-nowrap font-semibold">잔여연차</th>
              <th className="border border-gray-300 px-2 py-2 text-center text-gray-700 min-w-20 whitespace-nowrap font-semibold">잔여병가</th>
              <th className="border border-gray-300 px-2 py-2 text-center text-gray-700 min-w-12 font-semibold">재택</th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map(([team, emps]) => (
              <>
                <tr key={`th-${team}`}>
                  <td colSpan={daysInMonth + 4}
                    className="sticky left-0 bg-gray-200 border-y-2 border-gray-400 border-l-4 border-l-blue-600 px-3 py-1.5 font-bold text-slate-700 text-xs">
                    {team}
                  </td>
                </tr>

                {emps.map((emp, idx) => {
                  const startDateObj  = emp.start_date ? new Date(emp.start_date) : null
                  const endDateObj    = emp.end_date   ? new Date(emp.end_date)   : null
                  const isUpcoming    = !!(startDateObj && startDateObj > today)
                  const isTerminated  = !!emp.end_date
                  const empYS         = ys[emp.id]
                  const vacInfo       = vacDisplay(emp, empYS?.vacTaken ?? 0, year, month, carryovers[emp.id] ?? 0)
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
                            {!isTerminated && !isUpcoming && emp.probation_start && (() => {
                              const t = todayIso()
                              const on = emp.probation_start <= t && (!emp.probation_end || emp.probation_end >= t)
                              return on ? (
                                <div className="text-xs text-orange-500">
                                  수습중{emp.probation_end ? ` (~${fmtDate(emp.probation_end)})` : ''}
                                </div>
                              ) : null
                            })()}
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
                            className={`border border-gray-300 w-8 h-7 text-center relative select-none
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

                      <td className="border border-gray-300 text-center px-1">
                        {isUpcoming || isTerminated ? <span className="text-xs text-gray-300">—</span>
                          : vacInfo ? <span className={`text-xs font-semibold ${vacInfo.alert ? 'text-red-600' : 'text-green-700'}`}>{vacInfo.text}</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="border border-gray-300 text-center px-1">
                        {totalSick > 0 ? (() => {
                          const left = Math.max(0, Math.round((5 - totalSick) * 10) / 10)
                          return (
                            <span className={`text-xs font-semibold ${left === 0 ? 'text-red-600' : left <= 2 ? 'text-orange-500' : 'text-gray-700'}`}>
                              {left}/5
                            </span>
                          )
                        })() : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="border border-gray-300 text-center">
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
          <button onClick={() => {
            setPosValue(managingEmp.position ?? '')
            setPosModal({ emp: managingEmp })
            setManagingEmp(null); setMenuPos(null)
          }}
            className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            직급 수정{managingEmp.position ? ` (${managingEmp.position})` : ''}
          </button>
          <button onClick={() => {
            const emp = managingEmp
            setProbStartMode(emp.start_date ? 'hire' : 'custom')
            setProbStartVal(emp.probation_start ?? emp.start_date ?? '')
            if (emp.probation_end) {
              setProbEndMode('custom'); setProbEndVal(emp.probation_end)
            } else if (emp.start_date) {
              setProbEndMode('90d')
              const d = new Date(emp.start_date); d.setDate(d.getDate() + 90)
              setProbEndVal(d.toISOString().split('T')[0])
            } else {
              setProbEndMode('custom'); setProbEndVal('')
            }
            setProbModal({ emp })
            setManagingEmp(null); setMenuPos(null)
          }}
            className="w-full text-left px-3 py-2 text-xs text-orange-600 hover:bg-orange-50">
            수습 기간 설정{managingEmp.probation_start ? ' ✓' : ''}
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

      {/* 직급 수정 모달 */}
      {posModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
             onClick={e => { if (e.target === e.currentTarget) setPosModal(null) }}>
          <div className="bg-white rounded-xl p-6 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">직급 수정</h3>
            <p className="text-sm text-gray-500 mb-3">{posModal.emp.name}</p>
            <input
              type="text" value={posValue} autoFocus
              onChange={e => setPosValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') document.getElementById('pos-save')?.click() }}
              placeholder="예) Manager, Driver, Coordinator"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-4"
            />
            <div className="flex gap-2">
              <button id="pos-save"
                onClick={async () => {
                  await supabase.from('employees').update({ position: posValue || null }).eq('id', posModal.emp.id)
                  setEmployees(prev => prev.map(e =>
                    e.id === posModal.emp.id ? { ...e, position: posValue || null } : e
                  ))
                  setPosModal(null)
                }}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700">저장</button>
              <button onClick={() => setPosModal(null)}
                className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 수습 기간 설정 모달 */}
      {probModal && (() => {
        const emp = probModal.emp
        const saveProb = async () => {
          const finalStart = probStartMode === 'hire' ? (emp.start_date ?? null) : (probStartVal || null)
          const finalEnd   = probEndVal || null
          await supabase.from('employees').update({ probation_start: finalStart, probation_end: finalEnd }).eq('id', emp.id)
          setEmployees(prev => prev.map(e =>
            e.id === emp.id ? { ...e, probation_start: finalStart ?? undefined, probation_end: finalEnd ?? undefined } : e
          ))
          setProbModal(null)
        }
        const deleteProb = async () => {
          await supabase.from('employees').update({ probation_start: null, probation_end: null }).eq('id', emp.id)
          setEmployees(prev => prev.map(e =>
            e.id === emp.id ? { ...e, probation_start: undefined, probation_end: undefined } : e
          ))
          setProbModal(null)
        }
        return (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
               onClick={e => { if (e.target === e.currentTarget) setProbModal(null) }}>
            <div className="bg-white rounded-xl p-6 w-80 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="font-semibold text-gray-900">수습 기간 — {emp.name}</h3>

              {/* 시작일 */}
              <div className="space-y-1.5">
                <p className="text-xs text-gray-500 font-medium">수습 시작일</p>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode === 'hire' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbStartMode('hire')
                      if (probEndMode === '90d' && emp.start_date) {
                        const d = new Date(emp.start_date); d.setDate(d.getDate() + 90)
                        setProbEndVal(d.toISOString().split('T')[0])
                      }
                    }}>입사일</button>
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbStartMode('custom')}>직접 입력</button>
                </div>
                {probStartMode === 'hire'
                  ? <p className="text-xs text-gray-400">입사일: {emp.start_date ?? '미설정'}</p>
                  : <input type="date" value={probStartVal}
                      onChange={e => {
                        setProbStartVal(e.target.value)
                        if (probEndMode === '90d' && e.target.value) {
                          const d = new Date(e.target.value); d.setDate(d.getDate() + 90)
                          setProbEndVal(d.toISOString().split('T')[0])
                        }
                      }}
                      className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                }
              </div>

              {/* 종료일 */}
              <div className="space-y-1.5">
                <p className="text-xs text-gray-500 font-medium">수습 종료일</p>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode === '90d' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbEndMode('90d')
                      const ref = probStartMode === 'hire' ? emp.start_date : probStartVal
                      if (ref) { const d = new Date(ref); d.setDate(d.getDate() + 90); setProbEndVal(d.toISOString().split('T')[0]) }
                    }}>+90일</button>
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbEndMode('custom')}>직접 입력</button>
                </div>
                <input type="date" value={probEndVal}
                  readOnly={probEndMode === '90d'}
                  onChange={e => { if (probEndMode === 'custom') setProbEndVal(e.target.value) }}
                  className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${probEndMode === '90d' ? 'bg-gray-50 text-gray-500' : ''}`} />
              </div>

              {/* 버튼 */}
              <div className="flex gap-2 pt-1">
                <button onClick={saveProb}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700">저장</button>
                <button onClick={() => setProbModal(null)}
                  className="px-4 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
                {emp.probation_start && (
                  <button onClick={deleteProb}
                    className="px-4 border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">삭제</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {saving && (
        <div className="fixed bottom-4 right-4 bg-gray-800 text-white text-xs px-3 py-2 rounded-lg shadow">저장 중...</div>
      )}
    </>
  )
}
