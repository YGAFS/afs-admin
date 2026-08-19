'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { getMsal } from '@/lib/msal'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'

export type Role = 'requester' | 'purchasing' | 'operations' | 'bookkeeping' | 'admin'

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

// role: null while loading, or once resolved: a Role if the user has an
// app_access row for app='warehousing', otherwise `'none'` — unlike the HR
// app's `allowedSections` (null = full access), a missing row here means NO
// access, not full access, since this app handles approvals/financial data.
type AuthCtx = { user: User | null; loading: boolean; role: Role | 'none' | null }
const AuthContext = createContext<AuthCtx>({ user: null, loading: true, role: null })
export const useAuth = () => useContext(AuthContext)

export default function Providers({ children }: { children: React.ReactNode }) {
  const [user,    setUser]   = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [roleLoading, setRoleLoading] = useState(true)
  const [role, setRole] = useState<Role | 'none' | null>(null)

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

  // Keyed on the stable email string, not the User object reference — Supabase
  // re-emits onAuthStateChange (TOKEN_REFRESHED, tab refocus, etc.) with a new
  // object for the same account, which would otherwise re-run this and flicker
  // `loading` on every one of those events (same lesson learned in the HR app's
  // providers.tsx).
  const userEmail = user?.email ?? null
  useEffect(() => {
    if (loading) return
    if (!userEmail) {
      setRole(null)
      setRoleLoading(false)
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

  return (
    <AuthContext.Provider value={{ user, loading: loading || roleLoading, role }}>
      {children}
    </AuthContext.Provider>
  )
}
