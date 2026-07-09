'use client'

import { useEffect, useRef, useState } from 'react'
import { sendGraphMail, msalLogout, getMsal, MAIL_SCOPES } from '@/lib/graphMail'
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

type EmailContact = { id: string; name: string; email: string }
const SENDER_KEY    = 'afs_email_senders'
const RECIPIENT_KEY = 'afs_email_recipients'
function loadEmailContacts(key: string): EmailContact[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] }
}
function saveEmailContacts(key: string, list: EmailContact[]) {
  localStorage.setItem(key, JSON.stringify(list))
}

function ContactMgr({ label, contacts, selectedId, onSelect, storageKey, onChange, locale }: {
  label: string; contacts: EmailContact[]; selectedId: string
  onSelect: (id: string) => void; storageKey: string
  onChange: (list: EmailContact[]) => void; locale: string
}) {
  const [open,      setOpen]      = useState(false)
  const [editId,    setEditId]    = useState<string|null>(null)
  const [editName,  setEditName]  = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [newName,   setNewName]   = useState('')
  const [newEmail,  setNewEmail]  = useState('')
  const save = (list: EmailContact[]) => { saveEmailContacts(storageKey, list); onChange(list) }
  const validEmail = (e: string) => e.includes('@') && e.split('@')[1]?.includes('.')
  const editEmailInvalid = editEmail.trim() && !validEmail(editEmail.trim())
  const newEmailInvalid  = newEmail.trim()  && !validEmail(newEmail.trim())
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <button onClick={() => { setOpen(o => !o); setEditId(null); setNewName(''); setNewEmail('') }}
          className="text-xs text-blue-500 hover:text-blue-700">
          {open ? (locale === 'ko' ? '닫기' : 'Close') : (locale === 'ko' ? '+ 추가/관리' : '+ Add/Manage')}
        </button>
      </div>
      <select value={selectedId} onChange={e => onSelect(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
        <option value="">{locale === 'ko' ? '— 선택 —' : '— Select —'}</option>
        {contacts.map(c => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.email}){!validEmail(c.email) ? ' ⚠️' : ''}
          </option>
        ))}
      </select>
      {open && (
        <div className="mt-2 border rounded-lg p-3 bg-gray-50 space-y-2">
          {!contacts.length && (
            <p className="text-xs text-gray-400 text-center py-1">
              {locale === 'ko' ? '등록된 연락처 없음' : 'No contacts yet'}
            </p>
          )}
          {contacts.map(c => (
            <div key={c.id} className={`bg-white rounded-lg p-2 border ${!validEmail(c.email) ? 'border-orange-300' : ''}`}>
              {editId === c.id ? (
                <div className="flex gap-1 flex-wrap">
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    placeholder={locale === 'ko' ? '이름' : 'Name'}
                    className="flex-1 min-w-20 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <div className="flex-1 min-w-32">
                    <input value={editEmail} onChange={e => setEditEmail(e.target.value)}
                      type="email" placeholder="user@company.com"
                      className={`w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 ${editEmailInvalid ? 'border-red-400 focus:ring-red-400' : 'focus:ring-blue-400'}`} />
                    {editEmailInvalid && <p className="text-red-500 text-[10px] mt-0.5">user@domain.com 형식 필요</p>}
                  </div>
                  <button disabled={!editName.trim() || !validEmail(editEmail.trim())}
                    onClick={() => { save(contacts.map(x => x.id === c.id ? { id: c.id, name: editName.trim(), email: editEmail.trim() } : x)); setEditId(null) }}
                    className="text-xs bg-blue-500 disabled:bg-gray-300 text-white px-2 py-1 rounded">
                    {locale === 'ko' ? '저장' : 'Save'}
                  </button>
                  <button onClick={() => setEditId(null)}
                    className="text-xs border px-2 py-1 rounded text-gray-500 hover:bg-gray-50">
                    {locale === 'ko' ? '취소' : 'Cancel'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-gray-700">{c.name}</span>
                    <span className={`text-xs ml-2 ${!validEmail(c.email) ? 'text-orange-500 font-medium' : 'text-gray-400'}`}>{c.email}</span>
                    {!validEmail(c.email) && <span className="text-[10px] text-orange-500 ml-1">← 수정 필요</span>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => { setEditId(c.id); setEditName(c.name); setEditEmail(c.email) }}
                      className="text-xs text-blue-500 hover:text-blue-700">
                      {locale === 'ko' ? '수정' : 'Edit'}
                    </button>
                    <button onClick={() => { save(contacts.filter(x => x.id !== c.id)); if (selectedId === c.id) onSelect('') }}
                      className="text-xs text-red-400 hover:text-red-600">
                      {locale === 'ko' ? '삭제' : 'Del'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-1 pt-2 border-t border-gray-200 flex-wrap">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder={locale === 'ko' ? '이름' : 'Name'}
              className="flex-1 min-w-16 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <div className="flex-1 min-w-28">
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="user@company.com" type="email"
                className={`w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 ${newEmailInvalid ? 'border-red-400 focus:ring-red-400' : 'focus:ring-blue-400'}`} />
              {newEmailInvalid && <p className="text-red-500 text-[10px] mt-0.5">user@domain.com 형식 필요</p>}
            </div>
            <button disabled={!newName.trim() || !validEmail(newEmail.trim())}
              onClick={() => {
                const c = { id: Math.random().toString(36).slice(2), name: newName.trim(), email: newEmail.trim() }
                save([...contacts, c]); setNewName(''); setNewEmail('')
              }}
              className="text-xs bg-green-600 disabled:bg-gray-300 text-white px-2 py-1 rounded whitespace-nowrap">
              + {locale === 'ko' ? '추가' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
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
  const [emailDates,     setEmailDates]     = useState<Set<string>>(new Set())
  const [calYear,        setCalYear]        = useState(0)
  const [calMonth,       setCalMonth]       = useState(0)
  const [emailEntries,   setEmailEntries]   = useState<Array<{ date: string; employee_id: string; leave_code: string; hours: number | null }>>([])
  const [emailEmps,      setEmailEmps]      = useState<Array<{ id: string; name: string }>>([])
  const [emailLoading,   setEmailLoading]   = useState(false)
  const [emailSenders,   setEmailSenders]   = useState<EmailContact[]>([])
  const [emailRecips,    setEmailRecips]    = useState<EmailContact[]>([])
  const [fromId,         setFromId]         = useState('')
  const [toId,           setToId]           = useState('')
  const [ccIds,          setCcIds]          = useState<Set<string>>(new Set())
  const [msalUser,       setMsalUser]       = useState<string | null>(null)
  const [sending,        setSending]        = useState(false)
  const [sendResult,     setSendResult]     = useState<'ok' | 'error' | null>(null)
  const [sendError,      setSendError]      = useState('')
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

  async function loadEmailData(cy = calYear, cm = calMonth) {
    if (!companyId) return
    setEmailLoading(true)
    const daysInMo = new Date(cy, cm, 0).getDate()
    const first = `${cy}-${padFn(cm)}-01`
    const last  = `${cy}-${padFn(cm)}-${padFn(daysInMo)}`
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
    setEmailEmps(prev => {
      const merged = [...prev]
      for (const e of (emps ?? [])) {
        if (!merged.some(m => m.id === e.id)) merged.push(e)
      }
      return merged
    })
    setEmailEntries(prev => {
      const incoming = entries ?? []
      const filtered = prev.filter(p => p.date < first || p.date > last)
      return [...filtered, ...incoming]
    })
    setEmailLoading(false)
  }

  function buildEmailBody() {
    const selected = Array.from(emailDates).sort()
    if (!selected.length) return { subject: '', body: '' }

    const sender    = emailSenders.find(s => s.id === fromId)
    const recipient = emailRecips.find(r => r.id === toId)
    const empMap    = Object.fromEntries(emailEmps.map(e => [e.id, e.name]))

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const DOW    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const dayLbl = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number)
      const dow = new Date(y, m - 1, d).getDay()
      return `${MONTHS[m - 1]} ${d} (${DOW[dow]})`
    }

    // W / B / O are not reported; L→Paid Leave, S→Sick Leave, T→Unpaid Leave
    const SKIP = new Set(['W','W1','W2','W3','B','O'])
    const codeLabel = (code: string, hours: number | null): string | null => {
      if (SKIP.has(code)) return null
      const map: Record<string, string> = {
        L:'Paid Leave',   L1:'Paid Leave (AM Half)',   L2:'Paid Leave (PM Half)',   L3:'Paid Leave (Hourly)',
        S:'Sick Leave',   S1:'Sick Leave (AM Half)',   S2:'Sick Leave (PM Half)',   S3:'Sick Leave (Hourly)',
        T:'Unpaid Leave', T1:'Unpaid Leave (AM Half)', T2:'Unpaid Leave (PM Half)', T3:'Unpaid Leave (Hourly)',
      }
      const base = map[code] ?? code
      return hours ? `${base} (${hours}h)` : base
    }

    type DayGroup = { iso: string; rows: { name: string; label: string }[] }
    const groups: DayGroup[] = selected.flatMap(iso => {
      const rows = emailEntries
        .filter(e => e.date === iso)
        .flatMap(e => {
          const label = codeLabel(e.leave_code, e.hours)
          return label ? [{ name: empMap[e.employee_id] ?? '?', label }] : []
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      return rows.length ? [{ iso, rows }] : []
    })

    const lines: string[] = []
    const firstName = (recipient?.name ?? '').split(' ')[0]
    lines.push(`Hi ${firstName},`, '')

    if (groups.length === 0) {
      lines.push('No leave entries to report for the selected dates.', '')
    } else if (groups.length === 1) {
      const g    = groups[0]
      const noun = g.rows.length === 1 ? 'employee is' : 'employees are'
      lines.push(`The following ${noun} scheduled to be on leave on ${dayLbl(g.iso)}.`, '')
      g.rows.forEach(r => lines.push(`  • ${r.name} - ${r.label}`))
      lines.push('')
    } else {
      lines.push('The following employees are scheduled to be on leave on the dates below.', '')
      for (const g of groups) {
        lines.push(dayLbl(g.iso))
        g.rows.forEach(r => lines.push(`  • ${r.name} - ${r.label}`))
        lines.push('')
      }
    }

    lines.push('Please update your records accordingly.', '', 'Thank you.')
    if (sender) lines.push('', sender.name)

    const shortDays = selected.map(iso => { const [y,m,d] = iso.split('-').map(Number); return `${MONTHS[m-1]} ${d}` }).join(', ')
    const subject   = `Employee Leave Notification - ${shortDays}`

    return { subject, body: lines.join('\n') }
  }

  async function sendEmail() {
    const { subject, body } = buildEmailBody()
    const recipient = emailRecips.find(r => r.id === toId)
    const toEmail   = recipient?.email ?? ''
    const ccEmails  = [...ccIds].map(id => emailRecips.find(r => r.id === id)?.email ?? '').filter(Boolean)
    const sender    = emailSenders.find(s => s.id === fromId)

    setSending(true)
    setSendResult(null)
    setSendError('')
    try {
      await sendGraphMail({ to: toEmail, cc: ccEmails, subject, body, fromName: sender?.name })
      const msal = await getMsal()
      setMsalUser(msal.getAllAccounts()[0]?.username ?? null)
      setSendResult('ok')
    } catch (e: unknown) {
      setSendResult('error')
      setSendError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSending(false)
    }
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
            onClick={() => {
              setEmailSenders(loadEmailContacts(SENDER_KEY))
              setEmailRecips(loadEmailContacts(RECIPIENT_KEY))
              setEmailDates(new Set())
              setEmailEmps([])
              setEmailEntries([])
              setCalYear(year)
              setCalMonth(month)
              setFromId('')
              setToId('')
              setCcIds(new Set())
              setSendResult(null)
              setSendError('')
              setShowEmailModal(true)
              loadEmailData(year, month)
              getMsal().then(m => {
                const accs = m.getAllAccounts()
                setMsalUser(accs[0]?.username ?? null)
              }).catch(() => {})
            }}
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
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-500">
                      {locale === 'ko' ? '날짜 선택 (복수 선택 가능)' : 'Select dates (multi-select)'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const d = new Date(calYear, calMonth - 2, 1)
                          const ny = d.getFullYear(); const nm = d.getMonth() + 1
                          setCalYear(ny); setCalMonth(nm); loadEmailData(ny, nm)
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-sm">
                        ‹
                      </button>
                      <span className="text-xs font-semibold text-gray-700 min-w-20 text-center">
                        {new Date(calYear, calMonth - 1).toLocaleString('en', { month: 'long', year: 'numeric' })}
                      </span>
                      <button
                        onClick={() => {
                          const d = new Date(calYear, calMonth, 1)
                          const ny = d.getFullYear(); const nm = d.getMonth() + 1
                          setCalYear(ny); setCalMonth(nm); loadEmailData(ny, nm)
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-sm">
                        ›
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {(locale === 'ko'
                      ? ['일', '월', '화', '수', '목', '금', '토']
                      : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
                    ).map(d => (
                      <div key={d} className="text-center text-xs text-gray-400 py-0.5 font-medium">{d}</div>
                    ))}
                    {Array.from({ length: new Date(calYear, calMonth - 1, 1).getDay() }).map((_, i) => (
                      <div key={`gap-${i}`} />
                    ))}
                    {Array.from({ length: new Date(calYear, calMonth, 0).getDate() }, (_, i) => i + 1).map(day => {
                      const ds       = `${calYear}-${padFn(calMonth)}-${padFn(day)}`
                      const hasEntry = emailEntries.some(e => e.date === ds)
                      const isSel    = emailDates.has(ds)
                      const dow      = new Date(calYear, calMonth - 1, day).getDay()
                      return (
                        <button key={day}
                          onClick={() => setEmailDates(prev => {
                            const next = new Set(prev)
                            if (next.has(ds)) next.delete(ds); else next.add(ds)
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

                {/* Sender */}
                <ContactMgr
                  label={locale === 'ko' ? '발신자 (From)' : 'From'}
                  contacts={emailSenders} selectedId={fromId} onSelect={setFromId}
                  storageKey={SENDER_KEY} onChange={setEmailSenders} locale={locale}
                />

                {/* Recipient */}
                <ContactMgr
                  label={locale === 'ko' ? '수신자 (To)' : 'To'}
                  contacts={emailRecips} selectedId={toId} onSelect={id => { setToId(id); setCcIds(p => { const n = new Set(p); n.delete(id); return n }) }}
                  storageKey={RECIPIENT_KEY} onChange={setEmailRecips} locale={locale}
                />

                {/* CC */}
                {emailRecips.filter(c => c.id !== toId).length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-700 mb-1.5">CC</p>
                    <div className="flex flex-col gap-1">
                      {emailRecips.filter(c => c.id !== toId).map(c => (
                        <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer px-2 py-1 rounded hover:bg-gray-50">
                          <input type="checkbox"
                            checked={ccIds.has(c.id)}
                            onChange={() => setCcIds(prev => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
                          />
                          <span className="text-gray-700">{c.name}</span>
                          <span className="text-gray-400">{c.email}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preview */}
                {emailDates.size > 0 ? (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-500 mb-1.5">
                      {locale === 'ko' ? '미리보기' : 'Preview'}
                    </p>
                    <pre className="bg-gray-50 border rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-52 overflow-y-auto font-mono leading-relaxed">
                      {buildEmailBody().body}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center mb-4">
                    {locale === 'ko' ? '날짜를 선택하면 미리보기가 표시됩니다.' : 'Select dates to preview.'}
                  </p>
                )}

                {/* Microsoft account status */}
                <div className="flex items-center justify-between mb-3 text-xs">
                  {msalUser ? (
                    <span className="text-green-600 font-medium">✓ {msalUser}</span>
                  ) : (
                    <span className="text-gray-400">Microsoft 계정 미연결 — 전송 시 로그인 팝업 표시</span>
                  )}
                  {msalUser && (
                    <button onClick={async () => { await msalLogout(); setMsalUser(null) }}
                      className="text-gray-400 hover:text-red-500 underline">
                      로그아웃
                    </button>
                  )}
                </div>

                {/* Send result feedback */}
                {sendResult === 'ok' && (
                  <div className="mb-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700 font-medium">
                    ✅ 이메일이 전송됐어요.
                  </div>
                )}
                {sendResult === 'error' && (
                  <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                    ❌ 전송 실패: {sendError}
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={sendEmail}
                    disabled={emailDates.size === 0 || !toId || sending}
                    className="flex-1 bg-blue-600 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 transition-colors">
                    {sending ? '전송 중...' : '📧 Send Email'}
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
