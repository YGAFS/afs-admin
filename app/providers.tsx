'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getMsal } from '@/lib/msal'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n'

const ROOT_SECTION_KEYS = ['hr', 'utilities', 'licenses', 'assets', 'supplies', 'admin'] as const
const ADMIN_EMAILS = ['admin@afstransco.com']

// Lazy singleton — only instantiated client-side (never during SSR/prerender)
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

// ── Auth ──────────────────────────────────────────────────────────────────────

// allowedSections: null = full access to every section. Otherwise, only these
// top-level sidebar sections (e.g. 'utilities', 'hr') are visible/reachable.
type AuthCtx = { user: User | null; loading: boolean; allowedSections: string[] | null; isSuperAdmin: boolean }
const AuthContext = createContext<AuthCtx>({ user: null, loading: true, allowedSections: [], isSuperAdmin: false })
export const useAuth = () => useContext(AuthContext)

// ── Locale ────────────────────────────────────────────────────────────────────

type LocaleCtx = { locale: Locale; setLocale: (l: Locale) => Promise<void> }
const LocaleContext = createContext<LocaleCtx>({ locale: 'en', setLocale: async () => {} })
export const useLocale = () => useContext(LocaleContext)

// ── Combined Provider ─────────────────────────────────────────────────────────

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPortal = pathname === '/portal' || pathname.startsWith('/portal/')
  const [user,    setUser]   = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessLoading, setAccessLoading] = useState(true)
  const [allowedSections, setAllowedSections] = useState<string[] | null>([])
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [locale,  setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    if (isPortal) {
      setUser(null)
      setLoading(false)
      return
    }
    // Initialize MSAL on every page load so popup windows can process OAuth callbacks
    if (process.env.NEXT_PUBLIC_AZURE_CLIENT_ID) {
      getMsal().catch(() => {})
    }
  }, [isPortal])

  useEffect(() => {
    if (isPortal) return
    const sb = getSupabase()
    sb.auth.getUser().then(({ data }) => {
      const u = data.user ?? null
      setUser(u)
      setLocaleState((u?.user_metadata?.locale as Locale) ?? 'en')
      setLoading(false)
    })
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLocaleState((u?.user_metadata?.locale as Locale) ?? 'en')
    })
    return () => subscription.unsubscribe()
  }, [isPortal])

  // Supabase re-emits onAuthStateChange (TOKEN_REFRESHED, USER_UPDATED, tab refocus, etc.)
  // Authorization is keyed by the stable auth user id, not by email.
  const userId = user?.id ?? null
  const userEmail = user?.email ?? null
  useEffect(() => {
    if (isPortal) {
      setAllowedSections([])
      setIsSuperAdmin(false)
      setAccessLoading(false)
      return
    }
    if (loading) return
    if (!userId) {
      setAllowedSections([])
      setIsSuperAdmin(false)
      setAccessLoading(false)
      return
    }
    setAccessLoading(true)
    setAllowedSections([])
    setIsSuperAdmin(false)

    async function loadAuthorization() {
      const sb = getSupabase()
      const { data: profile, error: profileError } = await sb
        .from('user_profiles')
        .select('status, authz_migrated_at')
        .eq('user_id', userId)
        .maybeSingle()

      // A profile query error is fail-closed. It must never resurrect email access.
      if (profileError) return
      if (profile && profile.status !== 'active') return

      if (profile?.authz_migrated_at) {
        const { data: globalRole, error: globalError } = await sb
          .from('user_global_roles')
          .select('role')
          .eq('user_id', userId)
          .eq('role', 'super_admin')
          .maybeSingle()
        if (globalError) return
        if (globalRole) {
          setIsSuperAdmin(true)
          setAllowedSections([...ROOT_SECTION_KEYS])
          return
        }
        const { data: grants, error: grantsError } = await sb
          .from('user_section_access')
          .select('section_key')
          .eq('user_id', userId)
        if (grantsError) return
        setAllowedSections((grants ?? []).map(row => row.section_key))
        return
      }

      // Compatibility is restricted to users without a completed UUID cutover.
      const normalizedEmail = userEmail?.trim().toLowerCase() ?? ''
      const { data: legacy, error: legacyError } = await sb
        .from('user_access')
        .select('allowed_sections')
        .eq('email', normalizedEmail)
        .maybeSingle()
      if (legacyError) return
      if (legacy) {
        const sections = legacy.allowed_sections as string[] | null
        setAllowedSections(sections === null ? [...ROOT_SECTION_KEYS] : sections)
        return
      }
      // Explicit legacy ADMIN_EMAILS compatibility for the administrator with no row.
      if (ADMIN_EMAILS.includes(normalizedEmail)) {
        setIsSuperAdmin(true)
        setAllowedSections([...ROOT_SECTION_KEYS])
      }
    }

    loadAuthorization().finally(() => setAccessLoading(false))
  }, [userId, userEmail, loading, isPortal])

  async function setLocale(l: Locale) {
    setLocaleState(l)
    if (user) {
      await getSupabase().auth.updateUser({ data: { locale: l } })
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading: loading || accessLoading, allowedSections, isSuperAdmin }}>
      <LocaleContext.Provider value={{ locale, setLocale }}>
        {children}
      </LocaleContext.Provider>
    </AuthContext.Provider>
  )
}
