'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { useAuth, type Role } from '@/app/providers'
import { ADMIN_EMAILS, type UiLanguage } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const ROLES: { key: Role; label: string }[] = [
  { key: 'requester', label: 'Requester' },
  { key: 'purchasing', label: 'Purchasing' },
  { key: 'operations', label: 'Operations' },
  { key: 'bookkeeping', label: 'Bookkeeping' },
  { key: 'admin', label: 'Admin' },
]

export default function AdminPage() {
  const { user, locale, canManageLocale, setLocale } = useAuth()
  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email)

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">{locale === 'ko' ? '관리자' : 'Admin'}</h1>
      <p className="text-sm text-ink-faint mb-6">{locale === 'ko' ? '권한 및 설정 관리' : 'Permissions and settings'}</p>

      {isAdmin ? (
        <div className="space-y-6">
          <Link href="/admin/categories" className="inline-block text-sm text-ink-muted hover:text-ink underline">
            {locale === 'ko' ? '구매 카테고리 관리 →' : 'Manage purchase categories ->'}
          </Link>
          <LanguagePanel locale={locale} canManageLocale={canManageLocale} setLocale={setLocale} />
          <BookkeepingEmailPanel locale={locale} />
          <RoleAccessPanel locale={locale} />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line-soft p-6 text-sm text-ink-muted">
          {locale === 'ko' ? '이 페이지에 대한 접근 권한이 없습니다.' : 'You do not have access to this page.'}
        </div>
      )}
    </div>
  )
}

function LanguagePanel({ locale, canManageLocale, setLocale }: { locale: UiLanguage; canManageLocale: boolean; setLocale: (locale: UiLanguage) => Promise<boolean> }) {
  const [value, setValue] = useState<UiLanguage>(locale)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setValue(locale)
  }, [locale])

  async function save() {
    setSaving(true)
    setSaved(false)
    const ok = await setLocale(value)
    setSaving(false)
    setSaved(ok)
  }

  return (
    <div className="bg-white rounded-xl border border-line-soft p-6">
      <h2 className="text-sm font-semibold text-ink mb-0.5">{locale === 'ko' ? '언어' : 'Language'}</h2>
      <p className="text-xs text-ink-faint mb-3">
        {locale === 'ko'
          ? '기본 언어는 영어입니다. admin@afstransco.com만 한국어 UI로 전환할 수 있습니다.'
          : 'English is the default UI. Only admin@afstransco.com can switch the app to Korean.'}
      </p>
      <div className="flex items-center gap-2">
        <select
          disabled={!canManageLocale || saving}
          value={value}
          onChange={e => setValue(e.target.value as UiLanguage)}
          className="border border-line rounded-lg px-3 py-2 text-sm"
        >
          <option value="en">English</option>
          <option value="ko">Korean</option>
        </select>
        <button
          onClick={save}
          disabled={!canManageLocale || saving}
          className="px-3 py-1.5 text-xs text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint"
        >
          {saving ? (locale === 'ko' ? '저장 중…' : 'Saving...') : (locale === 'ko' ? '저장' : 'Save')}
        </button>
        {saved && <span className="text-xs text-signal-pos">{locale === 'ko' ? '저장됨 ✓' : 'Saved ✓'}</span>}
      </div>
    </div>
  )
}

function BookkeepingEmailPanel({ locale }: { locale: UiLanguage }) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase.from('warehousing_settings').select('value').eq('key', 'bookkeeping_email').maybeSingle()
      .then(({ data }) => { setValue(data?.value ?? ''); setLoading(false) })
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    const { error } = await supabase
      .from('warehousing_settings')
      .upsert({ key: 'bookkeeping_email', value: value.trim() }, { onConflict: 'key' })
    setSaving(false)
    setSaved(!error)
  }

  return (
    <div className="bg-white rounded-xl border border-line-soft p-6">
      <h2 className="text-sm font-semibold text-ink mb-0.5">{locale === 'ko' ? '경리 이메일' : 'Bookkeeping Email'}</h2>
      <p className="text-xs text-ink-faint mb-3">
        {locale === 'ko'
          ? '"경리에게 전달" 버튼을 눌렀을 때 메일을 받을 주소입니다.'
          : 'Email recipient used by the "Send to Bookkeeping" action.'}
      </p>
      {loading ? (
        <p className="text-sm text-ink-faint">{locale === 'ko' ? '불러오는 중…' : 'Loading...'}</p>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="bookkeeping@afstransco.com"
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint">
            {saving ? (locale === 'ko' ? '저장 중…' : 'Saving...') : (locale === 'ko' ? '저장' : 'Save')}
          </button>
          {saved && <span className="text-xs text-signal-pos">{locale === 'ko' ? '저장됨 ✓' : 'Saved ✓'}</span>}
        </div>
      )}
    </div>
  )
}

