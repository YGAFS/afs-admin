'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user ?? null
      setUser(u)
      setLocaleState((u?.user_metadata?.locale as Locale) ?? 'en')
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLocaleState((u?.user_metadata?.locale as Locale) ?? 'en')
    })
    return () => subscription.unsubscribe()
  }, [])

  async function setLocale(l: Locale) {
    setLocaleState(l)
    if (user) {
      await supabase.auth.updateUser({ data: { locale: l } })
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
