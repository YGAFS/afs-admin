'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth, useLocale } from '@/app/providers'
import { t, type Locale } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

// Must match ADMIN_EMAILS in app/api/admin/users/route.ts — that's the real
// enforcement point (it's what the API actually checks); this just decides
// whether to render the panel at all.
const ADMIN_EMAILS = ['admin@afstransco.com']

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
  const { user } = useAuth()

  const languages: { code: Locale; label: string; flag: string }[] = [
    { code: 'en', label: t('settings.lang.en', locale), flag: '🇺🇸' },
    { code: 'ko', label: t('settings.lang.ko', locale), flag: '🇰🇷' },
  ]

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-bold text-gray-800 mb-1">{t('settings.title', locale)}</h1>
      <p className="text-sm text-gray-400 mb-6">{t('nav.admin', locale)}</p>

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

      {user?.email && ADMIN_EMAILS.includes(user.email) && (
        <div className="mt-6">
          <UserAccessPanel />
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
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setError('Not signed in.')
      setLoading(false)
      return
    }

    const [usersRes, accessRes] = await Promise.all([
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
      supabase.from('user_access').select('email, allowed_sections'),
    ])

    if (!usersRes.ok) {
      const body = await usersRes.json().catch(() => ({}))
      setError(body.error || `Failed to load users (${usersRes.status})`)
      setLoading(false)
      return
    }

    const { users } = (await usersRes.json()) as { users: AuthUser[] }
    const accessByEmail = new Map<string, string[] | null>(
      (accessRes.data ?? []).map(r => [r.email as string, r.allowed_sections as string[] | null])
    )

    const next: Record<string, UserRow> = {}
    for (const u of users) {
      const allowed = accessByEmail.get(u.email) ?? null
      next[u.email] = {
        email: u.email,
        fullAccess: allowed === null,
        sections: new Set(allowed ?? SECTIONS.map(s => s.key)),
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
    const allowed_sections = row.fullAccess ? null : Array.from(row.sections)
    const { error: upsertError } = await supabase
      .from('user_access')
      .upsert({ email, allowed_sections }, { onConflict: 'email' })
    updateRow(email, { saving: false, saved: !upsertError })
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
                  onClick={() => save(row.email)}
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
                onChange={e => updateRow(row.email, { fullAccess: e.target.checked })}
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
                        updateRow(row.email, { sections: next })
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
