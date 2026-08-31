import { createClient } from '@supabase/supabase-js'

export const portalSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

let sessionPromise: ReturnType<typeof portalSupabase.auth.getSession> | null = null
portalSupabase.auth.onAuthStateChange(() => { sessionPromise = null })

export function getPortalSession() {
  if (!sessionPromise) sessionPromise = portalSupabase.auth.getSession()
  return sessionPromise
}

export function employeeSlug(name: string) {
  return name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'employee'
}

export async function portalFetch(path: string, init?: RequestInit) {
  const { data } = await getPortalSession()
  const headers = new Headers(init?.headers)
  if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  return fetch(path, { ...init, headers, cache: 'no-store' })
}

export type PtoResponse = {
  employee: { id: string; name: string; company: { id: string; code: string; name: string }; team: string | null; position: string | null; startDate: string | null; endDate: string | null }
  year: number
  vacation: Record<string, number | boolean | null>
  sick: Record<string, number | boolean | null>
  leaveHistory: Array<{ id: string; date: string; code: string; days: number; hours: number | null }>
}
