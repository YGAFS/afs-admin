import { NextRequest } from 'next/server'
import {
  archivedPortalLoginEmail,
  isEmploymentPortalEligible,
  normalizePortalEmail,
  portalBusinessDate,
  type PortalLoginMode,
} from '@/lib/portalAccess'
import { generateTemporaryPortalPassword, syntheticPortalAuthEmail } from '@/lib/server/portalCredentials'
import { authorizeSuperAdminRequest, portalJsonError } from '@/lib/server/portalAuthorization'
import { portalGraphMailEnabled, sendPortalGraphMail } from '@/lib/server/portalGraphMail'
import {
  anonymousClient,
  canonicalPortalOrigin,
  employeeAccountManagementEnabled,
  serviceRoleClient,
} from '@/lib/server/supabaseServer'

export const dynamic = 'force-dynamic'

type ActionBody = {
  action?: 'create' | 'link_existing' | 'reset' | 'change_email' | 'disable' | 'enable' | 'archive'
  employeeId?: string
  email?: string
  mode?: PortalLoginMode
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
      .select('id,name,work_email,is_active,end_date,employment_type,company_id,companies(id,code,name)')
      .order('name'),
    admin.from('employee_user_links')
      .select('employee_id,user_id,portal_status,password_setup_required,disabled_at,archived_login_email,portal_login_mode,portal_login_id'),
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
        loginMode: link.portal_login_mode,
        loginId: link.portal_login_id,
        loginEmail: link.portal_login_mode === 'email' ? user?.email ?? null : null,
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

  if (input.action === 'link_existing') {
    const email = normalizePortalEmail(input.email ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return portalJsonError('A valid existing Auth email is required', 400)
    }
    if (!isEmploymentPortalEligible({ employeeActive: employee.is_active, endDate: employee.end_date }, portalBusinessDate())) {
      return portalJsonError('Employee is not active', 409)
    }
    const users = await allAuthUsers(admin).catch(() => null)
    if (!users) return portalJsonError('Unable to verify Auth users', 500)
    const matches = users.filter(user => normalizePortalEmail(user.email ?? '') === email)
    if (matches.length !== 1) return portalJsonError('Exactly one active Auth user must match this email', 409)
    const authUser = matches[0]
    const existingLink = await admin.from('employee_user_links')
      .select('employee_id')
      .eq('user_id', authUser.id)
      .maybeSingle()
    if (existingLink.error) return portalJsonError('Unable to verify existing Portal links', 500)
    if (existingLink.data) return portalJsonError('This Auth user is already linked to an employee', 409)
    const provision = await admin.rpc('portal_admin_provision_login_v2', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
      p_auth_user_id: authUser.id,
      p_login_mode: 'email',
      p_portal_login_id: null,
      p_login_email: email,
    })
    if (provision.error) return portalJsonError(provision.error.message, 409)
    return Response.json({ ok: true, mode: 'email', linked: true }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  if (input.action === 'create') {
    const mode: PortalLoginMode = input.mode === 'admin_managed' ? 'admin_managed' : 'email'
    if (!isEmploymentPortalEligible({ employeeActive: employee.is_active, endDate: employee.end_date }, portalBusinessDate())) {
      return portalJsonError('Employee is not active', 409)
    }
    if (mode === 'email') {
      const email = normalizePortalEmail(input.email ?? '')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return portalJsonError('A valid login email is required', 400)
      const users = await allAuthUsers(admin).catch(() => null)
      if (!users) return portalJsonError('Unable to verify Auth users', 500)
      if (users.some(user => normalizePortalEmail(user.email ?? '') === email)) {
        return portalJsonError('An Auth user already uses this email', 409)
      }
      const useGraphMail = portalGraphMailEnabled()
      const invite = useGraphMail
        ? await admin.auth.admin.generateLink({
          type: 'invite', email,
          options: { redirectTo, data: { employee_id: employee.id, portal_invite: true, portal_login_mode: 'email' } },
        })
        : await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: { employee_id: employee.id, portal_invite: true, portal_login_mode: 'email' },
        })
      if (invite.error || !invite.data.user?.id) return portalJsonError('Unable to create invitation', 500)
      const provision = await admin.rpc('portal_admin_provision_login_v2', {
        p_actor_user_id: actor.user.id,
        p_employee_id: employee.id,
        p_auth_user_id: invite.data.user.id,
        p_login_mode: 'email',
        p_portal_login_id: null,
        p_login_email: email,
      })
      if (provision.error) {
        await admin.auth.admin.updateUserById(invite.data.user.id, { ban_duration: '876000h' })
        return portalJsonError('Invitation created but Portal link failed; invited account was disabled', 500)
      }
      if (useGraphMail) {
        const actionLink = 'properties' in invite.data && invite.data.properties
          ? (invite.data.properties as { action_link?: string }).action_link
          : null
        if (!actionLink) return portalJsonError('Login created but invitation link is unavailable; use Reset by email', 500)
        try {
          await sendPortalGraphMail(email, 'invite', actionLink)
        } catch {
          return portalJsonError('Login created but invitation email was not accepted; use Reset by email or Recovery link', 502)
        }
        return Response.json({ ok: true, mode, mailAccepted: true }, { headers: { 'Cache-Control': 'no-store' } })
      }
      return Response.json({ ok: true, mode }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const allocated = await admin.rpc('portal_allocate_login_id', { p_actor_user_id: actor.user.id })
    const loginId = typeof allocated.data === 'string' ? allocated.data : ''
    if (allocated.error || !loginId) return portalJsonError('Unable to allocate Login ID', 500)
    const temporaryPassword = generateTemporaryPortalPassword()
    const created = await admin.auth.admin.createUser({
      email: syntheticPortalAuthEmail(loginId),
      email_confirm: true,
      password: temporaryPassword,
      user_metadata: { employee_id: employee.id, portal_login_mode: 'admin_managed' },
    })
    if (created.error || !created.data.user?.id) return portalJsonError('Unable to create Admin-managed login', 500)
    const provision = await admin.rpc('portal_admin_provision_login_v2', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
      p_auth_user_id: created.data.user.id,
      p_login_mode: 'admin_managed',
      p_portal_login_id: loginId,
      p_login_email: null,
    })
    if (provision.error) {
      await admin.auth.admin.deleteUser(created.data.user.id)
      return portalJsonError('Unable to link Admin-managed login; the unlinked Auth user was removed', 500)
    }
    return Response.json({ ok: true, mode, loginId, temporaryPassword }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const linkResult = await admin.from('employee_user_links')
    .select('user_id,portal_status,archived_login_email,portal_login_mode,portal_login_id')
    .eq('employee_id', employee.id)
    .maybeSingle()
  if (linkResult.error || !linkResult.data?.user_id) return portalJsonError('Employee login not found', 404)
  const linkedUser = await admin.auth.admin.getUserById(linkResult.data.user_id)
  if (linkedUser.error || !linkedUser.data.user) return portalJsonError('Auth user not found', 404)

  if (input.action === 'change_email') {
    if (linkResult.data.portal_login_mode !== 'email') {
      return portalJsonError('Only Email-managed accounts can change login email', 409)
    }

    const newEmail = normalizePortalEmail(input.email ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return portalJsonError('A valid login email is required', 400)
    }

    const currentEmail = normalizePortalEmail(linkedUser.data.user.email ?? '')
    if (!currentEmail) return portalJsonError('Auth user has no login email', 409)
    if (currentEmail === newEmail) return portalJsonError('The new email matches the current login email', 400)

    const users = await allAuthUsers(admin).catch(() => null)
    if (!users) return portalJsonError('Unable to verify Auth users', 500)
    if (users.some(user => user.id !== linkResult.data!.user_id && normalizePortalEmail(user.email ?? '') === newEmail)) {
      return portalJsonError('An Auth user already uses this email', 409)
    }

    const employeesWithEmail = await admin.from('employees')
      .select('id,work_email')
      .eq('is_active', true)
      .not('work_email', 'is', null)
    if (employeesWithEmail.error) return portalJsonError('Unable to verify employee emails', 500)
    if ((employeesWithEmail.data ?? []).some(row => row.id !== employee.id && normalizePortalEmail(row.work_email ?? '') === newEmail)) {
      return portalJsonError('Another active employee already uses this email', 409)
    }

    const authUpdated = await admin.auth.admin.updateUserById(linkResult.data.user_id, {
      email: newEmail,
      email_confirm: true,
    })
    if (authUpdated.error) return portalJsonError('Unable to update the Auth login email', 500)

    const employeeUpdated = await admin.from('employees')
      .update({ work_email: newEmail })
      .eq('id', employee.id)
    if (employeeUpdated.error) {
      await admin.auth.admin.updateUserById(linkResult.data.user_id, {
        email: currentEmail,
        email_confirm: true,
      })
      return portalJsonError('Email update failed and the Auth email was restored', 500)
    }

    return Response.json({ ok: true, mode: 'email', email: newEmail }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  if (input.action === 'reset') {
    const reset = await admin.rpc('portal_admin_reset_login', {
      p_actor_user_id: actor.user.id,
      p_employee_id: employee.id,
    })
    if (reset.error) return portalJsonError(reset.error.message, 409)
    if (linkResult.data.portal_login_mode === 'admin_managed') {
      const temporaryPassword = generateTemporaryPortalPassword()
      const changed = await admin.auth.admin.updateUserById(linkResult.data.user_id, { password: temporaryPassword })
      if (changed.error) return portalJsonError('Login reset; unable to issue a temporary password', 500)
      return Response.json({
        ok: true,
        mode: 'admin_managed',
        loginId: linkResult.data.portal_login_id,
        temporaryPassword,
      }, { headers: { 'Cache-Control': 'no-store' } })
    }
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

    if (portalGraphMailEnabled()) {
      const generated = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
      const actionLink = generated.data?.properties?.action_link
      if (generated.error || !actionLink) return portalJsonError('Login reset; unable to generate recovery link', 500)
      try {
        await sendPortalGraphMail(email, 'recovery', actionLink)
      } catch {
        return portalJsonError('Login reset; recovery email was not accepted. Use Recovery link or retry', 502)
      }
      return Response.json({ ok: true, mailAccepted: true }, { headers: { 'Cache-Control': 'no-store' } })
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
    return Response.json({
      ok: true,
      archivedEmail: linkResult.data.portal_login_mode === 'email' ? archivedEmail : null,
    })
  }

  return portalJsonError('Invalid action', 400)
}
