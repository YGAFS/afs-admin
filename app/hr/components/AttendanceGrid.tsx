'use client'

import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import { hrFetch } from '@/lib/hrApi'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

type LeaveCode = 'L'|'L1'|'L2'|'L3'|'S'|'S1'|'S2'|'S3'|'W'|'W1'|'W2'|'W3'|'T'|'T1'|'T2'|'T3'|'B'|'O'|'C'
type Employee  = {
  id: string; name: string; team: string; manager_name: string
  vacation_allowance: number; position: string | null; sort_order: number
  is_exempt: boolean; uses_accrual: boolean
  start_date?: string; end_date?: string
  probation_start?: string; probation_end?: string
  employment_type?: string | null
}
type LeaveCell = { code: LeaveCode; hours?: number; reportedAt?: string | null }
type YS        = { vacTaken: number; sick: number; wfh: number; ot: number }
const DAY_HOURS = 8

type FlagType = 'late' | 'early_leave'
type AttFlag   = { time?: string; reason?: string }
type FlagMap   = Record<string, Partial<Record<FlagType, AttFlag>>>

const CODE_COLOR: Record<string, string> = {
  L:  'bg-green-200 text-green-800',  L1: 'bg-green-100 text-green-700',
  L2: 'bg-green-100 text-green-700',  L3: 'bg-green-50  text-green-600',
  S:  'bg-red-200   text-red-800',    S1: 'bg-red-100   text-red-700',
  S2: 'bg-red-100   text-red-700',    S3: 'bg-red-50    text-red-600',
  W:  'bg-blue-200  text-blue-800',   W1: 'bg-blue-100  text-blue-700',
  W2: 'bg-blue-100  text-blue-700',   W3: 'bg-blue-50   text-blue-600',
  T:  'bg-line  text-ink-muted',
  T1: 'bg-pill  text-ink-muted',   T2: 'bg-pill  text-ink-muted',
  T3: 'bg-pill   text-ink-muted',   B:  'bg-pill  text-ink-muted',
  O:  'bg-amber-200 text-amber-800',
  C:  'bg-purple-200 text-purple-800',
}

const CODE_OPTIONS: { code: LeaveCode; needsHours?: boolean }[] = [
  { code: 'L' }, { code: 'L1' }, { code: 'L2' }, { code: 'L3', needsHours: true },
  { code: 'S' }, { code: 'S1' }, { code: 'S2' }, { code: 'S3', needsHours: true },
  { code: 'W' }, { code: 'W1' }, { code: 'W2' }, { code: 'W3', needsHours: true },
  { code: 'T' }, { code: 'T1' }, { code: 'T2' }, { code: 'T3', needsHours: true },
  { code: 'B' },
  { code: 'O', needsHours: true },
  { code: 'C' },
]

const TEAM_ORDER = ['Team Sales','Team Accounting','Team Operations','Department 1','Department 2','Department 3']
type EmpVacStat = { accrued: number; carryIn: number; periodUsed: number }

function isoToLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d)
}
function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function getAnnivPeriods(startIso: string, asOf: Date) {
  const start = isoToLocal(startIso)
  const periods: {pStart: Date; pEnd: Date}[] = []
  let y = 0
  while (true) {
    const pStart = new Date(start); pStart.setFullYear(start.getFullYear() + y)
    if (pStart > asOf) break
    const pEnd = new Date(start); pEnd.setFullYear(start.getFullYear() + y + 1); pEnd.setDate(pEnd.getDate() - 1)
    periods.push({ pStart, pEnd })
    y++
  }
  return periods
}
function calcAnnivVacStat(
  emp: Employee,
  vacEntries: { date: string; code: string }[],
  asOf: Date
): EmpVacStat {
  if (!emp.start_date || !emp.uses_accrual || emp.is_exempt) return { accrued: emp.vacation_allowance, carryIn: 0, periodUsed: 0 }
  const periods = getAnnivPeriods(emp.start_date, asOf)
  if (!periods.length) return { accrued: 0, carryIn: 0, periodUsed: 0 }
  const asOfIso = dateToIso(asOf)
  let carryIn = 0
  let result: EmpVacStat = { accrued: 0, carryIn: 0, periodUsed: 0 }
  for (let i = 0; i < periods.length; i++) {
    const { pStart, pEnd } = periods[i]
    const isCurrent = i === periods.length - 1
    const pStartIso = dateToIso(pStart)
    const pEndIso   = isCurrent ? asOfIso : dateToIso(pEnd)
    const used = Math.round(
      vacEntries.filter(e => e.date >= pStartIso && e.date <= pEndIso)
        .reduce((s, e) => s + (['L1','L2'].includes(e.code) ? 0.5 : 1), 0) * 100) / 100
    const accrued = isCurrent
      ? Math.round(Math.min((asOf.getTime() - pStart.getTime()) / 86400000 / 365 * emp.vacation_allowance, emp.vacation_allowance) * 100) / 100
      : emp.vacation_allowance
    const remaining = Math.max(0, accrued + carryIn - used)
    if (isCurrent) { result = { accrued, carryIn, periodUsed: used }; break }
    carryIn = Math.min(5, remaining)
  }
  return result
}
function vacDisplay(emp: Employee, vs: EmpVacStat | null, calYearTaken: number) {
  if (emp.is_exempt) return null
  if (emp.uses_accrual && vs) {
    const total = Math.round((vs.accrued + vs.carryIn) * 10) / 10
    const left  = Math.max(0, Math.round((total - vs.periodUsed) * 10) / 10)
    return { text: `${left}/${total}`, hours: Math.round(left * DAY_HOURS * 10) / 10, alert: left <= 1 }
  }
  const left = emp.vacation_allowance - calYearTaken
  return { text: `${left}/${emp.vacation_allowance}`, hours: Math.round(left * DAY_HOURS * 10) / 10, alert: left <= 5 }
}
function fmtDate(iso: string) {
  const [, m, d] = iso.split('-'); return `${+m}. ${+d}.`
}
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

type DateModal = { emp: Employee; field: 'start_date' | 'end_date' | 'reactivate' }

function effectiveAccrualStart(
  emp: { uses_accrual: boolean; is_exempt: boolean; start_date: string | null; probation_end: string | null },
  year: number, month: number
): string | null {
  if (emp.is_exempt || !emp.uses_accrual) return emp.start_date
  if (emp.probation_end) {
    const [py, pm] = emp.probation_end.split('-').map(Number)
    if (year < py || (year === py && month <= pm)) return null
    return emp.probation_end
  }
  return emp.start_date
}

