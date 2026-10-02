import { NextRequest } from 'next/server'
import {
  archivedPortalLoginEmail,
  isEmploymentPortalEligible,
  normalizePortalEmail,
  portalBusinessDate,
} from '@/lib/portalAccess'
import { authorizeSuperAdminRequest, portalJsonError } from '@/lib/server/portalAuthorization'
import {
  anonymousClient,
  canonicalPortalOrigin,
  employeeAccountManagementEnabled,
  serviceRoleClient,
} from '@/lib/server/supabaseServer'

export const dynamic = 'force-dynamic'

type ActionBody = {
  action?: 'create' | 'reset' | 'disable' | 'enable' | 'archive'
  employeeId?: string
  email?: string
  delivery?: 'email' | 'link'
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
}

async function allAuthUsers(admin: ReturnType<typeof serviceRoleClient>) {
  const first = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (first.error) throw first.error
  return first.data.users
}

export async function GET(req: NextRequest) {
  if (!employeeAccountManagementEnabled()) return portalJsonError('Not found', 404)
  const actor = await authorizeSuperAdminRequest(req)
  if (!actor) return portalJsonError('Forbidden', 403)

  const admin = serviceRoleClient()
  const [employeesResult, linksResult, profilesResult, users] = await Promise.all([
    actor.db.from('employees')
      .select('id,name,work_email,is_active,end_date,company_id,companies(id,code,name)')
      .order('name'),
    admin.from('employee_user_links')
      .select('employee_id,user_id,portal_status,password_setup_required,disabled_at,archived_login_email'),
    admin.from('user_profiles').select('user_id,status'),
    allAuthUsers(admin),
  ])
  if (employeesResult.error || linksResult.error || profilesResult.error) {
    return portalJsonError('Unable to load employee accounts', 500)
  }

  const links = new Map((linksResult.data ?? []).map(link => [link.employee_id, link]))
  const profiles = new Map((profilesResult.data ?? []).map(profile => [profile.user_id, profile]))
  const authUsers = new Map(users.map(user => [user.id, user]))
  const employees = (employeesResult.data ?? []).map(employee => {
    const link = links.get(employee.id)
    const user = link ? authUsers.get(link.user_id) : null
    const profile = link ? profiles.get(link.user_id) : null
    return {
      ...employee,
      account: link ? {
        authUserId: link.user_id,
        loginEmail: user?.email ?? null,
        portalStatus: link.portal_status,
        passwordSetupRequired: link.password_setup_required,
        profileStatus: profile?.status ?? null,
        disabledAt: link.disabled_at,
        archivedLoginEmail: link.archived_login_email,
        bannedUntil: user?.banned_until ?? null,
      } : null,
    }
  })

  return Response.json({ employees }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!employeeAccountManagementEnabled()) return portalJsonError('Not found', 404)
  const actor = await authorizeSuperAdminRequest(req)
  if (!actor) return portalJsonError('Forbidden', 403)
  const input = await req.json().catch(() => null) as ActionBody | null
  if (!input?.action || !validUuid(input.employeeId)) return portalJsonError('Invalid request', 400)

  const employeeResult = await actor.db.from('employees')
    .select('id,name,work_email,is_active,end_date')
    .eq('id', input.employeeId)
    .maybeSingle()
  if (employeeResult.error || !employeeResult.data) return portalJsonError('Employee not found', 404)
  const employee = employeeResult.data
  const admin = serviceRoleClient()
  const redirectTo = `${canonicalPortalOrigin()}/portal/update-password`

  if (input.action === 'create') {
    const email = normalizePortalEmail(input.email ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return portalJsonError('A valid login email is required', 400)
    if (!isEmploymentPortalEligible({ employeeActive: employee.is_active, endDate: employee.end_date }, portalBusinessDate())) {
      return portalJsonError('Employee is not active', 409)
    }
    const users = await allAuthUsers(admin).catch(() => null)
    if (!users) return portalJsonError('Unable to verify Auth users', 500)
    if (users.some(user => normalizePortalEmail(user.email ?? '') === email)) {
      return portalJsonError('An Auth user already uses this email', 409)
    }

    const invite = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { employee_id: employee.id, portal_invite: true },
    })
    if (invite.error || !invite.data.user?.id) return portalJsonError('Unable to create invitation', 500)
    const provision = await admin.rpc('portal_admin_provision_login', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
      p_auth_user_id: invite.data.user.id,
      p_login_email: email,
    })
    if (provision.error) {
      await admin.auth.admin.updateUserById(invite.data.user.id, { ban_duration: '876000h' })
      return portalJsonError('Invitation created but Portal link failed; invited account was disabled', 500)
    }
    return Response.json({ ok: true })
  }

  const linkResult = await admin.from('employee_user_links')
    .select('user_id,portal_status,archived_login_email')
    .eq('employee_id', employee.id)
    .maybeSingle()
  if (linkResult.error || !linkResult.data?.user_id) return portalJsonError('Employee login not found', 404)
  const linkedUser = await admin.auth.admin.getUserById(linkResult.data.user_id)
  if (linkedUser.error || !linkedUser.data.user) return portalJsonError('Auth user not found', 404)

  if (input.action === 'reset') {
    const reset = await admin.rpc('portal_admin_reset_login', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
    })
    if (reset.error) return portalJsonError(reset.error.message, 409)
    const email = linkedUser.data.user.email
    if (!email) return portalJsonError('Login reset but Auth user has no email', 409)

    if (input.delivery === 'link') {
      const generated = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      const actionLink = generated.data?.properties?.action_link
      if (generated.error || !actionLink) return portalJsonError('Login reset; unable to generate recovery link', 500)
      return Response.json({ ok: true, actionLink }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const mail = await anonymousClient().auth.resetPasswordForEmail(email, { redirectTo })
    if (mail.error) return portalJsonError('Login reset; unable to send recovery email', 500)
    return Response.json({ ok: true })
  }

  if (input.action === 'disable') {
    const disabled = await admin.rpc('portal_admin_set_account_enabled', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
      p_enabled: false,
      p_archived_login_email: null,
    })
    if (disabled.error) return portalJsonError(disabled.error.message, 409)
    const ban = await admin.auth.admin.updateUserById(linkResult.data.user_id, { ban_duration: '876000h' })
    if (ban.error) return portalJsonError('Portal access disabled; Auth ban requires review', 500)
    return Response.json({ ok: true })
  }

  if (input.action === 'enable') {
    if (!isEmploymentPortalEligible({ employeeActive: employee.is_active, endDate: employee.end_date }, portalBusinessDate())) {
      return portalJsonError('Employee is not active', 409)
    }
    const enabled = await admin.rpc('portal_admin_set_account_enabled', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
      p_enabled: true,
      p_archived_login_email: null,
    })
    if (enabled.error) return portalJsonError(enabled.error.message, 409)
    const unban = await admin.auth.admin.updateUserById(linkResult.data.user_id, { ban_duration: 'none' })
    if (unban.error) return portalJsonError('Portal account enabled; Auth unban requires review', 500)
    return Response.json({ ok: true })
  }

  if (input.action === 'archive') {
    if (employee.is_active) return portalJsonError('Employee must be deactivated before archiving the login', 409)
    const currentEmail = linkedUser.data.user.email
    if (!currentEmail) return portalJsonError('Auth user has no login email to archive', 409)
    const disabled = await admin.rpc('portal_admin_set_account_enabled', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
      p_enabled: false,
      p_archived_login_email: currentEmail,
    })
    if (disabled.error) return portalJsonError(disabled.error.message, 409)
    const archivedEmail = archivedPortalLoginEmail(linkResult.data.user_id)
    const archived = await admin.auth.admin.updateUserById(linkResult.data.user_id, {
      email: archivedEmail,
      email_confirm: true,
      ban_duration: '876000h',
    })
    if (archived.error) return portalJsonError('Account disabled; Auth email archive requires review', 500)
    return Response.json({ ok: true, archivedEmail })
  }

  return portalJsonError('Invalid action', 400)
}
