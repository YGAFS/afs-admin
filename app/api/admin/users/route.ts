import { createClient, type User } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const ADMIN_EMAILS = ['admin@afstransco.com']
const ROOT_SECTION_KEYS = ['hr', 'utilities', 'licenses', 'assets', 'supplies', 'admin'] as const
const ALLOWED_SECTIONS: ReadonlySet<string> = new Set(ROOT_SECTION_KEYS)

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role env vars are not configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function frozen() { return process.env.AUTHZ_PERMISSION_MUTATION_FREEZE === 'true' }
type AdminActor = { user: User; uuidAuthorized: boolean }

async function requireAdmin(req: NextRequest): Promise<AdminActor | null> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  const admin = serviceClient()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user?.id || !data.user.email) return null
  const { data: profile, error: profileError } = await admin.from('user_profiles').select('status,authz_migrated_at').eq('user_id', data.user.id).maybeSingle()
  if (profileError || (profile && profile.status !== 'active')) return null
  if (profile?.authz_migrated_at) {
    const { data: role, error: roleError } = await admin.from('user_global_roles').select('role').eq('user_id', data.user.id).eq('role', 'super_admin').maybeSingle()
    return !roleError && !!role ? { user: data.user, uuidAuthorized: true } : null
  }
  return ADMIN_EMAILS.includes(data.user.email.trim().toLowerCase()) ? { user: data.user, uuidAuthorized: false } : null
}

type NormalizedUser = {
  user_id: string; email: string; created_at: string; status: string | null
  authz_migrated_at: string | null; is_super_admin: boolean; sections: string[]; source: 'uuid' | 'legacy'
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = serviceClient()
  const [usersResult, profilesResult, globalResult, sectionsResult, legacyResult] = await Promise.all([
    admin.auth.admin.listUsers(), admin.from('user_profiles').select('user_id,status,authz_migrated_at'),
    admin.from('user_global_roles').select('user_id,role'), admin.from('user_section_access').select('user_id,section_key'),
    admin.from('user_access').select('email,allowed_sections'),
  ])
  if (usersResult.error || profilesResult.error || globalResult.error || sectionsResult.error || legacyResult.error) return NextResponse.json({ error: 'Failed to load normalized user access data' }, { status: 500 })
  const profiles = new Map((profilesResult.data ?? []).map(row => [row.user_id, row]))
  const globals = new Set((globalResult.data ?? []).filter(row => row.role === 'super_admin').map(row => row.user_id))
  const sections = new Map<string, string[]>()
  for (const row of sectionsResult.data ?? []) sections.set(row.user_id, [...(sections.get(row.user_id) ?? []), row.section_key])
  const legacy = new Map((legacyResult.data ?? []).map(row => [row.email.trim().toLowerCase(), row.allowed_sections as string[] | null]))
  const users: NormalizedUser[] = usersResult.data.users.filter(user => !!user.email).map(user => {
    const email = user.email as string
    const profile = profiles.get(user.id); const migrated = !!profile?.authz_migrated_at
    const active = !profile || profile.status === 'active'; const superAdmin = migrated && active && globals.has(user.id)
    let allowed: string[] = []
    if (active && superAdmin) allowed = [...ROOT_SECTION_KEYS]
    else if (active && migrated) allowed = sections.get(user.id) ?? []
    else if (active && legacy.has(email.trim().toLowerCase())) allowed = legacy.get(email.trim().toLowerCase()) ?? [...ROOT_SECTION_KEYS]
    else if (active && ADMIN_EMAILS.includes(email.trim().toLowerCase())) allowed = [...ROOT_SECTION_KEYS]
    return { user_id: user.id, email, created_at: user.created_at, status: profile?.status ?? null, authz_migrated_at: profile?.authz_migrated_at ?? null, is_super_admin: superAdmin, sections: allowed, source: (migrated ? 'uuid' : 'legacy') as 'uuid' | 'legacy' }
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

function validateSections(value: unknown): value is string[] { return Array.isArray(value) && value.every(section => typeof section === 'string' && ALLOWED_SECTIONS.has(section)) }

export async function PATCH(req: NextRequest) {
  if (frozen()) return NextResponse.json({ error: 'Permission mutations are temporarily frozen' }, { status: 503 })
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = serviceClient(); const body = await req.json().catch(() => null) as { user_id?: unknown; sections?: unknown } | null
  if (!body || typeof body.user_id !== 'string' || !validateSections(body.sections)) return NextResponse.json({ error: 'Invalid user_id or sections' }, { status: 400 })
  const target = await targetUser(admin, body.user_id); if (!target) return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
  if (target.profile?.authz_migrated_at) {
    const { error } = await admin.rpc('replace_user_section_access', { p_user_id: body.user_id, p_section_keys: body.sections })
    if (error) return NextResponse.json({ error: 'Failed to replace UUID section access' }, { status: 500 })
  } else {
    const { error } = await admin.from('user_access').upsert({ email: target.user.email, allowed_sections: body.sections }, { onConflict: 'email' })
    if (error) return NextResponse.json({ error: 'Failed to save legacy user access' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (frozen()) return NextResponse.json({ error: 'Permission mutations are temporarily frozen' }, { status: 503 })
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = serviceClient(); const body = await req.json().catch(() => null) as { user_id?: unknown } | null
  if (!body || typeof body.user_id !== 'string') return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 })
  const target = await targetUser(admin, body.user_id); if (!target) return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
  if (target.profile?.authz_migrated_at) {
    const { error } = await admin.rpc('replace_user_section_access', { p_user_id: body.user_id, p_section_keys: [] })
    if (error) return NextResponse.json({ error: 'Failed to clear UUID section access' }, { status: 500 })
  } else {
    const { error } = await admin.from('user_access').delete().eq('email', target.user.email)
    if (error) return NextResponse.json({ error: 'Failed to delete legacy user access' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
