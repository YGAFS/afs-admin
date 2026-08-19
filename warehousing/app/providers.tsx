'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { getMsal } from '@/lib/msal'
import { ADMIN_EMAILS, DEFAULT_UI_LANGUAGE, type UiLanguage } from '@/lib/i18n'

export type Role = 'requester' | 'purchasing' | 'operations' | 'bookkeeping' | 'admin'

let _supabase: SupabaseClient | null = null
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
    )
  }
  return _supabase
}

type AuthCtx = {
  user: User | null
  loading: boolean
  role: Role | 'none' | null
  locale: UiLanguage
  canManageLocale: boolean
  setLocale: (locale: UiLanguage) => Promise<boolean>
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  role: null,
  locale: DEFAULT_UI_LANGUAGE,
  canManageLocale: false,
  setLocale: async () => false,
})

export const useAuth = () => useContext(AuthContext)

export default function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [roleLoading, setRoleLoading] = useState(true)
  const [role, setRole] = useState<Role | 'none' | null>(null)
  const [locale, setLocaleState] = useState<UiLanguage>(DEFAULT_UI_LANGUAGE)
  const [settingsLoading, setSettingsLoading] = useState(true)

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AZURE_CLIENT_ID) {
      getMsal().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const sb = getSupabase()
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const userEmail = user?.email ?? null

  useEffect(() => {
    if (loading) return
    if (!userEmail) {
      setRole(null)
      setRoleLoading(false)
      setLocaleState(DEFAULT_UI_LANGUAGE)
      setSettingsLoading(false)
      return
    }
    setRoleLoading(true)
    getSupabase()
      .from('app_access')
      .select('role')
      .eq('email', userEmail)
      .eq('app', 'warehousing')
      .maybeSingle()
      .then(({ data }) => {
        setRole((data?.role as Role | undefined) ?? 'none')
        setRoleLoading(false)
      })
  }, [userEmail, loading])

  useEffect(() => {
    if (loading) return
    if (!userEmail) return
    setSettingsLoading(true)
    getSupabase()
      .from('warehousing_settings')
      .select('value')
      .eq('key', 'ui_language')
      .maybeSingle()
      .then(({ data }) => {
        setLocaleState(data?.value === 'ko' ? 'ko' : DEFAULT_UI_LANGUAGE)
        setSettingsLoading(false)
      })
  }, [userEmail, loading])

  async function setLocale(locale: UiLanguage) {
    if (!userEmail || !ADMIN_EMAILS.includes(userEmail)) return false
    const { error } = await getSupabase()
      .from('warehousing_settings')
      .upsert({ key: 'ui_language', value: locale }, { onConflict: 'key' })
    if (error) return false
    setLocaleState(locale)
    return true
  }

  const canManageLocale = !!userEmail && ADMIN_EMAILS.includes(userEmail)

  return (
    <AuthContext.Provider value={{ user, loading: loading || roleLoading || settingsLoading, role, locale, canManageLocale, setLocale }}>
      {children}
    </AuthContext.Provider>
  )
}
