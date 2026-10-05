import { NextRequest } from 'next/server'
import { authenticatedUser, employeePortalV2SchemaEnabled, serviceRoleClient } from '@/lib/server/supabaseServer'
import { portalJsonError } from '@/lib/server/portalAuthorization'

export const dynamic = 'force-dynamic'

async function setupState(req: NextRequest) {
  const auth = await authenticatedUser(req)
  if (!auth) return null
  const [profile, link] = await Promise.all([
    auth.db.from('user_profiles').select('status').eq('user_id', auth.user.id).maybeSingle(),
    auth.db.from('employee_user_links')
      .select('portal_status,password_setup_required')
      .eq('user_id', auth.user.id)
      .maybeSingle(),
  ])
  if (profile.error || link.error || profile.data?.status !== 'active' || !link.data) return null
  if (link.data.portal_status === 'disabled') return null
  return { auth, required: link.data.password_setup_required === true }
}

export async function GET(req: NextRequest) {
  if (!employeePortalV2SchemaEnabled()) return Response.json({ required: false }, { headers: { 'Cache-Control': 'no-store' } })
  const state = await setupState(req)
  if (!state) return portalJsonError('Unauthorized', 401)
  return Response.json({ required: state.required }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!employeePortalV2SchemaEnabled()) return portalJsonError('Not found', 404)
  const state = await setupState(req)
  if (!state) return portalJsonError('Unauthorized', 401)
  const input = await req.json().catch(() => null) as { password?: unknown } | null
  const password = typeof input?.password === 'string' ? input.password : ''
  if (password.length < 12 || password.length > 128) return portalJsonError('Use a password between 12 and 128 characters', 400)

  const admin = serviceRoleClient()
  const changed = await admin.auth.admin.updateUserById(state.auth.user.id, { password })
  if (changed.error) return portalJsonError('Unable to update password', 400)

  // This service-role-only finalize is intentionally called only after Auth
  // accepted the new password. If it fails, the setup-required flag remains
  // true and the user can retry this same endpoint with the new password.
  const finalized = await admin.rpc('portal_finalize_password_setup', {
    p_user_id: state.auth.user.id,
  })
  if (finalized.error || finalized.data !== true) {
    return Response.json({
      error: 'Password changed, but Portal activation did not complete. Sign in with the new password and try again.',
      retryable: true,
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
