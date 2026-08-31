import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

type DirectoryAuthorization = { user: User; db: SupabaseClient; isSuperAdmin: boolean }

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role env vars are not configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function authorizeEmployeeDirectory(req: NextRequest, section: 'assets' | 'licenses'): Promise<DirectoryAuthorization | null> {
  try {
    const db = dbClient()
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) return null
    const { data: auth, error: authError } = await db.auth.getUser(token)
    if (authError || !auth.user?.id) return null
    const { data: profile, error: profileError } = await db.from('user_profiles').select('status').eq('user_id', auth.user.id).maybeSingle()
    if (profileError || !profile || profile.status !== 'active') return null
    const { data: globalRole, error: globalError } = await db.from('user_global_roles').select('role').eq('user_id', auth.user.id).eq('role', 'super_admin').maybeSingle()
    if (globalError) return null
    if (globalRole) return { user: auth.user, db, isSuperAdmin: true }
    const { data: access, error: accessError } = await db.from('user_section_access').select('section_key').eq('user_id', auth.user.id).eq('section_key', section).maybeSingle()
    if (accessError || !access) return null
    return { user: auth.user, db, isSuperAdmin: false }
  } catch {
    return null
  }
}
