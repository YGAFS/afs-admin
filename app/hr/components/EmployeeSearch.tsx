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
  probation_start?: string; probation_end?: string
  companies: { id: string; name: string }
}
type Summary = { vac: number; sick: number; wfh: number; toil: number; other: number }
type Monthly = Record<number, Summary>

const MO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

function calcDays(code: string) { return ['L1','L2','S1','S2'].includes(code) ? 0.5 : 1 }
function calcAccrued(emp: { vacation_allowance: number; probation_end?: string }): number {
  const today = new Date()
  if (emp.probation_end) {
    const pe = new Date(emp.probation_end)
    if (pe > today) return 0
    return Math.min(((today.getTime() - pe.getTime()) / 86400000 / 365) * emp.vacation_allowance, emp.vacation_allowance)
  }
  const soy = new Date(today.getFullYear(), 0, 1)
  return Math.min(((today.getTime() - soy.getTime()) / 86400000 / 365) * emp.vacation_allowance, emp.vacation_allowance)
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
  const [posEdit,      setPosEdit]      = useState(false)
  const [posValue,     setPosValue]     = useState('')
  const [probModal,    setProbModal]    = useState(false)
  const [probStartMode,setProbStartMode]= useState<'hire'|'custom'>('hire')
  const [probStartVal, setProbStartVal] = useState('')
  const [probEndMode,  setProbEndMode]  = useState<'90d'|'custom'>('90d')
  const [probEndVal,   setProbEndVal]   = useState('')

  useEffect(() => {
    supabase.from('companies').select('id,name').order('name')
      .then(({ data }) => {
        setComps(data ?? [])
        if (data?.length) setNewEmp(p => ({ ...p, company_id: data[0].id }))
      })
  }, [])

  useEffect(() => {
    let q = supabase.from('employees')
      .select('id,name,team,manager_name,vacation_allowance,position,is_exempt,uses_accrual,is_active,start_date,end_date,probation_start,probation_end,companies(id,name)')
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
      const mo = parseInt(e.date.split('-')[1], 10)
      const d  = calcDays(e.leave_code)
      if      (['L','L1','L2','L3'].includes(e.leave_code)) { s.vac  += d; m[mo].vac  += d }
      else if (['S','S1','S2','S3'].includes(e.leave_code)) { s.sick += d; m[mo].sick += d }
      else if (e.leave_code === 'W')                        { s.wfh  += 1; m[mo].wfh  += 1 }
      else if (['T','T1','T2','T3'].includes(e.leave_code)) { const td = ['T1','T2'].includes(e.leave_code) ? 0.5 : 1; s.toil += td; m[mo].toil += td }
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
      .select('id,name,team,manager_name,vacation_allowance,position,is_exempt,uses_accrual,is_active,start_date,end_date,probation_start,probation_end,companies(id,name)')
      .eq('is_active', !showInactive).order('name')
    if (compFilter !== 'all') q = q.eq('company_id', compFilter)
    q.then(({ data }) => setEmps((data as Employee[]) ?? []))
  }

  function getVacStats(emp: Employee, vacUsed: number) {
    if (emp.is_exempt) return null
    if (emp.uses_accrual) {
      const accrued   = Math.round(calcAccrued(emp) * 10) / 10
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

      {/* 재직 / 퇴사자 탭 */}
      <div className="flex border-b-2 border-gray-200 mb-4">
        <button onClick={() => { setShowInactive(false); setSel(null) }}
          className={`px-5 py-2.5 text-sm font-bold border-b-2 -mb-0.5 transition-colors ${
            !showInactive
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}>
          재직중
        </button>
        <button onClick={() => { setShowInactive(true); setSel(null) }}
          className={`px-5 py-2.5 text-sm font-bold border-b-2 -mb-0.5 transition-colors ${
            showInactive
              ? 'border-red-500 text-red-500'
              : 'border-transparent text-gray-400 hover:text-gray-600'
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
                        }} className="text-xs text-white bg-blue-600 px-2 py-0.5 rounded hover:bg-blue-700">저장</button>
                        <button onClick={() => setPosEdit(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setPosValue(selected.position ?? ''); setPosEdit(true) }}
                        className="text-sm text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded font-medium hover:border-blue-400 hover:bg-blue-50 transition-colors group">
                        {selected.position || <span className="text-gray-400 text-xs">+ 직급 추가</span>}
                        <span className="ml-1 text-gray-300 group-hover:text-blue-400 text-xs">✎</span>
                      </button>
                    )}
                    {!selected.is_active && (
                      <span className="text-xs bg-red-100 border border-red-200 text-red-600 px-2 py-0.5 rounded font-semibold">퇴사</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1 font-medium">
                    {(selected.companies as any)?.name} · {selected.team} · {selected.manager_name || '매니저 없음'}
                  </p>

                  {/* 수습 기간 */}
                  {(() => {
                    const t  = todayIso()
                    const on = !!(selected.probation_start &&
                      selected.probation_start <= t &&
                      (!selected.probation_end || selected.probation_end >= t))
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
                        <span className="text-xs text-gray-500 font-medium">수습</span>
                        {selected.probation_start ? (
                          <>
                            <span className="text-xs font-medium text-gray-700">
                              {fmtDateLong(selected.probation_start)}
                              {selected.probation_end ? ` ~ ${fmtDateLong(selected.probation_end)}` : ' ~ 미설정'}
                            </span>
                            {on
                              ? <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-semibold">수습중</span>
                              : <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">완료</span>
                            }
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">미설정</span>
                        )}
                        <button onClick={openProbEdit}
                          className="text-gray-300 hover:text-blue-500 text-xs transition-colors">✎</button>
                      </div>
                    )
                  })()}

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

      {/* 수습 기간 편집 모달 */}
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
              <h3 className="font-bold text-gray-900">수습 기간 — {selected.name}</h3>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-600">수습 시작일</p>
                <div className="flex gap-2">
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode==='hire'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbStartMode('hire')
                      if (probEndMode==='90d' && selected.start_date) {
                        const d=new Date(selected.start_date); d.setDate(d.getDate()+90)
                        setProbEndVal(d.toISOString().split('T')[0])
                      }
                    }}>입사일</button>
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probStartMode==='custom'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbStartMode('custom')}>직접 입력</button>
                </div>
                {probStartMode==='hire'
                  ? <p className="text-xs text-gray-400">입사일: {selected.start_date ?? '미설정'}</p>
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
                <p className="text-xs font-semibold text-gray-600">수습 종료일</p>
                <div className="flex gap-2">
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode==='90d'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbEndMode('90d')
                      const ref = probStartMode==='hire' ? selected.start_date : probStartVal
                      if (ref) { const d=new Date(ref); d.setDate(d.getDate()+90); setProbEndVal(d.toISOString().split('T')[0]) }
                    }}>+90일</button>
                  <button className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${probEndMode==='custom'?'bg-blue-600 text-white border-blue-600':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbEndMode('custom')}>직접 입력</button>
                </div>
                <input type="date" value={probEndVal} readOnly={probEndMode==='90d'}
                  onChange={e => { if (probEndMode==='custom') setProbEndVal(e.target.value) }}
                  className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${probEndMode==='90d'?'bg-gray-50 text-gray-500':''}`} />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={saveProb}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-2 text-sm font-bold hover:bg-blue-700">저장</button>
                <button onClick={() => setProbModal(false)}
                  className="px-4 border-2 border-gray-200 rounded-xl py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">취소</button>
                {selected.probation_start && (
                  <button onClick={deleteProb}
                    className="px-4 border-2 border-red-200 text-red-600 rounded-xl py-2 text-sm font-semibold hover:bg-red-50">삭제</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
