import { NextRequest } from 'next/server'
import {
  isEmploymentPortalEligible,
  isPortalEmailIdentifier,
  normalizePortalEmail,
  portalBusinessDate,
} from '@/lib/portalAccess'
import { anonymousClient, canonicalPortalOrigin, employeePortalV2SchemaEnabled, serviceRoleClient } from '@/lib/server/supabaseServer'

export const dynamic = 'force-dynamic'
const GENERIC_RESPONSE = {
  ok: true,
  message: 'If this is an email-managed account, recovery instructions may be sent. Admin-managed accounts must be reset by HR or an administrator.',
}

export async function POST(req: NextRequest) {
  if (!employeePortalV2SchemaEnabled()) return Response.json(GENERIC_RESPONSE)
  const input = await req.json().catch(() => null) as { identifier?: unknown } | null
  const identifier = typeof input?.identifier === 'string' ? input.identifier : ''
  if (!isPortalEmailIdentifier(identifier)) return Response.json(GENERIC_RESPONSE)
  const email = normalizePortalEmail(identifier)

  try {
    const admin = serviceRoleClient()
    const usersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const user = usersResult.data?.users.find(candidate => normalizePortalEmail(candidate.email ?? '') === email)
    if (!user) return Response.json(GENERIC_RESPONSE)
    const [profile, link] = await Promise.all([
      admin.from('user_profiles').select('status').eq('user_id', user.id).maybeSingle(),
      admin.from('employee_user_links')
        .select('employee_id,portal_status,portal_login_mode')
        .eq('user_id', user.id)
        .maybeSingle(),
    ])
    if (profile.data?.status !== 'active'
      || link.data?.portal_status !== 'active'
      || link.data?.portal_login_mode !== 'email'
      || !link.data.employee_id) {
      return Response.json(GENERIC_RESPONSE)
    }
    const employee = await admin.from('employees').select('is_active,end_date').eq('id', link.data.employee_id).maybeSingle()
    if (!employee.data || !isEmploymentPortalEligible({
      employeeActive: employee.data.is_active,
      endDate: employee.data.end_date,
    }, portalBusinessDate())) return Response.json(GENERIC_RESPONSE)

    await anonymousClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${canonicalPortalOrigin()}/portal/update-password`,
    })
  } catch {
    // The response is deliberately non-enumerating even when the mail provider fails.
  }
  return Response.json(GENERIC_RESPONSE)
}
