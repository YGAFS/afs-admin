import { NextRequest } from 'next/server'
import { authenticatedUser, employeePortalV2SchemaEnabled } from '@/lib/server/supabaseServer'
import { portalJsonError } from '@/lib/server/portalAuthorization'

export async function POST(req: NextRequest) {
  if (!employeePortalV2SchemaEnabled()) return portalJsonError('Not found', 404)
  const auth = await authenticatedUser(req)
  if (!auth) return portalJsonError('Unauthorized', 401)
  const result = await auth.db.rpc('complete_portal_password_setup')
  if (result.error || result.data !== true) return portalJsonError('Password setup is not available for this account', 403)
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
