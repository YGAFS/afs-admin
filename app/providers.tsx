'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { getMsal } from '@/lib/msal'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n'

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
type AuthCtx = { user: User | null; loading: boolean; allowedSections: string[] | null }
const AuthContext = createContext<AuthCtx>({ user: null, loading: true, allowedSections: null })
export const useAuth = () => useContext(AuthContext)

// ── Locale ────────────────────────────────────────────────────────────────────

type LocaleCtx = { locale: Locale; setLocale: (l: Locale) => Promise<void> }
const LocaleContext = createContext<LocaleCtx>({ locale: 'en', setLocale: async () => {} })
export const useLocale = () => useContext(LocaleContext)

// ── Combined Provider ─────────────────────────────────────────────────────────

export default function Providers({ children }: { children: React.ReactNode }) {
  const [user,    setUser]   = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessLoading, setAccessLoading] = useState(true)
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null)
  const [locale,  setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    // Initialize MSAL on every page load so popup windows can process OAuth callbacks
    if (process.env.NEXT_PUBLIC_AZURE_CLIENT_ID) {
      getMsal().catch(() => {})
    }
  }, [])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    // Wait until the initial auth check has actually resolved — otherwise this runs
    // once with the placeholder `user === null` before getUser() settles, briefly
    // clearing accessLoading and letting the unfiltered layout flash on screen before
    // flipping back to the loading state once the real user (and their section
    // restrictions) come in.
    if (loading) return
    if (!user?.email) {
      setAllowedSections(null)
      setAccessLoading(false)
      return
    }
    setAccessLoading(true)
    getSupabase()
      .from('user_access')
      .select('allowed_sections')
      .eq('email', user.email)
      .maybeSingle()
      .then(({ data }) => {
        setAllowedSections((data?.allowed_sections as string[] | null) ?? null)
        setAccessLoading(false)
      })
  }, [user, loading])

  async function setLocale(l: Locale) {
    setLocaleState(l)
    if (user) {
      await getSupabase().auth.updateUser({ data: { locale: l } })
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading: loading || accessLoading, allowedSections }}>
      <LocaleContext.Provider value={{ locale, setLocale }}>
        {children}
      </LocaleContext.Provider>
    </AuthContext.Provider>
  )
}
