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
