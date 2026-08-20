'use client'

import { useEffect, useRef, useState } from 'react'
import { sendGraphMail, sendPendingMailAfterRedirect, msalLogout, getMsal } from '@/lib/graphMail'
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
type EmailEntry = {
  date: string
  employee_id: string
  leave_code: string
  hours: number | null
  reported_at?: string | null
}
const SENDER_KEY    = 'afs_email_senders'
const RECIPIENT_KEY = 'afs_email_recipients'
const PENDING_REPORT_KEY = 'afs_pending_report_marks'
const REPORTABLE_CODES = new Set(['L','L1','L2','L3','S','S1','S2','S3','T','T1','T2','T3','C'])
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
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <button onClick={() => { setOpen(o => !o); setEditId(null); setNewName(''); setNewEmail('') }}
          className="text-xs text-ink-muted hover:text-ink">
          {open ? (locale === 'ko' ? '닫기' : 'Close') : (locale === 'ko' ? '+ 추가/관리' : '+ Add/Manage')}
        </button>
      </div>
      <select value={selectedId} onChange={e => onSelect(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink bg-white">
        <option value="">{locale === 'ko' ? '— 선택 —' : '— Select —'}</option>
        {contacts.map(c => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.email}){!validEmail(c.email) ? ' ⚠️' : ''}
          </option>
        ))}
      </select>
      {open && (
        <div className="mt-2 border rounded-lg p-3 bg-pill space-y-2">
          {!contacts.length && (
            <p className="text-xs text-ink-faint text-center py-1">
              {locale === 'ko' ? '등록된 연락처 없음' : 'No contacts yet'}
            </p>
          )}
          {contacts.map(c => (
            <div key={c.id} className={`bg-white rounded-lg p-2 border ${!validEmail(c.email) ? 'border-amber-300' : ''}`}>
              {editId === c.id ? (
                <div className="flex gap-1 flex-wrap">
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    placeholder={locale === 'ko' ? '이름' : 'Name'}
                    className="flex-1 min-w-20 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ink" />
                  <div className="flex-1 min-w-32">
                    <input value={editEmail} onChange={e => setEditEmail(e.target.value)}
                      type="email" placeholder="user@company.com"
                      className={`w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 ${editEmailInvalid ? 'border-signal-neg focus:ring-signal-neg' : 'focus:ring-ink'}`} />
                    {editEmailInvalid && <p className="text-signal-neg text-[10px] mt-0.5">user@domain.com 형식 필요</p>}
                  </div>
                  <button disabled={!editName.trim() || !validEmail(editEmail.trim())}
                    onClick={() => { save(contacts.map(x => x.id === c.id ? { id: c.id, name: editName.trim(), email: editEmail.trim() } : x)); setEditId(null) }}
                    className="text-xs bg-ink disabled:bg-line text-white px-2 py-1 rounded">
                    {locale === 'ko' ? '저장' : 'Save'}
                  </button>
                  <button onClick={() => setEditId(null)}
                    className="text-xs border px-2 py-1 rounded text-ink-muted hover:bg-pill">
                    {locale === 'ko' ? '취소' : 'Cancel'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-ink-muted">{c.name}</span>
                    <span className={`text-xs ml-2 ${!validEmail(c.email) ? 'text-amber-600 font-medium' : 'text-ink-faint'}`}>{c.email}</span>
                    {!validEmail(c.email) && <span className="text-[10px] text-amber-600 ml-1">← 수정 필요</span>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => { setEditId(c.id); setEditName(c.name); setEditEmail(c.email) }}
                      className="text-xs text-ink-muted hover:text-ink">
                      {locale === 'ko' ? '수정' : 'Edit'}
                    </button>
                    <button onClick={() => { save(contacts.filter(x => x.id !== c.id)); if (selectedId === c.id) onSelect('') }}
                      className="text-xs text-ink-faint hover:text-signal-neg">
                      {locale === 'ko' ? '삭제' : 'Del'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-1 pt-2 border-t border-line flex-wrap">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder={locale === 'ko' ? '이름' : 'Name'}
              className="flex-1 min-w-16 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ink" />
            <div className="flex-1 min-w-28">
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="user@company.com" type="email"
                className={`w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 ${newEmailInvalid ? 'border-signal-neg focus:ring-signal-neg' : 'focus:ring-ink'}`} />
              {newEmailInvalid && <p className="text-signal-neg text-[10px] mt-0.5">user@domain.com 형식 필요</p>}
            </div>
            <button disabled={!newName.trim() || !validEmail(newEmail.trim())}
              onClick={() => {
                const c = { id: Math.random().toString(36).slice(2), name: newName.trim(), email: newEmail.trim() }
                save([...contacts, c]); setNewName(''); setNewEmail('')
              }}
              className="text-xs bg-ink disabled:bg-line text-white px-2 py-1 rounded whitespace-nowrap">
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
  const [emailEntries,   setEmailEntries]   = useState<EmailEntry[]>([])
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
  const [subjectEdit,    setSubjectEdit]    = useState<string | null>(null)
  const [bodyEdit,       setBodyEdit]       = useState<string | null>(null)
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

  // After Microsoft redirect login, pick up the pending email and send it
  useEffect(() => {
    sendPendingMailAfterRedirect().then(({ sent, error }) => {
      if (sent) {
        setShowEmailModal(true)
        getMsal().then(async m => {
          const account = m.getAllAccounts()[0]?.username ?? null
          setMsalUser(account)
          await markPendingReportedEntries(account)
          setSendResult('ok')
          setGridKey(k => k + 1)
        }).catch(e => {
          setSendResult('error')
          setSendError(e instanceof Error ? e.message : 'Unknown error')
        })
      }
      if (error) {
        setSendResult('error')
        setSendError(error)
        setShowEmailModal(true)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Regenerate the subject/body draft whenever the selected dates or recipient
  // change — any manual edits the user made are for the previous selection.
  useEffect(() => {
    if (!showEmailModal) return
    setSubjectEdit(null)
    setBodyEdit(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmailModal, Array.from(emailDates).sort().join(','), toId])

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
    const entries = ids.length ? await loadEmailEntries(ids, first, last) : []
    setEmailEmps(prev => {
      const merged = [...prev]
      for (const e of (emps ?? [])) {
        if (!merged.some(m => m.id === e.id)) merged.push(e)
      }
      return merged
    })
    setEmailEntries(prev => {
      const incoming = entries
      const filtered = prev.filter(p => p.date < first || p.date > last)
      return [...filtered, ...incoming]
    })
    setEmailLoading(false)
  }

  async function loadEmailEntries(ids: string[], first: string, last: string): Promise<EmailEntry[]> {
    const withReport = await supabase.from('leave_entries')
      .select('employee_id,date,leave_code,hours,reported_at')
      .in('employee_id', ids).gte('date', first).lte('date', last)

    if (!withReport.error) return (withReport.data ?? []) as EmailEntry[]

    const fallback = await supabase.from('leave_entries')
      .select('employee_id,date,leave_code,hours')
      .in('employee_id', ids).gte('date', first).lte('date', last)
    return (fallback.data ?? []) as EmailEntry[]
  }

  function getReportableEmailEntries() {
    const selected = new Set(Array.from(emailDates))
    return emailEntries.filter(e => selected.has(e.date) && REPORTABLE_CODES.has(e.leave_code))
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

    // W / B / O are not reported; L→Paid Leave, S→Sick Leave, T→Unpaid Leave, C→Special Leave
    const codeLabel = (code: string, hours: number | null): string | null => {
      if (!REPORTABLE_CODES.has(code)) return null
      const map: Record<string, string> = {
        L:'Paid Leave',   L1:'Paid Leave (AM Half)',   L2:'Paid Leave (PM Half)',   L3:'Paid Leave (Hourly)',
        S:'Sick Leave',   S1:'Sick Leave (AM Half)',   S2:'Sick Leave (PM Half)',   S3:'Sick Leave (Hourly)',
        T:'Unpaid Leave', T1:'Unpaid Leave (AM Half)', T2:'Unpaid Leave (PM Half)', T3:'Unpaid Leave (Hourly)',
        C:'Special Leave',
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

    const shortDays = selected.map(iso => { const [y,m,d] = iso.split('-').map(Number); return `${MONTHS[m-1]} ${d}` }).join(', ')
    const subject   = `Employee Leave Notification - ${shortDays}`

    return { subject, body: lines.join('\n') }
  }

  async function sendEmail() {
    const auto    = buildEmailBody()
    const subject = subjectEdit ?? auto.subject
    const body    = bodyEdit ?? auto.body
    const recipient = emailRecips.find(r => r.id === toId)
    const toEmail   = recipient?.email ?? ''
    const ccEmails  = [...ccIds].map(id => emailRecips.find(r => r.id === id)?.email ?? '').filter(Boolean)
    const sender    = emailSenders.find(s => s.id === fromId)
    const reportEntries = getReportableEmailEntries()

    setSending(true)
    setSendResult(null)
    setSendError('')
    try {
      savePendingReportMarks({ entries: reportEntries, toEmail, ccEmails, subject, reportedBy: sender?.email ?? null })
      await sendGraphMail({ to: toEmail, cc: ccEmails, subject, body, fromName: sender?.name })
      const msal = await getMsal()
      const account = msal.getAllAccounts()[0]?.username ?? null
      setMsalUser(account)
      await markReportedEntries({
        entries: reportEntries,
        toEmail,
        ccEmails,
        subject,
        reportedBy: account ?? sender?.email ?? null,
      })
      clearPendingReportMarks()
      setSendResult('ok')
      setGridKey(k => k + 1)
    } catch (e: unknown) {
      clearPendingReportMarks()
      setSendResult('error')
      setSendError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSending(false)
    }
  }

  async function markReportedEntries({ entries, toEmail, ccEmails, subject, reportedBy }: {
    entries: EmailEntry[]
    toEmail: string
    ccEmails: string[]
    subject: string
    reportedBy: string | null
  }) {
    if (!entries.length) return
    const reportedAt = new Date().toISOString()
    const patch = {
      reported_at: reportedAt,
      reported_to: toEmail || null,
      reported_cc: ccEmails.length ? ccEmails : null,
      reported_subject: subject || null,
      reported_by: reportedBy,
    }

    const results = await Promise.all(entries.map(e => supabase.from('leave_entries')
      .update(patch)
      .eq('employee_id', e.employee_id)
      .eq('date', e.date)
      .eq('leave_code', e.leave_code)))
    const error = results.find(r => r.error)?.error
    if (error) throw error

    const reportedKeys = new Set(entries.map(e => `${e.employee_id}_${e.date}_${e.leave_code}`))
    setEmailEntries(prev => prev.map(e =>
      reportedKeys.has(`${e.employee_id}_${e.date}_${e.leave_code}`)
        ? { ...e, reported_at: reportedAt }
        : e
    ))
  }

  function savePendingReportMarks(payload: {
    entries: EmailEntry[]
    toEmail: string
    ccEmails: string[]
    subject: string
    reportedBy: string | null
  }) {
    sessionStorage.setItem(PENDING_REPORT_KEY, JSON.stringify(payload))
  }

  function clearPendingReportMarks() {
    sessionStorage.removeItem(PENDING_REPORT_KEY)
  }

  async function markPendingReportedEntries(account: string | null) {
    const raw = sessionStorage.getItem(PENDING_REPORT_KEY)
    if (!raw) return
    const payload = JSON.parse(raw) as {
      entries: EmailEntry[]
      toEmail: string
      ccEmails: string[]
      subject: string
      reportedBy: string | null
    }
    await markReportedEntries({ ...payload, reportedBy: account ?? payload.reportedBy })
    clearPendingReportMarks()
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
    { code: 'T',        label: 'Unpaid',                            color: 'bg-line  text-ink-muted'   },
    { code: 'B',        label: t('hr.legend.holiday', locale),      color: 'bg-pill  text-ink-muted'   },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-5">
        <Link href="/hr" className="text-sm text-ink-faint hover:text-ink-muted">← HR</Link>
        <h1 className="text-2xl font-bold text-ink">
          {COMPANY_MAP[company]} {t('hr.attendance.management', locale)}
        </h1>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => shiftMonth(-1)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-pill">◀</button>
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => { setPickerYear(year); setShowPicker(p => !p) }}
              className="text-base font-semibold w-32 text-center px-2 py-1.5 rounded-lg hover:bg-pill transition-colors">
              {monthLabel}
            </button>
            {showPicker && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-white border border-line rounded-xl shadow-xl p-3 z-50 w-56">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setPickerYear(y => y - 1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-pill text-ink-muted text-xs font-bold">◀</button>
                  <span className="text-sm font-bold text-ink">{pickerYear}</span>
                  <button onClick={() => setPickerYear(y => y + 1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-pill text-ink-muted text-xs font-bold">▶</button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <button key={m}
                      onClick={() => { setYear(pickerYear); setMonth(m); setShowPicker(false) }}
                      className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${
                        pickerYear === year && m === month
                          ? 'bg-ink text-white'
                          : 'hover:bg-pill text-ink-muted'
                      }`}>
                      {t(`month.${m}`, locale)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => shiftMonth(1)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-pill">▶</button>
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); setShowPicker(false) }}
            className="px-3 py-1.5 border rounded-lg text-sm text-ink-muted hover:bg-pill">
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
              setSubjectEdit(null)
              setBodyEdit(null)
              setShowEmailModal(true)
              loadEmailData(year, month)
              getMsal().then(m => {
                const accs = m.getAllAccounts()
                setMsalUser(accs[0]?.username ?? null)
              }).catch(() => {})
            }}
            disabled={!companyId}
            className="px-3 py-1.5 border rounded-lg text-sm text-ink-muted hover:bg-pill disabled:opacity-40 whitespace-nowrap">
            {locale === 'ko' ? '리포트' : 'Report'}
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
        : <div className="text-center py-16 text-ink-faint">{t('common.loading', locale)}</div>
      }

      {/* Terminated employees */}
      <div className="mt-8">
        <button onClick={() => setShowTerminated(!showTerminated)}
          className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink-muted py-2">
          <span className={`transition-transform inline-block ${showTerminated ? 'rotate-90' : ''}`}>▶</span>
          {t('hr.terminated.title', locale)}
          {showTerminated && terminated.length > 0 && (
            <span className="bg-line text-ink-muted text-xs px-1.5 py-0.5 rounded-full">{terminated.length}</span>
          )}
        </button>

        {showTerminated && (
          <div className="border rounded-xl overflow-hidden mt-2">
            {terminated.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-pill">
                  <tr>
                    <th className="text-left px-4 py-2 text-ink-muted font-medium">{t('hr.terminated.name', locale)}</th>
                    <th className="text-left px-4 py-2 text-ink-muted font-medium">{t('hr.terminated.team_pos', locale)}</th>
                    <th className="text-center px-4 py-2 text-ink-muted font-medium">{t('hr.terminated.start_date', locale)}</th>
                    <th className="text-center px-4 py-2 text-ink-muted font-medium">{t('hr.terminated.end_date', locale)}</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {terminated.map(emp => (
                    <tr key={emp.id} className="border-t hover:bg-pill">
                      <td className="px-4 py-2 text-ink-muted font-medium">{emp.name}</td>
                      <td className="px-4 py-2 text-ink-muted text-xs">
                        {emp.team || '—'}{emp.position ? ` · ${emp.position}` : ''}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => { setDateEdit({ emp, field: 'start_date' }); setDateValue(emp.start_date ?? '') }}
                          className="text-xs text-ink-muted hover:text-ink hover:underline">
                          {fmtDate(emp.start_date)}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => { setDateEdit({ emp, field: 'end_date' }); setDateValue(emp.end_date ?? '') }}
                          className="text-xs text-signal-neg hover:opacity-70 hover:underline">
                          {fmtDate(emp.end_date)}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right flex items-center justify-end gap-2">
                        <button onClick={() => reactivate(emp.id)}
                          className="text-xs text-signal-pos hover:opacity-70 border border-line px-2 py-1 rounded hover:bg-pill">
                          {t('hr.terminated.reactivate', locale)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-8 text-center text-ink-faint text-sm">{t('hr.terminated.empty', locale)}</div>
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
            <h3 className="font-semibold text-ink mb-4 text-base">
              {locale === 'ko'
                ? `${COMPANY_MAP[company]} 근태 리포트 전송`
                : `Send ${COMPANY_MAP[company]} Attendance Report`}
            </h3>

            {emailLoading ? (
              <div className="text-center py-12 text-ink-faint text-sm">{t('common.loading', locale)}</div>
            ) : (
              <>
                {/* Date grid */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-ink-muted">
                      {locale === 'ko' ? '날짜 선택 (복수 선택 가능)' : 'Select dates (multi-select)'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const d = new Date(calYear, calMonth - 2, 1)
                          const ny = d.getFullYear(); const nm = d.getMonth() + 1
                          setCalYear(ny); setCalMonth(nm); loadEmailData(ny, nm)
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-pill text-ink-muted text-sm">
                        ‹
                      </button>
                      <span className="text-xs font-semibold text-ink-muted min-w-20 text-center">
                        {new Date(calYear, calMonth - 1).toLocaleString('en', { month: 'long', year: 'numeric' })}
                      </span>
                      <button
                        onClick={() => {
                          const d = new Date(calYear, calMonth, 1)
                          const ny = d.getFullYear(); const nm = d.getMonth() + 1
                          setCalYear(ny); setCalMonth(nm); loadEmailData(ny, nm)
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-pill text-ink-muted text-sm">
                        ›
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {(locale === 'ko'
                      ? ['일', '월', '화', '수', '목', '금', '토']
                      : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
                    ).map(d => (
                      <div key={d} className="text-center text-xs text-ink-faint py-0.5 font-medium">{d}</div>
                    ))}
                    {Array.from({ length: new Date(calYear, calMonth - 1, 1).getDay() }).map((_, i) => (
                      <div key={`gap-${i}`} />
                    ))}
                    {Array.from({ length: new Date(calYear, calMonth, 0).getDate() }, (_, i) => i + 1).map(day => {
                      const ds       = `${calYear}-${padFn(calMonth)}-${padFn(day)}`
                      const hasEntry = emailEntries.some(e => e.date === ds)
                      const isSel    = emailDates.has(ds)
                      return (
                        <button key={day}
                          onClick={() => setEmailDates(prev => {
                            const next = new Set(prev)
                            if (next.has(ds)) next.delete(ds); else next.add(ds)
                            return next
                          })}
                          className={`relative py-1.5 rounded-lg text-xs font-medium transition-colors
                            ${isSel
                              ? 'bg-ink text-white'
                              : hasEntry
                                ? 'bg-pill text-ink-muted hover:bg-line'
                                : 'text-ink-faint hover:bg-pill'
                            }`}>
                          {day}
                          {hasEntry && !isSel && (
                            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-500" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-ink-faint">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      {locale === 'ko' ? '기록 있음' : 'Has entries'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-ink inline-block" />
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
                    <p className="text-xs font-medium text-ink-muted mb-1.5">CC</p>
                    <div className="flex flex-col gap-1">
                      {emailRecips.filter(c => c.id !== toId).map(c => (
                        <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer px-2 py-1 rounded hover:bg-pill">
                          <input type="checkbox"
                            checked={ccIds.has(c.id)}
                            onChange={() => setCcIds(prev => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
                          />
                          <span className="text-ink-muted">{c.name}</span>
                          <span className="text-ink-faint">{c.email}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preview — editable before sending */}
                {emailDates.size > 0 ? (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-ink-muted mb-1.5">
                      {locale === 'ko' ? '제목 (수정 가능)' : 'Subject (editable)'}
                    </p>
                    <input type="text"
                      value={subjectEdit ?? buildEmailBody().subject}
                      onChange={e => setSubjectEdit(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-xs text-ink-muted focus:outline-none focus:ring-2 focus:ring-ink mb-2" />
                    <p className="text-xs font-medium text-ink-muted mb-1.5">
                      {locale === 'ko' ? '메시지 (수정 가능)' : 'Message (editable)'}
                    </p>
                    <textarea
                      value={bodyEdit ?? buildEmailBody().body}
                      onChange={e => setBodyEdit(e.target.value)}
                      rows={8}
                      className="w-full bg-pill border rounded-lg p-3 text-xs text-ink-muted whitespace-pre-wrap font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ink resize-y" />
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint text-center mb-4">
                    {locale === 'ko' ? '날짜를 선택하면 미리보기가 표시됩니다.' : 'Select dates to preview.'}
                  </p>
                )}

                {/* Microsoft account status */}
                <div className="flex items-center justify-between mb-3 text-xs">
                  {msalUser ? (
                    <span className="text-signal-pos font-medium">✓ {msalUser}</span>
                  ) : (
                    <span className="text-ink-faint">Microsoft 계정 미연결 — 전송 시 로그인 페이지로 이동</span>
                  )}
                  {msalUser && (
                    <button onClick={async () => { await msalLogout(); setMsalUser(null) }}
                      className="text-ink-faint hover:text-signal-neg underline">
                      로그아웃
                    </button>
                  )}
                </div>

                {/* Send result feedback */}
                {sendResult === 'ok' && (
                  <div className="mb-3 bg-white border border-line rounded-lg px-3 py-2 text-xs text-signal-pos font-medium">
                    이메일이 전송됐어요.
                  </div>
                )}
                {sendResult === 'error' && (
                  <div className="mb-3 bg-white border border-line rounded-lg px-3 py-2 text-xs text-signal-neg">
                    <div>전송 실패: {sendError}</div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={sendEmail}
                    disabled={emailDates.size === 0 || !toId || sending}
                    className="flex-1 bg-ink disabled:bg-line text-white rounded-lg py-2 text-sm font-medium hover:bg-ink/90 transition-colors">
                    {sending ? '전송 중...' : 'Send Email'}
                  </button>
                  <button onClick={() => setShowEmailModal(false)}
                    className="px-5 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
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
            <h3 className="font-semibold text-ink mb-1">
              {dateEdit.field === 'start_date'
                ? t('hr.date_edit.start', locale)
                : t('hr.date_edit.end', locale)}
            </h3>
            <p className="text-sm text-ink font-medium mb-3">{dateEdit.emp.name}</p>
            <div className="mb-4">
              <label className="text-xs text-ink-muted mb-1 block">
                {dateEdit.field === 'start_date'
                  ? t('hr.terminated.start_date', locale)
                  : t('hr.terminated.end_date', locale)}
              </label>
              <input type="date" value={dateValue}
                onChange={e => setDateValue(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  dateEdit.field === 'end_date' ? 'focus:ring-signal-neg' : 'focus:ring-ink'
                }`} />
            </div>
            <div className="flex gap-2">
              <button onClick={confirmDateEdit} disabled={!dateValue || saving}
                className={`flex-1 disabled:bg-line text-white rounded-lg py-2 text-sm font-medium ${
                  dateEdit.field === 'end_date' ? 'bg-signal-neg' : 'bg-ink'
                }`}>
                {t('common.save', locale)}
              </button>
              <button onClick={() => setDateEdit(null)}
                className="flex-1 border border-line rounded-lg py-2 text-sm text-ink-muted hover:bg-pill">
                {t('common.cancel', locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
