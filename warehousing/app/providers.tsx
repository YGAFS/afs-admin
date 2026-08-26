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
  isSuperAdmin: boolean
  setLocale: (locale: UiLanguage) => Promise<boolean>
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  role: null,
  locale: DEFAULT_UI_LANGUAGE,
  canManageLocale: false,
  isSuperAdmin: false,
  setLocale: async () => false,
})

export const useAuth = () => useContext(AuthContext)

export default function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [roleLoading, setRoleLoading] = useState(true)
  const [role, setRole] = useState<Role | 'none' | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
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

  const userId = user?.id ?? null
  const userEmail = user?.email ?? null

  useEffect(() => {
    if (loading) return
    if (!userId) {
      setRole('none')
      setIsSuperAdmin(false)
      setRoleLoading(false)
      setLocaleState(DEFAULT_UI_LANGUAGE)
      setSettingsLoading(false)
      return
    }
    setRoleLoading(true)
    setRole('none')
    setIsSuperAdmin(false)
    async function loadAuthorization() {
      const sb = getSupabase()
      const { data: profile, error: profileError } = await sb.from('user_profiles').select('status,authz_migrated_at').eq('user_id', userId).maybeSingle()
      if (profileError || (profile && profile.status !== 'active')) return
      if (profile?.authz_migrated_at) {
        const { data: globalRole, error: globalError } = await sb.from('user_global_roles').select('role').eq('user_id', userId).eq('role', 'super_admin').maybeSingle()
        if (globalError) return
        setIsSuperAdmin(!!globalRole)
        const { data: appRole, error: appError } = await sb.from('app_user_roles').select('role').eq('user_id', userId).eq('app_key', 'warehousing').maybeSingle()
        if (!appError && appRole && ['requester', 'purchasing', 'operations', 'bookkeeping', 'admin'].includes(appRole.role)) setRole(appRole.role as Role)
        return
      }
      const normalizedEmail = userEmail?.trim().toLowerCase() ?? ''
      setIsSuperAdmin(ADMIN_EMAILS.includes(normalizedEmail))
      const { data: legacy, error: legacyError } = await sb.from('app_access').select('role').eq('email', normalizedEmail).eq('app', 'warehousing').maybeSingle()
      if (!legacyError && legacy && ['requester', 'purchasing', 'operations', 'bookkeeping', 'admin'].includes(legacy.role)) setRole(legacy.role as Role)
    }
    loadAuthorization().finally(() => setRoleLoading(false))
  }, [userId, userEmail, loading])

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
    if (!userId || !isSuperAdmin) return false
    const { error } = await getSupabase()
      .from('warehousing_settings')
      .upsert({ key: 'ui_language', value: locale }, { onConflict: 'key' })
    if (error) return false
    setLocaleState(locale)
    return true
  }

  const canManageLocale = !!userId && isSuperAdmin

  return (
    <AuthContext.Provider value={{ user, loading: loading || roleLoading || settingsLoading, role, locale, canManageLocale, isSuperAdmin, setLocale }}>
      {children}
    </AuthContext.Provider>
  )
}
