'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import AttendanceGrid from '../components/AttendanceGrid'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const COMPANY_MAP: Record<string, string> = { afs: 'AFS', tnt: 'TNT', zfs: 'ZFS' }

type TermEmp = { id: string; name: string; team: string; position: string; start_date?: string; end_date?: string }
type DateEdit = { emp: TermEmp; field: 'start_date' | 'end_date' }

function fmtDate(iso?: string) {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${+m}. ${+d}.`
}

export default function CompanyAttendancePage() {
  const { company } = useParams() as { company: string }
  const { locale } = useLocale()
  const [companyId,      setCompanyId]      = useState<string | null>(null)
  const [gridKey,        setGridKey]        = useState(0)
  const [showTerminated, setShowTerminated] = useState(false)
  const [terminated,     setTerminated]     = useState<TermEmp[]>([])
  const [dateEdit,       setDateEdit]       = useState<DateEdit | null>(null)
  const [dateValue,      setDateValue]      = useState('')
  const [saving,         setSaving]         = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailDates,     setEmailDates]     = useState<Set<number>>(new Set())
  const [emailTo,        setEmailTo]        = useState('')
  const [emailEntries,   setEmailEntries]   = useState<Array<{ date: string; employee_id: string; leave_code: string; hours: number | null }>>([])
  const [emailEmps,      setEmailEmps]      = useState<Array<{ id: string; name: string }>>([])
  const [emailLoading,   setEmailLoading]   = useState(false)
  const now = new Date()
  const [year,           setYear]           = useState(now.getFullYear())
  const [month,          setMonth]          = useState(now.getMonth() + 1)
  const [showPicker,     setShowPicker]     = useState(false)
  const [pickerYear,     setPickerYear]     = useState(now.getFullYear())
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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

  const padFn = (n: number) => String(n).padStart(2, '0')

  async function loadEmailData() {
    if (!companyId) return
    setEmailLoading(true)
    const daysInMo = new Date(year, month, 0).getDate()
    const first = `${year}-${padFn(month)}-01`
    const last  = `${year}-${padFn(month)}-${padFn(daysInMo)}`
    const { data: emps } = await supabase.from('employees')
      .select('id,name').eq('company_id', companyId)
      .or(`end_date.is.null,end_date.gte.${first}`)
      .or(`start_date.is.null,start_date.lte.${last}`)
      .order('name')
    const ids = (emps ?? []).map(e => e.id)
    const { data: entries } = ids.length
      ? await supabase.from('leave_entries')
          .select('employee_id,date,leave_code,hours')
          .in('employee_id', ids).gte('date', first).lte('date', last)
      : { data: [] as { employee_id: string; date: string; leave_code: string; hours: number | null }[] }
    setEmailEmps(emps ?? [])
    setEmailEntries(entries ?? [])
    setEmailLoading(false)
  }

  function buildEmailBody() {
    const compLabel = COMPANY_MAP[company] ?? company.toUpperCase()
    const selected  = Array.from(emailDates).sort((a, b) => a - b)
    if (!selected.length) return { subject: '', body: '' }

    const codeDesc = (code: string, hours: number | null) => {
      const KO: Record<string, string> = {
        L:'연차', L1:'오전 반차', L2:'오후 반차', L3:'시간 연차',
        S:'병가', S1:'오전 반차 병가', S2:'오후 반차 병가', S3:'시간 병가',
        W:'재택', W1:'오전 반차 재택', W2:'오후 반차 재택', W3:'시간 재택',
        T:'Unpaid', T1:'Unpaid 오전', T2:'Unpaid 오후', T3:'Unpaid 시간',
        B:'공휴일', O:'초과근무',
      }
      const EN: Record<string, string> = {
        L:'Leave', L1:'AM Half Leave', L2:'PM Half Leave', L3:'Hourly Leave',
        S:'Sick', S1:'AM Half Sick', S2:'PM Half Sick', S3:'Hourly Sick',
        W:'WFH', W1:'AM Half WFH', W2:'PM Half WFH', W3:'Hourly WFH',
        T:'Unpaid', T1:'Unpaid AM', T2:'Unpaid PM', T3:'Unpaid Hourly',
        B:'Holiday', O:'Overtime',
      }
      const m = locale === 'ko' ? KO : EN
      return hours ? `${m[code] ?? code} (${code}, ${hours}h)` : `${m[code] ?? code} (${code})`
    }

    const empMap  = Object.fromEntries(emailEmps.map(e => [e.id, e.name]))
    const DOW_KO  = ['일', '월', '화', '수', '목', '금', '토']
    const DOW_EN  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayLbl  = (d: number) => {
      const dow = new Date(year, month - 1, d).getDay()
      return locale === 'ko'
        ? `${month}월 ${d}일 (${DOW_KO[dow]})`
        : `${t(`month.${month}`, 'en')} ${d} (${DOW_EN[dow]})`
    }

    const lines: string[] = [
      locale === 'ko'
        ? `${compLabel} 근태 리포트 — ${year}년 ${month}월`
        : `${compLabel} Attendance Report — ${t(`month.${month}`, 'en')} ${year}`,
      '',
    ]
    for (const day of selected) {
      const ds   = `${year}-${padFn(month)}-${padFn(day)}`
      const rows = emailEntries.filter(e => e.date === ds)
        .map(e => ({ name: empMap[e.employee_id] ?? '?', code: e.leave_code, hours: e.hours }))
        .sort((a, b) => a.name.localeCompare(b.name))
      lines.push(`■ ${dayLbl(day)}`)
      if (!rows.length) lines.push(`  ${locale === 'ko' ? '(기록 없음)' : '(No entries)'}`)
      else rows.forEach(r => lines.push(`  • ${r.name} — ${codeDesc(r.code, r.hours)}`))
      lines.push('')
    }
    lines.push('---', locale === 'ko' ? 'AFS Admin에서 생성됨' : 'Generated from AFS Admin')

    const daysStr = selected.map(d => locale === 'ko' ? `${d}일` : String(d)).join(', ')
    const subject = locale === 'ko'
      ? `[${compLabel}] ${year}년 ${month}월 근태 리포트 (${daysStr})`
      : `[${compLabel}] ${t(`month.${month}`, 'en')} ${year} Attendance Report (${daysStr})`
    return { subject, body: lines.join('\n') }
  }

  function openMailto() {
    const { subject, body } = buildEmailBody()
    window.open(
      `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      '_blank'
    )
  }

  function shiftMonth(delta: number) {
    let m = month + delta, y = year
    if (m < 1)  { m = 12; y-- }
    if (m > 12) { m = 1;  y++ }
    setMonth(m); setYear(y)
  }

  const monthLabel = locale === 'ko'
    ? `${year}년 ${t(`month.${month}`, locale)}`
    : `${t(`month.${month}`, locale)} ${year}`

  const LEGEND = [
    { code: 'L/L1/L2', label: t('hr.legend.leave', locale),        color: 'bg-green-100 text-green-800'  },
    { code: 'L3',       label: t('hr.legend.hourly_leave', locale), color: 'bg-green-50  text-green-600'  },
    { code: 'S/S1/S2', label: t('hr.legend.sick', locale),         color: 'bg-red-100   text-red-800'    },
    { code: 'W',        label: t('hr.legend.wfh', locale),          color: 'bg-blue-100  text-blue-800'   },
    { code: 'T',        label: 'Unpaid',                            color: 'bg-gray-200  text-gray-700'   },
    { code: 'B',        label: t('hr.legend.holiday', locale),      color: 'bg-gray-100  text-gray-500'   },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-5">
        <Link href="/hr" className="text-sm text-gray-400 hover:text-gray-700">← HR</Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {COMPANY_MAP[company]} {t('hr.attendance.management', locale)}
        </h1>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => shiftMonth(-1)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">◀</button>
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => { setPickerYear(year); setShowPicker(p => !p) }}
              className="text-base font-semibold w-32 text-center px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              {monthLabel}
            </button>
            {showPicker && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-xl shadow-xl p-3 z-50 w-56">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setPickerYear(y => y - 1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-xs font-bold">◀</button>
                  <span className="text-sm font-bold text-gray-800">{pickerYear}</span>
                  <button onClick={() => setPickerYear(y => y + 1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-xs font-bold">▶</button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <button key={m}
                      onClick={() => { setYear(pickerYear); setMonth(m); setShowPicker(false) }}
                      className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${
                        pickerYear === year && m === month
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-blue-50 text-gray-700'
                      }`}>
                      {t(`month.${m}`, locale)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => shiftMonth(1)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">▶</button>
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); setShowPicker(false) }}
            className="px-3 py-1.5 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">
            {t('hr.attendance.this_month', locale)}
          </button>
          <button
            onClick={() => { setEmailDates(new Set()); setEmailTo(''); setShowEmailModal(true); loadEmailData() }}
            disabled={!companyId}
            className="px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap">
            📧 {locale === 'ko' ? '리포트' : 'Report'}
          </button>
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
        : <div className="text-center py-16 text-gray-400">{t('common.loading', locale)}</div>
      }

      {/* Terminated employees */}
      <div className="mt-8">
        <button onClick={() => setShowTerminated(!showTerminated)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 py-2">
          <span className={`transition-transform inline-block ${showTerminated ? 'rotate-90' : ''}`}>▶</span>
          {t('hr.terminated.title', locale)}
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
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">{t('hr.terminated.name', locale)}</th>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">{t('hr.terminated.team_pos', locale)}</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">{t('hr.terminated.start_date', locale)}</th>
                    <th className="text-center px-4 py-2 text-gray-600 font-medium">{t('hr.terminated.end_date', locale)}</th>
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
                          {t('hr.terminated.reactivate', locale)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">{t('hr.terminated.empty', locale)}</div>
            )}
          </div>
        )}
      </div>

      {/* Email report modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowEmailModal(false) }}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-4 text-base">
              📧 {locale === 'ko'
                ? `${COMPANY_MAP[company]} 근태 리포트 전송`
                : `Send ${COMPANY_MAP[company]} Attendance Report`}
            </h3>

            {emailLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">{t('common.loading', locale)}</div>
            ) : (
              <>
                {/* Date grid */}
                <div className="mb-5">
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    {locale === 'ko' ? '날짜 선택 (복수 선택 가능)' : 'Select dates (multi-select)'}
                  </p>
                  <div className="grid grid-cols-7 gap-1">
                    {(locale === 'ko'
                      ? ['일', '월', '화', '수', '목', '금', '토']
                      : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
                    ).map(d => (
                      <div key={d} className="text-center text-xs text-gray-400 py-0.5 font-medium">{d}</div>
                    ))}
                    {Array.from({ length: new Date(year, month - 1, 1).getDay() }).map((_, i) => (
                      <div key={`gap-${i}`} />
                    ))}
                    {Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1).map(day => {
                      const ds      = `${year}-${padFn(month)}-${padFn(day)}`
                      const hasEntry = emailEntries.some(e => e.date === ds)
                      const isSel   = emailDates.has(day)
                      const dow     = new Date(year, month - 1, day).getDay()
                      return (
                        <button key={day}
                          onClick={() => setEmailDates(prev => {
                            const next = new Set(prev)
                            if (next.has(day)) next.delete(day); else next.add(day)
                            return next
                          })}
                          className={`relative py-1.5 rounded-lg text-xs font-medium transition-colors
                            ${isSel
                              ? 'bg-blue-600 text-white'
                              : hasEntry
                                ? dow === 0 ? 'bg-red-50 text-red-600 hover:bg-blue-100'
                                : dow === 6 ? 'bg-sky-50 text-sky-600 hover:bg-blue-100'
                                :             'bg-gray-50 text-gray-700 hover:bg-blue-100'
                                : dow === 0 ? 'text-red-300 hover:bg-red-50'
                                : dow === 6 ? 'text-sky-300 hover:bg-sky-50'
                                :             'text-gray-300 hover:bg-gray-50'
                            }`}>
                          {day}
                          {hasEntry && !isSel && (
                            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-500" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      {locale === 'ko' ? '기록 있음' : 'Has entries'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />
                      {locale === 'ko' ? '선택됨' : 'Selected'}
                    </span>
                  </div>
                </div>

                {/* Recipient */}
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {locale === 'ko' ? '수신자 이메일' : 'Recipient Email'}
                  </label>
                  <input type="email" value={emailTo}
                    onChange={e => setEmailTo(e.target.value)}
                    placeholder="example@company.com"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>

                {/* Preview */}
                {emailDates.size > 0 ? (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-500 mb-1.5">
                      {locale === 'ko' ? '미리보기' : 'Preview'}
                    </p>
                    <pre className="bg-gray-50 border rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-44 overflow-y-auto font-mono leading-relaxed">
                      {buildEmailBody().body}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center mb-4">
                    {locale === 'ko' ? '날짜를 선택하면 미리보기가 표시됩니다.' : 'Select dates to preview.'}
                  </p>
                )}

                <div className="flex gap-2">
                  <button onClick={openMailto}
                    disabled={emailDates.size === 0 || !emailTo.trim()}
                    className="flex-1 bg-blue-600 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 transition-colors">
                    📧 {locale === 'ko' ? '이메일 열기' : 'Open Email Client'}
                  </button>
                  <button onClick={() => setShowEmailModal(false)}
                    className="px-5 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                    {t('common.cancel', locale)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Date edit modal */}
      {dateEdit && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setDateEdit(null)}>
          <div className="bg-white rounded-xl p-6 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">
              {dateEdit.field === 'start_date'
                ? t('hr.date_edit.start', locale)
                : t('hr.date_edit.end', locale)}
            </h3>
            <p className="text-sm text-gray-800 font-medium mb-3">{dateEdit.emp.name}</p>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">
                {dateEdit.field === 'start_date'
                  ? t('hr.terminated.start_date', locale)
                  : t('hr.terminated.end_date', locale)}
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
                {t('common.save', locale)}
              </button>
              <button onClick={() => setDateEdit(null)}
                className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