export default function AttendanceGrid({ companyId, companyCode, year, month, onReactivate }: {
  companyId: string; companyCode?: string; year: number; month: number; onReactivate?: () => void
}) {
  const { locale } = useLocale()
  const [employees,    setEmployees]    = useState<Employee[]>([])
  const [leaveMap,     setLeaveMap]     = useState<Record<string, LeaveCell[]>>({})
  const [ys,           setYS]           = useState<Record<string, YS>>({})
  const [vacStatMap,   setVacStatMap]   = useState<Record<string, EmpVacStat>>({})
  const [editing,      setEditing]      = useState<{ empId: string; day: number } | null>(null)
  const [dropPos,      setDropPos]      = useState<{ top: number; left: number } | null>(null)
  const [pendingCode,  setPendingCode]  = useState<LeaveCode | null>(null)
  const [pendingHours, setPendingHours] = useState('')
  const [saving,       setSaving]       = useState(false)
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
  const [noteMap,   setNoteMap]   = useState<Record<string, string>>({})
  const [noteCtx,   setNoteCtx]   = useState<{ empId: string; day: number; x: number; y: number } | null>(null)
  const [noteModal, setNoteModal] = useState<{ empId: string; day: number; existing: string } | null>(null)
  const [noteText,  setNoteText]  = useState('')
  const [flagMap,   setFlagMap]   = useState<FlagMap>({})
  const [flagModal, setFlagModal] = useState<{ empId: string; day: number; type: FlagType } | null>(null)
  const [flagTime,   setFlagTime]   = useState('')
  const [flagReason, setFlagReason] = useState('')
  const [colMenu,   setColMenu]   = useState<{ day: number; top: number; left: number } | null>(null)
  const dropRef    = useRef<HTMLDivElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)
  const noteCtxRef = useRef<HTMLDivElement>(null)
  const colMenuRef = useRef<HTMLDivElement>(null)
  const saveTraceRef = useRef<{ id: number; operation: string; startedAt: number } | null>(null)
  const saveTraceSequence = useRef(0)
  const loadTraceSequence = useRef(0)
  const loadTraceRef = useRef<{ id: number; startedAt: number; apiDoneAt: number; transformDoneAt?: number } | null>(null)
  const renderProfileRef = useRef<{ startedAt: number; rowCount: number; cellCount: number } | null>(null)
  const savingCountRef = useRef(0)
  const savingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function startSaving() {
    savingCountRef.current += 1
    if (savingCountRef.current !== 1) return
    savingTimerRef.current = setTimeout(() => {
      if (savingCountRef.current > 0) setSaving(true)
    }, 300)
  }

  function finishSaving() {
    savingCountRef.current = Math.max(0, savingCountRef.current - 1)
    if (savingCountRef.current > 0) return
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current)
    savingTimerRef.current = null
    setSaving(false)
  }

  function saveTraceMark(label: string) {
    const trace = saveTraceRef.current
    if (!trace) return
    console.info(`[HR lifecycle] ${trace.operation} #${trace.id} ${label} +${Math.round(performance.now() - trace.startedAt)}ms`)
  }

  function beginSaveTrace(operation: string) {
    const id = ++saveTraceSequence.current
    saveTraceRef.current = { id, operation, startedAt: performance.now() }
    saveTraceMark('handler entered')
  }

  useLayoutEffect(() => {
    saveTraceMark(`React commit saving=${saving} leaveMapKeys=${Object.keys(leaveMap).length}`)
  }, [saving, leaveMap])

  useLayoutEffect(() => {
    const trace = loadTraceRef.current
    if (!trace || !employees.length || !renderProfileRef.current) return
    const render = renderProfileRef.current
    const committedAt = performance.now()
    console.info(`[HR initial] load #${trace.id} React commit +${Math.round(committedAt - trace.startedAt)}ms; API→commit ${Math.round(committedAt - trace.apiDoneAt)}ms; transform→commit ${Math.round(committedAt - (trace.transformDoneAt ?? trace.apiDoneAt))}ms; rows=${render.rowCount}; cells=${render.cellCount}`)
    requestAnimationFrame(() => {
      const domAt = performance.now()
      console.info(`[HR initial] load #${trace.id} table DOM/paint +${Math.round(domAt - trace.startedAt)}ms; commit→DOM ${Math.round(domAt - committedAt)}ms`)
    })
    loadTraceRef.current = null
    renderProfileRef.current = null
  }, [employees, leaveMap, noteMap, flagMap, ys, vacStatMap])

  useEffect(() => {
    if (saving) saveTraceMark('Saving UI committed visible')
    else if (saveTraceRef.current) {
      saveTraceMark('Saving UI committed hidden / lifecycle end')
      saveTraceRef.current = null
    }
  }, [saving])

  useEffect(() => () => {
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current)
  }, [])

  const daysInMonth    = new Date(year, month, 0).getDate()
  const days           = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const today          = new Date()
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1
  const todayDay       = today.getDate()
  const dayMeta = useMemo(() => days.map(day => ({
    day,
    dow: new Date(year, month - 1, day).getDay(),
    date: new Date(year, month - 1, day),
    isToday: isCurrentMonth && day === todayDay,
  })), [year, month, daysInMonth, isCurrentMonth, todayDay])
  const pad            = (n: number) => String(n).padStart(2, '0')
  const firstDayStr    = `${year}-${pad(month)}-01`
  const lastDayStr     = `${year}-${pad(month)}-${pad(daysInMonth)}`

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setEditing(null)
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setManagingEmp(null); setMenuPos(null)
      }
      if (noteCtxRef.current && !noteCtxRef.current.contains(e.target as Node)) setNoteCtx(null)
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { setPendingCode(null); setPendingHours(''); if (!editing) setDropPos(null) }, [editing])
  useEffect(() => { load() }, [companyCode, year, month])

  async function load() {
    if (!companyId && !companyCode) return
    const loadId = ++loadTraceSequence.current
    const loadStartedAt = performance.now()
    console.info(`[HR initial] load #${loadId} start`)
    const result = await hrFetch<{ employees: Employee[]; monthEntries: any[]; yearEntries: any[]; prevYearEntries: any[]; prevPrevYearEntries: any[]; notes: any[]; flags: any[] }>(
      `/api/hr/attendance?${companyCode ? `companyCode=${encodeURIComponent(companyCode)}` : `companyId=${encodeURIComponent(companyId)}`}&first=${firstDayStr}&last=${lastDayStr}&year=${year}`)
    const apiDoneAt = performance.now()
    console.info(`[HR initial] load #${loadId} API complete +${Math.round(apiDoneAt - loadStartedAt)}ms`)
    if (result.error || !result.data) return
    const transformStartedAt = performance.now()
    let emps = result.data.employees.filter(e => !e.employment_type || e.employment_type === 'office')

    setEmployees(emps ?? [])
    if (!emps?.length) return

    const { monthEntries, yearEntries: ye, prevYearEntries: prevYe, prevPrevYearEntries: prevPrevYe, notes: notesRaw, flags: flagsRaw } = result.data

    const lm: Record<string, LeaveCell[]> = {}
    for (const e of (monthEntries ?? [])) {
      const key = `${e.employee_id}_${parseInt(e.date.split('-')[2], 10)}`
      const reportedAt = 'reported_at' in e ? (e.reported_at as string | null) : null
      ;(lm[key] ??= []).push({ code: e.leave_code as LeaveCode, hours: e.hours ?? undefined, reportedAt })
    }
    setLeaveMap(lm)

    const nm: Record<string, string> = {}
    for (const n of (notesRaw ?? []))
      nm[`${n.employee_id}_${parseInt(n.date.split('-')[2], 10)}`] = n.note
    setNoteMap(nm)

    const fm: FlagMap = {}
    for (const f of (flagsRaw ?? [])) {
      const key = `${f.employee_id}_${parseInt(f.date.split('-')[2], 10)}`
      ;(fm[key] ??= {})[f.flag_type as FlagType] = { time: f.time ?? undefined, reason: f.reason ?? undefined }
    }
    setFlagMap(fm)

    const ysMap: Record<string, YS> = {}
    for (const emp of emps) ysMap[emp.id] = { vacTaken: 0, sick: 0, wfh: 0, ot: 0 }
    for (const e of (ye ?? [])) {
      if (!ysMap[e.employee_id]) continue
      const d = ['L1','L2','S1','S2'].includes(e.leave_code) ? 0.5 : 1
      if      (['L','L1','L2','L3'].includes(e.leave_code))    ysMap[e.employee_id].vacTaken += d
      else if (['S','S1','S2','S3'].includes(e.leave_code))    ysMap[e.employee_id].sick     += d
      else if (e.leave_code === 'W')                           ysMap[e.employee_id].wfh      += 1
      else if (['W1','W2'].includes(e.leave_code))             ysMap[e.employee_id].wfh      += 0.5
      else if (e.leave_code === 'W3')                          ysMap[e.employee_id].wfh      += 0.5
      else if (e.leave_code === 'O')                           ysMap[e.employee_id].ot       += (e.hours ?? 0)
    }
    setYS(ysMap)

    const allVacByEmp: Record<string, { date: string; code: string }[]> = {}
    for (const emp of emps) allVacByEmp[emp.id] = []
    for (const e of [...(prevPrevYe ?? []), ...(prevYe ?? []), ...(ye ?? [])]) {
      if (!allVacByEmp[e.employee_id] || !['L','L1','L2','L3'].includes(e.leave_code)) continue
      allVacByEmp[e.employee_id].push({ date: e.date, code: e.leave_code })
    }

    const now = new Date()
    const vsMap: Record<string, EmpVacStat> = {}
    for (const emp of emps) {
      vsMap[emp.id] = calcAnnivVacStat(emp, allVacByEmp[emp.id] ?? [], now)
    }
    const transformDoneAt = performance.now()
    loadTraceRef.current = { id: loadId, startedAt: loadStartedAt, apiDoneAt, transformDoneAt }
    console.info(`[HR initial] load #${loadId} data transformation +${Math.round(transformDoneAt - transformStartedAt)}ms; rows=${emps.length}; monthEntries=${monthEntries?.length ?? 0}; yearEntries=${ye?.length ?? 0}; notes=${notesRaw?.length ?? 0}; flags=${flagsRaw?.length ?? 0}`)
    setVacStatMap(vsMap)
  }

  function applyStatsDelta(empId: string, code: LeaveCode, delta: number, dateStr: string) {
    setYS(prev => {
      const current = prev[empId] ?? { vacTaken: 0, sick: 0, wfh: 0, ot: 0 }
      const next = { ...current }
      const half = ['L1','L2','S1','S2'].includes(code) ? 0.5 : 1
      if (['L','L1','L2','L3'].includes(code)) next.vacTaken += delta * half
      else if (['S','S1','S2','S3'].includes(code)) next.sick += delta * half
      else if (['W','W1','W2','W3'].includes(code)) next.wfh += delta * (code === 'W' ? 1 : 0.5)
      else if (code === 'O') next.ot += delta
      return { ...prev, [empId]: next }
    })
    const emp = employees.find(e => e.id === empId)
    if (!emp || !emp.uses_accrual || emp.is_exempt || !emp.start_date || !['L','L1','L2','L3'].includes(code)) return
    const todayStr = todayIso()
    if (dateStr > todayStr) return
    const periods = getAnnivPeriods(emp.start_date, new Date())
    const current = periods[periods.length - 1]
    if (!current) return
    const date = isoToLocal(dateStr)
    if (date < current.pStart || date > new Date()) return
    setVacStatMap(prev => {
      const stat = prev[empId]
      if (!stat) return prev
      const used = ['L1','L2'].includes(code) ? 0.5 : 1
      return { ...prev, [empId]: { ...stat, periodUsed: stat.periodUsed + delta * used } }
    })
  }

  async function addEntry(empId: string, day: number, code: LeaveCode, hours?: number) {
    beginSaveTrace(`ADD ${code}`)
    const saveStartedAt = performance.now()
    saveTraceMark('startSaving() call')
    startSaving()
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key     = `${empId}_${day}`
    const previousEntries = leaveMap[key] ?? []
    const existing = previousEntries.find(e => e.code === code)
    setLeaveMap(p => {
      const nextEntries = (p[key] ?? []).filter(e => e.code !== code)
      return { ...p, [key]: [...nextEntries, { code, hours, reportedAt: null }] }
    })
    if (!existing) applyStatsDelta(empId, code, 1, dateStr)
    saveTraceMark('fetch POST about to start')
    const { data: saved, error } = await hrFetch<{ data?: Array<{ employee_id: string; date: string; leave_code: LeaveCode; hours: number | null; reported_at?: string | null }> }>('/api/hr/leave-entries', { method: 'POST', body: JSON.stringify({ employee_id: empId, date: dateStr, leave_code: code, hours: hours ?? null, reported_at: null, reported_to: null, reported_cc: null, reported_subject: null, reported_by: null }) })
    saveTraceMark('fetch POST/API complete')
    if (error) {
      alert(`저장 실패: ${error.message}`)
      setLeaveMap(p => ({ ...p, [key]: previousEntries }))
      if (!existing) applyStatsDelta(empId, code, -1, dateStr)
      finishSaving()
      return
    }
    saveTraceMark('client leaveMap state update call')
    setLeaveMap(p => {
      const existing = (p[key] ?? []).filter(e => e.code !== code)
      const row = saved?.data?.[0]
      return { ...p, [key]: [...existing, { code, hours: row?.hours ?? hours, reportedAt: row?.reported_at ?? null }] }
    })
    saveTraceMark('finishSaving() call')
    finishSaving(); setPendingCode(null); setPendingHours('')
    console.info(`[HR timing] save ${code} total ${Math.round(performance.now() - saveStartedAt)}ms; POST only; post-save load removed`)
  }

  async function removeEntry(empId: string, day: number, code: LeaveCode) {
    beginSaveTrace(`DELETE ${code}`)
    saveTraceMark('startSaving() call')
    startSaving()
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key     = `${empId}_${day}`
    const previousEntries = leaveMap[key] ?? []
    const removedEntries = previousEntries.filter(e => e.code === code)
    setLeaveMap(p => ({ ...p, [key]: (p[key] ?? []).filter(e => e.code !== code) }))
    if (removedEntries.length) applyStatsDelta(empId, code, -1, dateStr)
    saveTraceMark('fetch DELETE about to start')
    const { error } = await hrFetch('/api/hr/leave-entries', { method: 'DELETE', body: JSON.stringify({ employee_id: empId, date: dateStr, leave_code: code }) })
    saveTraceMark('fetch DELETE/API complete')
    if (error) {
      alert(`삭제 실패: ${error.message}`)
      setLeaveMap(p => ({ ...p, [key]: previousEntries }))
      if (removedEntries.length) applyStatsDelta(empId, code, 1, dateStr)
    }
    saveTraceMark('client leaveMap state update call')
    saveTraceMark('finishSaving() call')
    finishSaving()
  }

  async function clearCell(empId: string, day: number) {
    beginSaveTrace('CLEAR CELL')
    saveTraceMark('startSaving() call')
    startSaving()
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key     = `${empId}_${day}`
    const previous = leaveMap[key] ?? []
    setLeaveMap(p => { const n = { ...p }; delete n[key]; return n })
    previous.forEach(entry => applyStatsDelta(empId, entry.code, -1, dateStr))
    saveTraceMark('fetch DELETE about to start')
    const { error } = await hrFetch('/api/hr/leave-entries', { method: 'DELETE', body: JSON.stringify({ employee_id: empId, date: dateStr }) })
    saveTraceMark('fetch DELETE/API complete')
    if (error) {
      alert(`삭제 실패: ${error.message}`)
      setLeaveMap(p => ({ ...p, [key]: previous }))
      previous.forEach(entry => applyStatsDelta(empId, entry.code, 1, dateStr))
    }
    saveTraceMark('client leaveMap state update call')
    saveTraceMark('finishSaving() call')
    finishSaving(); setEditing(null); setPendingCode(null); setPendingHours('')
  }

  async function saveNote(empId: string, day: number, note: string) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key = `${empId}_${day}`
    await hrFetch('/api/hr/attendance-notes', { method: 'POST', body: JSON.stringify({ employee_id: empId, date: dateStr, note }) })
    setNoteMap(p => ({ ...p, [key]: note }))
    setNoteModal(null)
  }

  async function saveFlag(empId: string, day: number, type: FlagType, time: string, reason: string) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key = `${empId}_${day}`
    const { error } = await hrFetch('/api/hr/attendance-flags', { method: 'POST', body: JSON.stringify({ employee_id: empId, date: dateStr, flag_type: type, time: time || null, reason: reason.trim() || null }) })
    if (error) { alert(`저장 실패: ${error.message}`); return }
    setFlagMap(p => ({ ...p, [key]: { ...(p[key] ?? {}), [type]: { time: time || undefined, reason: reason.trim() || undefined } } }))
    setFlagModal(null)
  }

  async function deleteFlag(empId: string, day: number, type: FlagType) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key = `${empId}_${day}`
    await hrFetch('/api/hr/attendance-flags', { method: 'DELETE', body: JSON.stringify({ employee_id: empId, date: dateStr, flag_type: type }) })
    setFlagMap(p => {
      const entry = { ...(p[key] ?? {}) }
      delete entry[type]
      return { ...p, [key]: entry }
    })
    setNoteCtx(null)
  }

  async function setColumnHoliday(day: number) {
    startSaving(); setColMenu(null)
    const dateStr  = `${year}-${pad(month)}-${pad(day)}`
    const cellDate = new Date(year, month - 1, day)
    const targets  = employees.filter(emp => {
      const s = emp.start_date ? new Date(emp.start_date) : null
      const e = emp.end_date   ? new Date(emp.end_date)   : null
      return !(s && cellDate < s) && !(e && cellDate > e)
    })
    if (targets.length) {
      const rows = targets.map(emp => ({ employee_id: emp.id, date: dateStr, leave_code: 'B', hours: null }))
      const { error } = await hrFetch('/api/hr/leave-entries', { method: 'POST', body: JSON.stringify(rows) })
      if (!error) setLeaveMap(prev => {
        const next = { ...prev }
        for (const emp of targets) {
          const key = `${emp.id}_${day}`
          next[key] = [...(next[key] ?? []).filter(e => e.code !== 'B'), { code: 'B' as LeaveCode }]
        }
        return next
      })
    }
    finishSaving()
  }

  async function clearColumn(day: number) {
    startSaving(); setColMenu(null)
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const ids = employees.map(e => e.id)
    const previous = employees.map(emp => ({ empId: emp.id, entries: leaveMap[`${emp.id}_${day}`] ?? [] }))
    const { error } = await hrFetch('/api/hr/leave-entries', { method: 'DELETE', body: JSON.stringify({ employee_ids: ids, date: dateStr }) })
    if (!error) setLeaveMap(prev => {
      const next = { ...prev }
      for (const emp of employees) delete next[`${emp.id}_${day}`]
      return next
    })
    if (!error) previous.forEach(({ empId, entries }) => entries.forEach(entry => applyStatsDelta(empId, entry.code, -1, dateStr)))
    finishSaving()
  }

  async function deleteNote(empId: string, day: number) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const key = `${empId}_${day}`
    await hrFetch('/api/hr/attendance-notes', { method: 'DELETE', body: JSON.stringify({ employee_id: empId, date: dateStr }) })
    setNoteMap(p => { const n = { ...p }; delete n[key]; return n })
    setNoteCtx(null)
  }

  function openManageMenu(e: React.MouseEvent, emp: Employee) {
    e.stopPropagation()
    if (managingEmp?.id === emp.id) { setManagingEmp(null); setMenuPos(null); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
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
    startSaving()
    const { emp, field } = dateModal
    if (field === 'reactivate') {
      await hrFetch(`/api/hr/employees/${emp.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: true, end_date: null }) })
      onReactivate?.()
    } else {
      await hrFetch(`/api/hr/employees/${emp.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: dateValue || null }) })
    }
    setDateModal(null); setDateValue(''); finishSaving(); load()
  }

  async function handleAddEmployee() {
    if (!newEmp.name.trim() || !addingToTeam) return
    await hrFetch('/api/hr/employees', { method: 'POST', body: JSON.stringify({
      company_id: companyId, name: newEmp.name.trim(), team: addingToTeam,
      position: newEmp.position || null, start_date: newEmp.start_date || null,
      vacation_allowance: newEmp.vacation_allowance, uses_accrual: newEmp.uses_accrual,
      is_active: true, sort_order: 99,
    }) })
    setAddingToTeam(null)
    setNewEmp({ name: '', position: '', start_date: '', vacation_allowance: 10, uses_accrual: true })
    load()
  }

  const fallbackTeam = locale === 'ko' ? '기타' : 'Other'
  const sortedTeams = useMemo(() => {
    const teams = employees.reduce<Record<string, Employee[]>>((acc, e) => {
      const k = e.team || fallbackTeam
      ;(acc[k] ??= []).push(e)
      return acc
    }, {})
    return Object.entries(teams).sort(([a], [b]) => {
      const ai = TEAM_ORDER.indexOf(a) >= 0 ? TEAM_ORDER.indexOf(a) : 99
      const bi = TEAM_ORDER.indexOf(b) >= 0 ? TEAM_ORDER.indexOf(b) : 99
      return ai - bi || a.localeCompare(b)
    })
  }, [employees, fallbackTeam])

  if (loadTraceRef.current && employees.length && !renderProfileRef.current) {
    const rowCount = sortedTeams.reduce((count, [, teamEmployees]) => count + teamEmployees.length, 0)
    renderProfileRef.current = { startedAt: performance.now(), rowCount, cellCount: rowCount * daysInMonth }
    console.info(`[HR initial] AttendanceGrid render start rows=${rowCount}; cells=${rowCount * daysInMonth}`)
  }

  return (
    <>
      <div className="overflow-x-auto border-2 border-line-strong rounded-xl">
        <table className="border-collapse text-xs min-w-full">
          <thead>
            <tr className="bg-pill">
              <th className="sticky left-0 z-10 bg-pill border border-line-strong px-3 py-2 text-left text-ink min-w-44 font-bold">
                {t('grid.col.employee', locale)}
              </th>
              {dayMeta.map(({ day: d, dow, isToday }) => {
                const isColMenuOpen = colMenu?.day === d
                return (
                  <th key={d}
                    onClick={e => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setColMenu(prev => prev?.day === d ? null : {
                        day: d,
                        top: rect.bottom + 4,
                        left: Math.min(rect.left, window.innerWidth - 164),
                      })
                    }}
                    className={`border border-line-strong w-8 text-center py-1 font-medium cursor-pointer select-none
                      ${isColMenuOpen ? 'ring-2 ring-inset ring-ink' : ''}
                      ${isToday ? 'bg-amber-100 text-amber-700' : (dow === 0 || dow === 6) ? 'bg-line text-ink-muted' : 'text-ink-muted hover:bg-line'}`}>
                    <div className="font-semibold">{d}</div>
                    <div className="font-normal text-ink-faint text-xs">{t(`grid.dow.${dow}`, locale)}</div>
                  </th>
                )
              })}
              <th className="border border-line px-2 py-2 text-center text-ink-muted min-w-20 whitespace-nowrap font-semibold">
                {t('grid.col.leave_left', locale)}
              </th>
              <th className="border border-line px-2 py-2 text-center text-ink-muted min-w-20 whitespace-nowrap font-semibold">
                {t('grid.col.sick_left', locale)}
              </th>
              <th className="border border-line px-2 py-2 text-center text-ink-muted min-w-12 font-semibold">
                {t('grid.col.wfh', locale)}
              </th>
              <th className="border border-line px-2 py-2 text-center text-amber-600 min-w-14 whitespace-nowrap font-semibold">
                {t('grid.col.ot', locale)}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map(([team, emps]) => (
              <>
                <tr key={`th-${team}`}>
                  <td colSpan={daysInMonth + 5}
                    className="sticky left-0 bg-line border-y-2 border-line-strong border-l-4 border-l-ink px-3 py-1.5 font-bold text-ink text-xs">
                    {team}
                  </td>
                </tr>

                {emps.map((emp, idx) => {
                  const startDateObj  = emp.start_date ? new Date(emp.start_date) : null
                  const endDateObj    = emp.end_date   ? new Date(emp.end_date)   : null
                  const isUpcoming    = !!(startDateObj && startDateObj > today)
                  const isTerminated  = !!emp.end_date
                  const empYS         = ys[emp.id]
                  const vacInfo       = vacDisplay(emp, vacStatMap[emp.id] ?? null, empYS?.vacTaken ?? 0)
                  const totalSick     = empYS?.sick ?? 0
                  const rowBg         = idx % 2 === 0 ? 'bg-white' : 'bg-pill'

                  return (
                    <tr key={emp.id} className={rowBg}>
                      <td className={`sticky left-0 z-10 border border-line px-3 py-1.5 group ${rowBg}`}>
                        <div className="flex items-center justify-between gap-1">
                          <div className="min-w-0">
                            <div className={`font-medium leading-4 ${isTerminated ? 'text-ink-faint line-through' : 'text-ink'}`}>
                              {emp.name}
                            </div>
                            {emp.position && <div className="text-xs text-ink-faint">{emp.position}</div>}
                            {isUpcoming && emp.start_date && (
                              <div className="text-xs text-ink-muted">
                                {fmtDate(emp.start_date)} {t('grid.upcoming', locale)}
                              </div>
                            )}
                            {isTerminated && emp.end_date && (
                              <div className="text-xs text-signal-neg">
                                {fmtDate(emp.end_date)} {t('grid.terminated_label', locale)}
                              </div>
                            )}
                            {!isTerminated && !isUpcoming && emp.probation_start && (() => {
                              const todStr = todayIso()
                              const on = emp.probation_start <= todStr && (!emp.probation_end || emp.probation_end >= todStr)
                              return on ? (
                                <div className="text-xs text-amber-600">
                                  {t('grid.probation_active', locale)}{emp.probation_end ? ` (~${fmtDate(emp.probation_end)})` : ''}
                                </div>
                              ) : null
                            })()}
                          </div>
                          <button
                            onClick={e => openManageMenu(e, emp)}
                            className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-ink-muted px-1 rounded text-base leading-none flex-shrink-0">
                            ⋮
                          </button>
                        </div>
                      </td>

                      {days.map(d => {
                        const entries       = leaveMap[`${emp.id}_${d}`] ?? []
                        const dow           = new Date(year, month - 1, d).getDay()
                        const isToday       = isCurrentMonth && d === today.getDate()
                        const isEdit        = editing?.empId === emp.id && editing?.day === d
                      const cellDate      = dayMeta[d - 1].date
                        const isBeforeStart = !!(startDateObj && cellDate < startDateObj)
                        const isAfterEnd    = !!(endDateObj   && cellDate > endDateObj)
                        const blocked       = isBeforeStart || isAfterEnd
                        const cellBg        = blocked ? 'bg-line'
                                            : isToday  ? 'bg-amber-100'
                                            : (dow === 0 || dow === 6) ? 'bg-pill' : ''

                        const noteKey = `${emp.id}_${d}`
                        const cellNote = noteMap[noteKey]
                        const cellFlags = flagMap[noteKey]
                        const lateFlag  = cellFlags?.late
                        const earlyFlag = cellFlags?.early_leave
                        const tooltipLines = [
                          cellNote,
                          lateFlag  && `${t('grid.flag.late.mark', locale).replace('⏰ ', '')}${lateFlag.time ? ` ${lateFlag.time}` : ''}${lateFlag.reason ? ` - ${lateFlag.reason}` : ''}`,
                          earlyFlag && `${t('grid.flag.early.mark', locale).replace('🏃 ', '')}${earlyFlag.time ? ` ${earlyFlag.time}` : ''}${earlyFlag.reason ? ` - ${earlyFlag.reason}` : ''}`,
                        ].filter(Boolean) as string[]
                        return (
                          <td key={d}
                            className={`border border-line w-8 h-7 text-center relative select-none group
                              ${cellBg} ${blocked ? 'cursor-default' : 'hover:bg-pill cursor-pointer'}`}
                            onClick={e => {
                              if (blocked) return
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              const top = rect.bottom + 2
                              const left = Math.min(rect.left, window.innerWidth - 192)
                              setDropPos({ top: Math.min(top, window.innerHeight - 320), left: Math.max(4, left) })
                              setEditing({ empId: emp.id, day: d })
                            }}
                            onContextMenu={e => {
                              if (blocked) return
                              e.preventDefault()
                              e.stopPropagation()
                              setEditing(null)
                              setNoteCtx({ empId: emp.id, day: d, x: e.clientX, y: e.clientY })
                            }}>
                            {/* note/flag tooltip */}
                            {tooltipLines.length > 0 && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50
                                bg-ink text-white text-xs px-2 py-1 rounded whitespace-nowrap
                                pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity
                                max-w-48 overflow-hidden text-ellipsis shadow-lg text-left">
                                {tooltipLines.map((line, i) => <div key={i}>{line}</div>)}
                              </div>
                            )}
                            {/* note dot indicator */}
                            {cellNote && !blocked && (
                              <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-amber-400" />
                            )}
                            {/* late-arrival indicator */}
                            {lateFlag && !blocked && (
                              <span className="absolute top-0.5 left-0.5 w-1 h-1 rounded-full bg-signal-neg" />
                            )}
                            {/* early-leave indicator */}
                            {earlyFlag && !blocked && (
                              <span className="absolute bottom-0.5 left-0.5 w-1 h-1 rounded-full bg-purple-500" />
                            )}
                            {blocked ? (
                              <span className="text-ink-faint text-xs">—</span>
                            ) : entries.length ? (
                              <div className="flex flex-col items-center gap-0.5 py-0.5">
                                {entries.map(en => (
                                  <div key={en.code}
                                    title={en.reportedAt ? `Reported ${new Date(en.reportedAt).toLocaleString()}` : undefined}
                                    className={`relative inline-flex flex-col items-center px-0.5 rounded font-medium ${CODE_COLOR[en.code]}`}>
                                    {en.reportedAt && (
                                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-signal-pos text-white leading-none flex items-center justify-center border border-white"
                                        style={{ fontSize: 7 }}>
                                        ✓
                                      </span>
                                    )}
                                    <span className="leading-4" style={entries.length > 1 ? { fontSize: 9 } : undefined}>{en.code}</span>
                                    {en.hours && <span style={{ fontSize: 8 }}>{en.hours}h</span>}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        )
                      })}

                      <td className="border border-line text-center px-1">
                        {isUpcoming || isTerminated ? <span className="text-xs text-ink-faint">—</span>
                          : vacInfo ? (
                            <div>
                              <span className={`text-xs font-semibold ${vacInfo.alert ? 'text-signal-neg' : 'text-ink'}`}>{vacInfo.text}</span>
                              <div className="text-ink-faint leading-none" style={{ fontSize: 9 }}>{vacInfo.hours}h</div>
                            </div>
                          )
                          : <span className="text-xs text-ink-faint">—</span>}
                      </td>
                      <td className="border border-line text-center px-1">
                        {totalSick > 0 ? (() => {
                          const left = Math.max(0, Math.round((5 - totalSick) * 10) / 10)
                          return (
                            <span className={`text-xs font-semibold ${left === 0 ? 'text-signal-neg' : left <= 2 ? 'text-amber-600' : 'text-ink-muted'}`}>
                              {left}/5
                            </span>
                          )
                        })() : <span className="text-xs text-ink-faint">—</span>}
                      </td>
                      <td className="border border-line text-center">
                        <span className={`text-xs ${(empYS?.wfh ?? 0) > 0 ? 'text-ink' : 'text-ink-faint'}`}>
                          {(empYS?.wfh ?? 0) > 0 ? empYS!.wfh : '—'}
                        </span>
                      </td>
                      <td className="border border-line text-center">
                        <span className={`text-xs ${(empYS?.ot ?? 0) > 0 ? 'text-amber-600 font-semibold' : 'text-ink-faint'}`}>
                          {(empYS?.ot ?? 0) > 0 ? `${empYS!.ot}h` : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}

                <tr key={`add-${team}`}>
                  <td colSpan={daysInMonth + 5} className="border-b border-line bg-white">
                    <button onClick={() => setAddingToTeam(team)}
                      className="w-full px-4 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-pill text-left transition-colors">
                      {locale === 'ko' ? `+ ${team}에 직원 추가` : `+ Add Employee — ${team}`}
                    </button>
                  </td>
                </tr>
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Code picker dropdown — fixed overlay, never clipped by overflow — multi-select per day */}
      {editing && dropPos && (() => {
        const dayEntries = leaveMap[`${editing.empId}_${editing.day}`] ?? []
        const selectedCodes = new Set(dayEntries.map(e => e.code))
        return (
          <div ref={dropRef}
            style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
            className="bg-white border border-line rounded-lg shadow-xl py-1 w-52 max-h-96 overflow-y-auto">
            {dayEntries.length > 0 && (
              <>
                {dayEntries.map(en => (
                  <div key={en.code} className={`flex items-center justify-between px-3 py-1 text-xs ${CODE_COLOR[en.code]}`}>
                    <span className="font-medium">{en.code}{en.hours ? ` — ${en.hours}h` : ''}</span>
                    <button onClick={e => { e.stopPropagation(); removeEntry(editing.empId, editing.day, en.code) }}
                      className="text-current opacity-60 hover:opacity-100 font-bold px-1">✕</button>
                  </div>
                ))}
                <div className="border-t border-line-soft my-1" />
              </>
            )}
            <button onClick={e => { e.stopPropagation(); clearCell(editing.empId, editing.day) }}
              className="w-full text-left px-3 py-1 text-xs hover:bg-pill text-ink-faint">
              {t('grid.clear_cell', locale)}
            </button>
            <div className="border-t border-line-soft my-1" />
            {CODE_OPTIONS.map(opt => {
              const label = t(`grid.code.${opt.code}`, locale)
              const isSelected = selectedCodes.has(opt.code)
              if (opt.needsHours && pendingCode === opt.code) {
                return (
                  <div key={opt.code} className="px-3 py-2 bg-pill">
                    <div className="text-xs text-ink-muted mb-1.5">{label}</div>
                    <div className="flex gap-1 items-center">
                      <input type="number" value={pendingHours}
                        onChange={e => setPendingHours(e.target.value)}
                        placeholder={t('grid.hours_placeholder', locale)}
                        min="0.5" max="24" step="0.5" autoFocus
                        className="w-16 border rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ink"
                        onClick={e => e.stopPropagation()} />
                      <span className="text-xs text-ink-muted">{t('grid.hours', locale)}</span>
                      <button disabled={!pendingHours}
                        onClick={e => { e.stopPropagation(); if (pendingHours) addEntry(editing.empId, editing.day, opt.code, parseFloat(pendingHours)) }}
                        className="bg-pill0 disabled:bg-line text-white px-2 py-0.5 rounded text-xs ml-1">
                        {t('grid.confirm', locale)}
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
                    else addEntry(editing.empId, editing.day, opt.code)
                  }}
                  className={`w-full text-left px-3 py-1 text-xs hover:opacity-80 flex items-center justify-between ${CODE_COLOR[opt.code]} ${isSelected ? 'ring-1 ring-inset ring-black/20' : ''}`}>
                  <span>{label}</span>
                  {isSelected && <span className="font-bold">✓</span>}
                </button>
              )
            })}
          </div>
        )
      })()}

      {/* ⋮ dropdown — fixed overlay, never clipped */}
      {managingEmp && menuPos && (
        <div ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          className="bg-white border border-line rounded-lg shadow-xl min-w-44 py-1">
          <div className="px-3 py-1.5 text-xs text-ink-muted border-b font-medium">{managingEmp.name}</div>
          <button onClick={() => openDateModal('start_date')}
            className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:bg-pill">
            {t('grid.menu.edit_start', locale)}{managingEmp.start_date ? ` (${fmtDate(managingEmp.start_date)})` : ''}
          </button>
          <button onClick={() => {
            setPosValue(managingEmp.position ?? '')
            setPosModal({ emp: managingEmp })
            setManagingEmp(null); setMenuPos(null)
          }}
            className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:bg-pill">
            {t('grid.menu.edit_position', locale)}{managingEmp.position ? ` (${managingEmp.position})` : ''}
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
            className="w-full text-left px-3 py-2 text-xs text-amber-600 hover:bg-pill">
            {t('grid.menu.set_probation', locale)}{managingEmp.probation_start ? ' ✓' : ''}
          </button>
          {managingEmp.end_date ? (
            <>
              <button onClick={() => openDateModal('end_date')}
                className="w-full text-left px-3 py-2 text-xs text-amber-600 hover:bg-pill">
                {t('grid.menu.edit_end', locale)} ({fmtDate(managingEmp.end_date!)})
              </button>
              <div className="border-t border-line-soft my-1" />
              <button onClick={() => openDateModal('reactivate')}
                className="w-full text-left px-3 py-2 text-xs text-signal-pos hover:bg-pill">
                {t('grid.menu.reactivate', locale)}
              </button>
            </>
          ) : (
            <>
              <div className="border-t border-line-soft my-1" />
              <button onClick={() => openDateModal('end_date')}
                className="w-full text-left px-3 py-2 text-xs text-signal-neg hover:bg-pill">
                {t('grid.menu.terminate', locale)}
              </button>
            </>
          )}
        </div>
      )}

      {/* Date edit / reactivate modal */}
      {dateModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setDateModal(null)}>
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            {dateModal.field === 'reactivate' ? (
              <>
                <h3 className="font-semibold text-ink mb-1">{t('grid.reactivate.title', locale)}</h3>
                <p className="text-sm text-ink-muted mb-6">
                  <strong className="text-ink">{dateModal.emp.name}</strong>
                  <br /><span className="text-xs">{t('grid.reactivate.note', locale)}</span>
                </p>
                <div className="flex gap-2">
                  <button onClick={confirmDateModal} disabled={saving}
                    className="flex-1 bg-signal-pos disabled:bg-line text-white rounded-lg py-2 text-sm font-medium">
                    {t('grid.menu.reactivate', locale)}
                  </button>
                  <button onClick={() => setDateModal(null)}
                    className="flex-1 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                    {t('common.cancel', locale)}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-ink mb-1">
                  {dateModal.field === 'start_date'
                    ? t('grid.date_modal.start_title', locale)
                    : t('grid.date_modal.end_title', locale)}
                </h3>
                <p className="text-sm text-ink font-medium mb-1">{dateModal.emp.name}</p>
                <p className="text-xs text-ink-faint mb-4">
                  {dateModal.field === 'start_date'
                    ? t('grid.date_modal.start_note', locale)
                    : t('grid.date_modal.end_note', locale)}
                </p>
                <div className="mb-4">
                  <label className="text-xs text-ink-muted mb-1 block">
                    {dateModal.field === 'start_date'
                      ? t('grid.date_modal.start_label', locale)
                      : t('grid.date_modal.end_label', locale)}
                  </label>
                  <input type="date" value={dateValue}
                    onChange={e => setDateValue(e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                      dateModal.field === 'end_date' ? 'focus:ring-signal-neg' : 'focus:ring-ink'
                    }`} />
                  {dateModal.field === 'start_date' && (
                    <button onClick={() => setDateValue('')}
                      className="mt-1 text-xs text-ink-faint hover:text-ink-muted">
                      {t('grid.date_modal.clear', locale)}
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={confirmDateModal}
                    disabled={(dateModal.field === 'end_date' && !dateValue) || saving}
                    className={`flex-1 disabled:bg-line text-white rounded-lg py-2 text-sm font-medium ${
                      dateModal.field === 'end_date' ? 'bg-signal-neg' : 'bg-ink'
                    }`}>
                    {t('common.save', locale)}
                  </button>
                  <button onClick={() => setDateModal(null)}
                    className="flex-1 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                    {t('common.cancel', locale)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add employee modal */}
      {addingToTeam && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setAddingToTeam(null)}>
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-ink mb-1">{t('grid.add_emp.title', locale)}</h3>
            <div className="text-xs text-ink-muted bg-pill px-3 py-1.5 rounded-lg mb-4">{addingToTeam}</div>
            <div className="space-y-3">
              <input placeholder={t('grid.add_emp.name_ph', locale)} value={newEmp.name}
                onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
              <input placeholder={t('grid.add_emp.position_ph', locale)} value={newEmp.position}
                onChange={e => setNewEmp(p => ({ ...p, position: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
              <div>
                <label className="text-xs text-ink-muted mb-1 block">{t('grid.add_emp.start_date', locale)}</label>
                <input type="date" value={newEmp.start_date}
                  onChange={e => setNewEmp(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
              </div>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-xs text-ink-muted mb-1 block">{t('grid.add_emp.annual_leave', locale)}</label>
                  <input type="number" value={newEmp.vacation_allowance}
                    onChange={e => setNewEmp(p => ({ ...p, vacation_allowance: +e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
                </div>
                <label className="flex items-center gap-1.5 text-sm text-ink-muted cursor-pointer pb-2">
                  <input type="checkbox" checked={newEmp.uses_accrual}
                    onChange={e => setNewEmp(p => ({ ...p, uses_accrual: e.target.checked }))} className="rounded" />
                  {t('grid.add_emp.accrual', locale)}
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleAddEmployee} disabled={!newEmp.name.trim()}
                className="flex-1 bg-ink disabled:bg-line text-white rounded-lg py-2 text-sm font-medium">
                {t('common.add', locale)}
              </button>
              <button onClick={() => setAddingToTeam(null)}
                className="flex-1 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Position modal */}
      {posModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
             onClick={e => { if (e.target === e.currentTarget) setPosModal(null) }}>
          <div className="bg-white rounded-xl p-6 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-ink mb-1">{t('grid.pos_modal.title', locale)}</h3>
            <p className="text-sm text-ink-muted mb-3">{posModal.emp.name}</p>
            <input
              type="text" value={posValue} autoFocus
              onChange={e => setPosValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') document.getElementById('pos-save')?.click() }}
              placeholder="e.g. Manager, Driver, Coordinator"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink mb-4"
            />
            <div className="flex gap-2">
              <button id="pos-save"
                onClick={async () => {
                  await hrFetch(`/api/hr/employees/${posModal.emp.id}`, { method: 'PATCH', body: JSON.stringify({ position: posValue || null }) })
                  setEmployees(prev => prev.map(e =>
                    e.id === posModal.emp.id ? { ...e, position: posValue || null } : e
                  ))
                  setPosModal(null)
                }}
                className="flex-1 bg-ink text-white rounded-lg py-2 text-sm font-medium hover:bg-ink/90">
                {t('common.save', locale)}
              </button>
              <button onClick={() => setPosModal(null)}
                className="flex-1 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Probation modal */}
      {probModal && (() => {
        const emp = probModal.emp
        const saveProb = async () => {
          const finalStart = probStartMode === 'hire' ? (emp.start_date ?? null) : (probStartVal || null)
          const finalEnd   = probEndVal || null
          await hrFetch(`/api/hr/employees/${emp.id}`, { method: 'PATCH', body: JSON.stringify({ probation_start: finalStart, probation_end: finalEnd }) })
          setEmployees(prev => prev.map(e =>
            e.id === emp.id ? { ...e, probation_start: finalStart ?? undefined, probation_end: finalEnd ?? undefined } : e
          ))
          setProbModal(null)
        }
        const deleteProb = async () => {
          await hrFetch(`/api/hr/employees/${emp.id}`, { method: 'PATCH', body: JSON.stringify({ probation_start: null, probation_end: null }) })
          setEmployees(prev => prev.map(e =>
            e.id === emp.id ? { ...e, probation_start: undefined, probation_end: undefined } : e
          ))
          setProbModal(null)
        }
        return (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
               onClick={e => { if (e.target === e.currentTarget) setProbModal(null) }}>
            <div className="bg-white rounded-xl p-6 w-80 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="font-semibold text-ink">{t('grid.menu.set_probation', locale)} — {emp.name}</h3>

              <div className="space-y-1.5">
                <p className="text-xs text-ink-muted font-medium">{t('grid.prob_modal.start', locale)}</p>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode === 'hire' ? 'bg-ink text-white border-ink' : 'border-line text-ink-muted hover:bg-pill'}`}
                    onClick={() => {
                      setProbStartMode('hire')
                      if (probEndMode === '90d' && emp.start_date) {
                        const d = new Date(emp.start_date); d.setDate(d.getDate() + 90)
                        setProbEndVal(d.toISOString().split('T')[0])
                      }
                    }}>{t('grid.prob_modal.hire_btn', locale)}</button>
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode === 'custom' ? 'bg-ink text-white border-ink' : 'border-line text-ink-muted hover:bg-pill'}`}
                    onClick={() => setProbStartMode('custom')}>{t('grid.prob_modal.custom', locale)}</button>
                </div>
                {probStartMode === 'hire'
                  ? <p className="text-xs text-ink-faint">
                      {t('grid.prob_modal.hire_label', locale)} {emp.start_date ?? t('common.not_set', locale)}
                    </p>
                  : <input type="date" value={probStartVal}
                      onChange={e => {
                        setProbStartVal(e.target.value)
                        if (probEndMode === '90d' && e.target.value) {
                          const d = new Date(e.target.value); d.setDate(d.getDate() + 90)
                          setProbEndVal(d.toISOString().split('T')[0])
                        }
                      }}
                      className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
                }
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-ink-muted font-medium">{t('grid.prob_modal.end', locale)}</p>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode === '90d' ? 'bg-ink text-white border-ink' : 'border-line text-ink-muted hover:bg-pill'}`}
                    onClick={() => {
                      setProbEndMode('90d')
                      const ref = probStartMode === 'hire' ? emp.start_date : probStartVal
                      if (ref) { const d = new Date(ref); d.setDate(d.getDate() + 90); setProbEndVal(d.toISOString().split('T')[0]) }
                    }}>{t('grid.prob_modal.plus90', locale)}</button>
                  <button
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode === 'custom' ? 'bg-ink text-white border-ink' : 'border-line text-ink-muted hover:bg-pill'}`}
                    onClick={() => setProbEndMode('custom')}>{t('grid.prob_modal.custom', locale)}</button>
                </div>
                <input type="date" value={probEndVal}
                  readOnly={probEndMode === '90d'}
                  onChange={e => { if (probEndMode === 'custom') setProbEndVal(e.target.value) }}
                  className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink ${probEndMode === '90d' ? 'bg-pill text-ink-muted' : ''}`} />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={saveProb}
                  className="flex-1 bg-ink text-white rounded-lg py-2 text-sm font-medium hover:bg-ink/90">
                  {t('common.save', locale)}
                </button>
                <button onClick={() => setProbModal(null)}
                  className="px-4 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                  {t('common.cancel', locale)}
                </button>
                {emp.probation_start && (
                  <button onClick={deleteProb}
                    className="px-4 border border-line text-signal-neg rounded-lg py-2 text-sm hover:bg-pill">
                    {t('common.delete', locale)}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Right-click note/flag context menu */}
      {noteCtx && (() => {
        const flags = flagMap[`${noteCtx.empId}_${noteCtx.day}`]
        const openFlag = (type: FlagType) => {
          const existing = flags?.[type]
          setFlagTime(existing?.time ?? '')
          setFlagReason(existing?.reason ?? '')
          setFlagModal({ empId: noteCtx.empId, day: noteCtx.day, type })
          setNoteCtx(null)
        }
        return (
          <div ref={noteCtxRef}
            style={{ position: 'fixed', top: noteCtx.y, left: noteCtx.x, zIndex: 9999 }}
            className="bg-white border border-line rounded-lg shadow-xl py-1 min-w-40">
            <button onClick={() => openFlag('late')}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-pill">
              {flags?.late ? t('grid.flag.late.edit', locale) : t('grid.flag.late.mark', locale)}
            </button>
            {flags?.late && (
              <button onClick={() => deleteFlag(noteCtx.empId, noteCtx.day, 'late')}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-pill text-signal-neg">
                {t('grid.flag.late.delete', locale)}
              </button>
            )}
            <button onClick={() => openFlag('early_leave')}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-pill">
              {flags?.early_leave ? t('grid.flag.early.edit', locale) : t('grid.flag.early.mark', locale)}
            </button>
            {flags?.early_leave && (
              <button onClick={() => deleteFlag(noteCtx.empId, noteCtx.day, 'early_leave')}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-pill text-signal-neg">
                {t('grid.flag.early.delete', locale)}
              </button>
            )}
            <div className="border-t border-line-soft my-1" />
            {noteMap[`${noteCtx.empId}_${noteCtx.day}`] ? (
              <>
                <button
                  onClick={() => {
                    const existing = noteMap[`${noteCtx.empId}_${noteCtx.day}`]
                    setNoteText(existing)
                    setNoteModal({ empId: noteCtx.empId, day: noteCtx.day, existing })
                    setNoteCtx(null)
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-pill">
                  {t('grid.note.edit', locale)}
                </button>
                <button
                  onClick={() => deleteNote(noteCtx.empId, noteCtx.day)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-pill text-signal-neg">
                  {t('grid.note.delete', locale)}
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setNoteText('')
                  setNoteModal({ empId: noteCtx.empId, day: noteCtx.day, existing: '' })
                  setNoteCtx(null)
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-pill">
                {t('grid.note.add', locale)}
              </button>
            )}
          </div>
        )
      })()}

      {/* Note edit modal */}
      {noteModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setNoteModal(null) }}>
          <div className="bg-white rounded-xl p-5 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-ink mb-1 text-sm">
              {noteModal.existing ? t('grid.note.edit', locale) : t('grid.note.add', locale)}
            </h3>
            <p className="text-xs text-ink-faint mb-3">
              {employees.find(e => e.id === noteModal.empId)?.name} · {year}-{pad(month)}-{pad(noteModal.day)}
            </p>
            <textarea
              autoFocus
              rows={3}
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder={t('grid.note.placeholder', locale)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink resize-none mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { if (noteText.trim()) saveNote(noteModal.empId, noteModal.day, noteText.trim()) }}
                disabled={!noteText.trim()}
                className="flex-1 bg-ink disabled:bg-line text-white rounded-lg py-2 text-sm font-medium">
                {t('common.save', locale)}
              </button>
              <button onClick={() => setNoteModal(null)}
                className="flex-1 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Late / early-leave flag modal */}
      {flagModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setFlagModal(null) }}>
          <div className="bg-white rounded-xl p-5 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-ink mb-1 text-sm">
              {flagModal.type === 'late' ? t('grid.flag.title_late', locale) : t('grid.flag.title_early', locale)}
            </h3>
            <p className="text-xs text-ink-faint mb-3">
              {employees.find(e => e.id === flagModal.empId)?.name} · {year}-{pad(month)}-{pad(flagModal.day)}
            </p>
            <label className="text-xs text-ink-muted mb-1 block">{t('grid.flag.time_label', locale)}</label>
            <input
              type="time"
              value={flagTime}
              onChange={e => setFlagTime(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink mb-3"
            />
            <label className="text-xs text-ink-muted mb-1 block">{t('grid.flag.reason_label', locale)}</label>
            <textarea
              rows={3}
              value={flagReason}
              onChange={e => setFlagReason(e.target.value)}
              placeholder={t('grid.flag.reason_ph', locale)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink resize-none mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => saveFlag(flagModal.empId, flagModal.day, flagModal.type, flagTime, flagReason)}
                disabled={!flagTime && !flagReason.trim()}
                className="flex-1 bg-ink disabled:bg-line text-white rounded-lg py-2 text-sm font-medium">
                {t('common.save', locale)}
              </button>
              <button onClick={() => setFlagModal(null)}
                className="flex-1 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Column (day) menu */}
      {colMenu && (
        <div ref={colMenuRef}
          style={{ position: 'fixed', top: colMenu.top, left: colMenu.left, zIndex: 9999 }}
          className="bg-white border border-line rounded-lg shadow-xl py-1 min-w-40">
          <div className="px-3 py-1.5 text-xs text-ink-muted border-b font-medium">
            {year}-{pad(month)}-{pad(colMenu.day)}
          </div>
          <button
            onClick={() => setColumnHoliday(colMenu.day)}
            className="w-full text-left px-3 py-2 text-xs text-signal-neg font-medium hover:bg-pill">
            Set Holiday (B) for All
          </button>
          <button
            onClick={() => clearColumn(colMenu.day)}
            className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:bg-pill">
            Clear All This Day
          </button>
        </div>
      )}

      {saving && (
        <div className="fixed bottom-4 right-4 bg-ink text-white text-xs px-3 py-2 rounded-lg shadow">
          {t('grid.saving', locale)}
        </div>
      )}
    </>
  )
}
