import { createClient, type User } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const ADMIN_EMAILS = ['admin@afstransco.com']
const ALLOWED_APP = 'warehousing'
const ALLOWED_ROLES = new Set(['requester', 'purchasing', 'operations', 'bookkeeping', 'admin'])

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role env vars are not configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}
function frozen() { return process.env.AUTHZ_PERMISSION_MUTATION_FREEZE === 'true' }
async function requireAdmin(req: NextRequest): Promise<User | null> {
  const header = req.headers.get('authorization') ?? ''; const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  const admin = serviceClient(); const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user?.id || !data.user.email) return null
  const { data: profile, error: profileError } = await admin.from('user_profiles').select('status,authz_migrated_at').eq('user_id', data.user.id).maybeSingle()
  if (profileError || (profile && profile.status !== 'active')) return null
  if (profile?.authz_migrated_at) {
    const { data: role, error: roleError } = await admin.from('user_global_roles').select('role').eq('user_id', data.user.id).eq('role', 'super_admin').maybeSingle()
    return !roleError && role ? data.user : null
  }
  return ADMIN_EMAILS.includes(data.user.email.trim().toLowerCase()) ? data.user : null
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = serviceClient()
  const [usersResult, profilesResult, rolesResult, legacyResult] = await Promise.all([
    admin.auth.admin.listUsers(), admin.from('user_profiles').select('user_id,status,authz_migrated_at'),
    admin.from('app_user_roles').select('user_id,app_key,role'), admin.from('app_access').select('email,role').eq('app', ALLOWED_APP),
  ])
  if (usersResult.error || profilesResult.error || rolesResult.error || legacyResult.error) return NextResponse.json({ error: 'Failed to load normalized app access data' }, { status: 500 })
  const profiles = new Map((profilesResult.data ?? []).map(row => [row.user_id, row]))
  const roles = new Map((rolesResult.data ?? []).map(row => [row.user_id, row.role]))
  const legacy = new Map((legacyResult.data ?? []).map(row => [row.email.trim().toLowerCase(), row.role]))
  const users = usersResult.data.users.filter(user => !!user.email).map(user => {
    const profile = profiles.get(user.id); const migrated = !!profile?.authz_migrated_at; const active = !profile || profile.status === 'active'
    const email = user.email as string; let role: string | null = null
    if (active && migrated) role = roles.get(user.id) ?? null
    else if (active && legacy.has(email.trim().toLowerCase())) role = legacy.get(email.trim().toLowerCase()) ?? null
    return { user_id: user.id, email, created_at: user.created_at, role, source: migrated ? 'uuid' : 'legacy' }
  }).sort((a, b) => a.email.localeCompare(b.email))
  return NextResponse.json({ users })
}

async function targetUser(admin: ReturnType<typeof serviceClient>, userId: unknown) {
  if (typeof userId !== 'string' || !userId) return null
  const result = await admin.auth.admin.getUserById(userId)
  if (result.error || !result.data.user?.email) return null
  const profile = await admin.from('user_profiles').select('status,authz_migrated_at').eq('user_id', userId).maybeSingle()
  if (profile.error) throw new Error('Failed to load target authorization state')
  return { user: result.data.user, profile: profile.data }
}

export async function PATCH(req: NextRequest) {
  if (frozen()) return NextResponse.json({ error: 'Permission mutations are temporarily frozen' }, { status: 503 })
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = serviceClient(); const body = await req.json().catch(() => null) as { user_id?: unknown; app?: unknown; role?: unknown } | null
  if (!body || typeof body.user_id !== 'string' || body.app !== ALLOWED_APP || typeof body.role !== 'string' || !ALLOWED_ROLES.has(body.role)) return NextResponse.json({ error: 'Invalid user_id, app, or role' }, { status: 400 })
  const target = await targetUser(admin, body.user_id); if (!target) return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
  if (target.profile?.authz_migrated_at) {
    const { error } = await admin.from('app_user_roles').upsert({ user_id: body.user_id, app_key: ALLOWED_APP, role: body.role }, { onConflict: 'user_id,app_key' })
    if (error) return NextResponse.json({ error: 'Failed to save UUID app role' }, { status: 500 })
  } else {
    const { error } = await admin.from('app_access').upsert({ email: target.user.email, app: ALLOWED_APP, role: body.role }, { onConflict: 'email,app' })
    if (error) return NextResponse.json({ error: 'Failed to save legacy app role' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (frozen()) return NextResponse.json({ error: 'Permission mutations are temporarily frozen' }, { status: 503 })
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = serviceClient(); const body = await req.json().catch(() => null) as { user_id?: unknown; app?: unknown } | null
  if (!body || typeof body.user_id !== 'string' || body.app !== ALLOWED_APP) return NextResponse.json({ error: 'Invalid user_id or app' }, { status: 400 })
  const target = await targetUser(admin, body.user_id); if (!target) return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
  const query = target.profile?.authz_migrated_at
    ? admin.from('app_user_roles').delete().eq('user_id', body.user_id).eq('app_key', ALLOWED_APP)
    : admin.from('app_access').delete().eq('email', target.user.email).eq('app', ALLOWED_APP)
  const { error } = await query
  if (error) return NextResponse.json({ error: 'Failed to delete app role' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
