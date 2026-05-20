'use client'

import { createContext, useContext, useEffect, useState } from 'react'
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

type AuthCtx = { user: User | null; loading: boolean }
const AuthContext = createContext<AuthCtx>({ user: null, loading: true })
export const useAuth = () => useContext(AuthContext)

// ── Locale ────────────────────────────────────────────────────────────────────

type LocaleCtx = { locale: Locale; setLocale: (l: Locale) => Promise<void> }
const LocaleContext = createContext<LocaleCtx>({ locale: 'en', setLocale: async () => {} })
export const useLocale = () => useContext(LocaleContext)

// ── Combined Provider ─────────────────────────────────────────────────────────

export default function Providers({ children }: { children: React.ReactNode }) {
  const [user,    setUser]   = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [locale,  setLocaleState] = useState<Locale>('en')

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

  async function setLocale(l: Locale) {
    setLocaleState(l)
    if (user) {
      await getSupabase().auth.updateUser({ data: { locale: l } })
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading }}>
      <LocaleContext.Provider value={{ locale, setLocale }}>
        {children}
      </LocaleContext.Provider>
    </AuthContext.Provider>
  )
}
