'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth, useLocale } from '@/app/providers'
import { t, type Locale } from '@/lib/i18n'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const SECTIONS: { key: string; label: string }[] = [
  { key: 'hr', label: 'HR / Attendance' },
  { key: 'utilities', label: 'Utility Dashboard' },
  { key: 'licenses', label: 'Licenses' },
  { key: 'assets', label: 'Assets' },
  { key: 'supplies', label: 'Supplies' },
  { key: 'admin', label: 'Admin / Settings' },
]

export default function AdminPage() {
  const { locale, setLocale } = useLocale()
  const { isSuperAdmin } = useAuth()

  const languages: { code: Locale; label: string; flag: string }[] = [
    { code: 'en', label: t('settings.lang.en', locale), flag: '🇺🇸' },
    { code: 'ko', label: t('settings.lang.ko', locale), flag: '🇰🇷' },
  ]

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-bold text-gray-800 mb-1">{t('settings.title', locale)}</h1>
      <p className="text-sm text-gray-400 mb-6">{t('nav.admin', locale)}</p>

      {isSuperAdmin && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-0.5">{t('settings.language', locale)}</h2>
          <p className="text-xs text-gray-400 mb-4">{t('settings.language.desc', locale)}</p>
          <div className="flex gap-3">
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => setLocale(lang.code)}
                className={`flex items-center gap-2.5 px-5 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  locale === lang.code
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="text-lg">{lang.flag}</span>
                {lang.label}
                {locale === lang.code && <span className="ml-1 text-blue-500">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {isSuperAdmin && (
        <div className="mt-6">
          <UserAccessPanel />
        </div>
      )}
      {isSuperAdmin && <Link href="/admin/pto-policy" className="mt-6 block rounded-xl border border-line-soft bg-white p-5 text-sm font-semibold text-ink shadow-sm hover:bg-pill">Manage company PTO policies <span className="text-ink-muted">→</span></Link>}
    </div>
  )
}

interface AuthUser {
  user_id: string
  email: string
  created_at: string
  sections: string[]
  source: 'uuid' | 'legacy'
}

interface UserRow {
  user_id: string
  email: string
  fullAccess: boolean
  sections: Set<string>
  saving: boolean
  saved: boolean
}

function UserAccessPanel() {
  const [rows, setRows] = useState<Record<string, UserRow>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setError('Not signed in.')
        return
      }

      const usersRes = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body: unknown = await usersRes.json().catch(() => null)

      if (!usersRes.ok) {
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Failed to load users (${usersRes.status})`
        setError(message)
        return
      }

      if (!body || typeof body !== 'object' || !('users' in body) || !Array.isArray(body.users)) {
        throw new Error('Invalid user list response')
      }

      const next: Record<string, UserRow> = {}
      for (const user of body.users) {
        if (!user || typeof user !== 'object' || typeof user.user_id !== 'string' || !user.user_id || typeof user.email !== 'string' || !user.email) {
          throw new Error('Invalid user list row')
        }
        const allowed = Array.isArray(user.sections) ? user.sections : []
        next[user.user_id] = {
          user_id: user.user_id,
          email: user.email,
          fullAccess: SECTIONS.every(s => allowed.includes(s.key)),
          sections: new Set(allowed),
          saving: false,
          saved: false,
        }
      }
      setRows(next)
    } catch {
      setError('Failed to load users.')
    } finally {
      setLoading(false)
    }
  }

  function updateRow(userId: string, patch: Partial<UserRow>) {
    setRows(r => ({ ...r, [userId]: { ...r[userId], ...patch, saved: false } }))
  }

  async function save(userId: string) {
    const row = rows[userId]
    if (!row) return
    updateRow(userId, { saving: true })
    const sections = row.fullAccess ? SECTIONS.map(s => s.key) : Array.from(row.sections)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      updateRow(userId, { saving: false, saved: false })
      return
    }

    const response = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, sections }),
    })
    updateRow(userId, { saving: false, saved: response.ok })
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
        <p className="text-sm text-gray-400">Loading users…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">User Access</h2>
        <p className="text-xs text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-0.5">User Access</h2>
      <p className="text-xs text-gray-400 mb-4">
        Which top-level sections each logged-in account can see. A user with Full Access can reach everything.
      </p>

      <div className="space-y-4">
        {Object.values(rows).map(row => (
          <div key={row.email} className="border border-gray-100 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-800">{row.email}</span>
              <div className="flex items-center gap-3">
                {row.saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
                <button
                  onClick={() => save(row.user_id)}
                  disabled={row.saving}
                  className="px-3 py-1 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors"
                >
                  {row.saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={row.fullAccess}
                onChange={e => updateRow(row.user_id, { fullAccess: e.target.checked })}
                className="w-4 h-4 accent-blue-600"
              />
              Full Access
            </label>

            {!row.fullAccess && (
              <div className="flex flex-wrap gap-3 pl-6">
                {SECTIONS.map(s => (
                  <label key={s.key} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.sections.has(s.key)}
                      onChange={e => {
                        const next = new Set(row.sections)
                        if (e.target.checked) next.add(s.key)
                        else next.delete(s.key)
                        updateRow(row.user_id, { sections: next })
                      }}
                      className="w-3.5 h-3.5 accent-blue-600"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
