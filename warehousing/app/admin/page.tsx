'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { useAuth, type Role } from '@/app/providers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

// Must match ADMIN_EMAILS in app/api/admin/users/route.ts — that's the real
// enforcement point; this just decides whether to render the panel at all.
const ADMIN_EMAILS = ['admin@afstransco.com']

const ROLES: { key: Role; label: string }[] = [
  { key: 'requester', label: '요청자 (Requester)' },
  { key: 'purchasing', label: '구매 담당 (Purchasing)' },
  { key: 'operations', label: '운영/실행 (Operations)' },
  { key: 'bookkeeping', label: '경리 (Bookkeeping)' },
  { key: 'admin', label: '관리자 (Admin)' },
]

export default function AdminPage() {
  const { user } = useAuth()

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">관리자</h1>
      <p className="text-sm text-ink-faint mb-6">권한 및 설정 관리</p>

      {user?.email && ADMIN_EMAILS.includes(user.email) ? (
        <div className="space-y-6">
          <Link href="/admin/categories" className="inline-block text-sm text-ink-muted hover:text-ink underline">
            구매 카테고리 관리 →
          </Link>
          <BookkeepingEmailPanel />
          <RoleAccessPanel />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line-soft p-6 text-sm text-ink-muted">
          이 페이지에 대한 접근 권한이 없습니다.
        </div>
      )}
    </div>
  )
}

function BookkeepingEmailPanel() {
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
      <h2 className="text-sm font-semibold text-ink mb-0.5">경리 이메일</h2>
      <p className="text-xs text-ink-faint mb-3">&quot;경리에게 전달&quot; 버튼을 눌렀을 때 메일을 받을 주소입니다.</p>
      {loading ? (
        <p className="text-sm text-ink-faint">불러오는 중…</p>
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
            {saving ? '저장 중…' : '저장'}
          </button>
          {saved && <span className="text-xs text-signal-pos">저장됨 ✓</span>}
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

function RoleAccessPanel() {
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
      setError('로그인이 필요합니다.')
      setLoading(false)
      return
    }

    const [usersRes, accessRes] = await Promise.all([
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
      supabase.from('app_access').select('email, role').eq('app', 'warehousing'),
    ])

    if (!usersRes.ok) {
      const body = await usersRes.json().catch(() => ({}))
      setError(body.error || `사용자 목록을 불러오지 못했습니다 (${usersRes.status})`)
      setLoading(false)
      return
    }

    const { users } = (await usersRes.json()) as { users: AuthUser[] }
    const roleByEmail = new Map<string, Role>(
      (accessRes.data ?? []).map(r => [r.email as string, r.role as Role])
    )

    const next: Record<string, UserRow> = {}
    for (const u of users) {
      next[u.email] = {
        email: u.email,
        role: roleByEmail.get(u.email) ?? null,
        saving: false,
        saved: false,
      }
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
      const { error: delError } = await supabase
        .from('app_access')
        .delete()
        .eq('email', email)
        .eq('app', 'warehousing')
      updateRow(email, { saving: false, saved: !delError })
      return
    }

    const { error: upsertError } = await supabase
      .from('app_access')
      .upsert({ email, app: 'warehousing', role: row.role }, { onConflict: 'email,app' })
    updateRow(email, { saving: false, saved: !upsertError })
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-line-soft p-6">
        <p className="text-sm text-ink-faint">사용자 목록을 불러오는 중…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-line-soft p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">사용자 권한</h2>
        <p className="text-xs text-signal-neg">{error}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-line-soft p-6">
      <h2 className="text-sm font-semibold text-ink mb-0.5">사용자 권한</h2>
      <p className="text-xs text-ink-faint mb-4">
        각 계정의 Warehousing 접근 권한과 역할을 설정합니다. 역할이 없으면 접근할 수 없습니다.
      </p>

      <div className="space-y-2">
        {Object.values(rows).map(row => (
          <div key={row.email} className="flex items-center justify-between gap-3 border border-line-soft rounded-lg px-4 py-3">
            <span className="text-sm text-ink truncate">{row.email}</span>
            <div className="flex items-center gap-3 shrink-0">
              {row.saved && <span className="text-xs text-signal-pos">저장됨 ✓</span>}
              <select
                value={row.role ?? ''}
                onChange={e => updateRow(row.email, { role: (e.target.value || null) as Role | null })}
                className="border border-line rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">— 접근 없음 —</option>
                {ROLES.map(r => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
              <button
                onClick={() => save(row.email)}
                disabled={row.saving}
                className="px-3 py-1.5 text-xs text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint transition-colors"
              >
                {row.saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