interface AuthUser {
  id: string
  email: string
  created_at: string
}

interface UserRow {
  email: string
  role: Role | null
  saving: boolean
  saved: boolean
}

function RoleAccessPanel({ locale }: { locale: UiLanguage }) {
  const [rows, setRows] = useState<Record<string, UserRow>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setError(locale === 'ko' ? '로그인이 필요합니다.' : 'You must be signed in.')
      setLoading(false)
      return
    }

    const [usersRes, accessRes] = await Promise.all([
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
      supabase.from('app_access').select('email, role').eq('app', 'warehousing'),
    ])

    if (!usersRes.ok) {
      const body = await usersRes.json().catch(() => ({}))
      setError(body.error || (locale === 'ko' ? `사용자 목록을 불러오지 못했습니다 (${usersRes.status})` : `Failed to load users (${usersRes.status})`))
      setLoading(false)
      return
    }

    const { users } = (await usersRes.json()) as { users: AuthUser[] }
    const roleByEmail = new Map<string, Role>((accessRes.data ?? []).map(r => [r.email as string, r.role as Role]))

    const next: Record<string, UserRow> = {}
    for (const u of users) {
      next[u.email] = { email: u.email, role: roleByEmail.get(u.email) ?? null, saving: false, saved: false }
    }
    setRows(next)
    setLoading(false)
  }

  function updateRow(email: string, patch: Partial<UserRow>) {
    setRows(r => ({ ...r, [email]: { ...r[email], ...patch, saved: false } }))
  }

  async function save(email: string) {
    const row = rows[email]
    if (!row) return
    updateRow(email, { saving: true })

    if (row.role === null) {
      const { error: delError } = await supabase.from('app_access').delete().eq('email', email).eq('app', 'warehousing')
      updateRow(email, { saving: false, saved: !delError })
      return
    }

    const { error: upsertError } = await supabase.from('app_access').upsert({ email, app: 'warehousing', role: row.role }, { onConflict: 'email,app' })
    updateRow(email, { saving: false, saved: !upsertError })
  }

  if (loading) {
    return <div className="bg-white rounded-xl border border-line-soft p-6"><p className="text-sm text-ink-faint">{locale === 'ko' ? '사용자 목록을 불러오는 중…' : 'Loading users...'}</p></div>
  }

  if (error) {
    return <div className="bg-white rounded-xl border border-line-soft p-6"><h2 className="text-sm font-semibold text-ink mb-1">{locale === 'ko' ? '사용자 권한' : 'User Access'}</h2><p className="text-xs text-signal-neg">{error}</p></div>
  }

  return (
    <div className="bg-white rounded-xl border border-line-soft p-6">
      <h2 className="text-sm font-semibold text-ink mb-0.5">{locale === 'ko' ? '사용자 권한' : 'User Access'}</h2>
      <p className="text-xs text-ink-faint mb-4">
        {locale === 'ko'
          ? '각 계정의 Warehousing 접근 권한과 역할을 설정합니다. 역할이 없으면 접근할 수 없습니다.'
          : 'Assign Warehousing access and roles per account. No role means no access.'}
      </p>

      <div className="space-y-2">
        {Object.values(rows).map(row => (
          <div key={row.email} className="flex items-center justify-between gap-3 border border-line-soft rounded-lg px-4 py-3">
            <span className="text-sm text-ink truncate">{row.email}</span>
            <div className="flex items-center gap-3 shrink-0">
              {row.saved && <span className="text-xs text-signal-pos">{locale === 'ko' ? '저장됨 ✓' : 'Saved ✓'}</span>}
              <select
                value={row.role ?? ''}
                onChange={e => updateRow(row.email, { role: (e.target.value || null) as Role | null })}
                className="border border-line rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">{locale === 'ko' ? '— 접근 없음 —' : '-- No Access --'}</option>
                {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <button
                onClick={() => save(row.email)}
                disabled={row.saving}
                className="px-3 py-1.5 text-xs text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint transition-colors"
              >
                {row.saving ? (locale === 'ko' ? '저장 중…' : 'Saving...') : (locale === 'ko' ? '저장' : 'Save')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
