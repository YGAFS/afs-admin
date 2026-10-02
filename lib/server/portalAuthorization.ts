import { type SupabaseClient, type User } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import {
  isPortalDataAccessAllowed,
  portalBusinessDate,
  type PortalLifecycleStatus,
} from '../portalAccess.ts'
import {
  authenticatedUser,
  employeePortalV2SchemaEnabled,
  serviceRoleClient,
} from './supabaseServer.ts'

export type PortalEmployee = {
  id: string
  name: string
  company_id: string
  team: string | null
  position: string | null
  start_date: string | null
  end_date: string | null
  vacation_allowance: number
  uses_accrual: boolean
  is_exempt: boolean
  probation_end: string | null
  is_active: boolean
  work_email: string | null
}

export type PortalAuthorization = {
  user: User
  db: SupabaseClient
  employee: PortalEmployee
}

export async function resolvePortalAuthorization(
  auth: { user: User; db: SupabaseClient },
  businessDate = portalBusinessDate(),
): Promise<PortalAuthorization | null> {
  try {
    const [profileResult, linkResult] = await Promise.all([
      auth.db.from('user_profiles').select('status').eq('user_id', auth.user.id).maybeSingle(),
      auth.db.from('employee_user_links')
        .select('employee_id,user_id,portal_status,password_setup_required')
        .eq('user_id', auth.user.id)
        .maybeSingle(),
    ])
    const profile = profileResult.data
    const link = linkResult.data
    if (profileResult.error || linkResult.error || !profile || !link?.employee_id) return null
    if (link.user_id !== auth.user.id) return null

    // Reset Login and Disable Account are rejected before any Employee/PTO read.
    if (profile.status !== 'active'
      || link.portal_status !== 'active'
      || link.password_setup_required !== false) return null

    const employeeResult = await auth.db.from('employees')
      .select('id,name,company_id,team,position,start_date,end_date,vacation_allowance,uses_accrual,is_exempt,probation_end,is_active,work_email')
      .eq('id', link.employee_id)
      .maybeSingle()
    if (employeeResult.error || !employeeResult.data?.company_id) return null

    const employee = employeeResult.data as PortalEmployee
    if (!isPortalDataAccessAllowed({
      profileStatus: profile.status,
      portalStatus: link.portal_status as PortalLifecycleStatus,
      passwordSetupRequired: link.password_setup_required,
      employeeActive: employee.is_active,
      endDate: employee.end_date,
    }, businessDate)) return null

    return { user: auth.user, db: auth.db, employee }
  } catch {
    return null
  }
}

export async function authorizePortalRequest(req: NextRequest): Promise<PortalAuthorization | null> {
  const auth = await authenticatedUser(req)
  if (!auth) return null
  if (employeePortalV2SchemaEnabled()) return resolvePortalAuthorization(auth)

  // Deployment compatibility path: Preview/Production code can be deployed
  // before the additive v2 migration without breaking the existing Portal.
  // This is the documented technical exception to JWT/RLS reads. It is used
  // only while EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED is not true.
  try {
    const db = serviceRoleClient()
    const [profileResult, linkResult] = await Promise.all([
      db.from('user_profiles').select('status').eq('user_id', auth.user.id),
      db.from('employee_user_links').select('employee_id,user_id').eq('user_id', auth.user.id),
    ])
    if (profileResult.error || linkResult.error
      || profileResult.data?.length !== 1 || profileResult.data[0].status !== 'active'
      || linkResult.data?.length !== 1 || linkResult.data[0].user_id !== auth.user.id) return null

    const employeeResult = await db.from('employees')
      .select('id,name,company_id,team,position,start_date,end_date,vacation_allowance,uses_accrual,is_exempt,probation_end,is_active')
      .eq('id', linkResult.data[0].employee_id)
    if (employeeResult.error || employeeResult.data?.length !== 1 || !employeeResult.data[0].company_id) return null
    return {
      user: auth.user,
      db,
      employee: { ...employeeResult.data[0], work_email: null } as PortalEmployee,
    }
  } catch {
    return null
  }
}

export async function authorizeSuperAdminRequest(req: NextRequest) {
  try {
    const auth = await authenticatedUser(req)
    if (!auth) return null
    const result = await auth.db.rpc('stage2c_is_super_admin')
    if (result.error || result.data !== true) return null
    return auth
  } catch {
    return null
  }
}

export function portalJsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}
