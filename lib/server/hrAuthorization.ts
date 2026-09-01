import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

export type HrAction = 'read' | 'write' | 'delete'
export type HrTiming = { add: (name: string, elapsedMs: number) => void }
export type HrAuthorization = {
  user: User
  db: SupabaseClient
  isSuperAdmin: boolean
  companyId: string | null
  companyIds: string[]
  employeeId: string | null
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role env vars are not configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function bearerToken(req: NextRequest) {
  const value = req.headers.get('authorization') ?? ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

export async function authorizeHrRequest(
  req: NextRequest,
  options: { action: HrAction; companyId?: string | null; companyCode?: string | null; employeeId?: string | null; employeeIds?: string[]; allowCompanyAdmin?: boolean; allowCompanyDiscovery?: boolean; allowAssignedCompanies?: boolean; timing?: HrTiming }
): Promise<HrAuthorization | null> {
  try {
    const db = serviceClient()
    const token = bearerToken(req)
    if (!token) return null
    const timed = async <T>(name: string, operation: PromiseLike<T>) => {
      const startedAt = performance.now(); const result = await operation
      options.timing?.add(name, performance.now() - startedAt); return result
    }
    const { data: auth, error: authError } = await timed('auth.getUser', db.auth.getUser(token))
    const user = auth.user
    if (authError || !user?.id) return null

    const profilePromise = timed('profile', db
      .from('user_profiles').select('status').eq('user_id', user.id).maybeSingle()
    )
    const globalRolePromise = timed('globalRole', db
      .from('user_global_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').maybeSingle()
    )
    const employeeScopePromise = options.employeeId
      ? timed('employee.scope', db.from('employees').select('id,company_id').eq('id', options.employeeId).maybeSingle())
      : options.employeeIds?.length
        ? timed('employee.bulkScope', db.from('employees').select('id,company_id').in('id', options.employeeIds))
        : Promise.resolve({ data: null, error: null })
    const [{ data: profile, error: profileError }, { data: globalRole, error: globalError }, employeeScope] = await Promise.all([
      profilePromise, globalRolePromise, employeeScopePromise,
    ])

    if (profileError || !profile || profile.status !== 'active') return null
    if (globalError) return null
    const isSuperAdmin = !!globalRole

    let resolvedCompanyId = options.companyId ?? null
    let assignedCompanyIds: string[] = resolvedCompanyId ? [resolvedCompanyId] : []
    if (!resolvedCompanyId && options.companyCode) {
      const { data: company, error: companyError } = await timed('company.lookup', db
        .from('companies').select('id').eq('code', options.companyCode.toUpperCase()).maybeSingle()
      )
      if (companyError || !company?.id) return null
      resolvedCompanyId = company.id
      assignedCompanyIds = [company.id]
    }
    if (options.employeeId) {
      const { data: employee, error: employeeError } = employeeScope as { data: { id: string; company_id: string | null } | null; error: unknown }
      if (employeeError || !employee || !employee.company_id) return null
      if (resolvedCompanyId && resolvedCompanyId !== employee.company_id) return null
      resolvedCompanyId = employee.company_id
      assignedCompanyIds = [employee.company_id]
    }
    if (options.employeeIds?.length) {
      const { data: employees, error: employeesError } = employeeScope as { data: Array<{ id: string; company_id: string | null }> | null; error: unknown }
      if (employeesError || !employees || employees.length !== options.employeeIds.length) return null
      const companies = new Set(employees.map(employee => employee.company_id))
      if (companies.size !== 1) return null
      const bulkCompanyId = employees[0].company_id
      if (!bulkCompanyId) return null
      if (resolvedCompanyId && resolvedCompanyId !== bulkCompanyId) return null
      resolvedCompanyId = bulkCompanyId
      assignedCompanyIds = [bulkCompanyId]
    }

    if (!isSuperAdmin && !resolvedCompanyId && options.allowAssignedCompanies && options.action === 'read') {
      const { data: roles, error: rolesError } = await timed('assignedCompanies', db
        .from('user_company_roles').select('company_id')
        .eq('user_id', user.id).in('role', ['hr_admin', 'company_admin'])
      )
      if (rolesError || !roles?.length) return null
      assignedCompanyIds = Array.from(new Set(roles.map(role => role.company_id)))
    }

    if (!isSuperAdmin && !(assignedCompanyIds.length > 0 && options.allowAssignedCompanies && options.action === 'read') && !(options.allowCompanyDiscovery && options.action === 'read' && !resolvedCompanyId && !options.employeeId)) {
      if (!resolvedCompanyId) return null
      const roles = options.allowCompanyAdmin === false ? ['hr_admin'] : ['hr_admin', 'company_admin']
      const { data: role, error: roleError } = await timed('permission', db
        .from('user_company_roles').select('role')
        .eq('user_id', user.id).eq('company_id', resolvedCompanyId).in('role', roles).maybeSingle()
      )
      if (roleError || !role) return null
    }

    return { user, db, isSuperAdmin, companyId: resolvedCompanyId, companyIds: assignedCompanyIds, employeeId: options.employeeId ?? null }
  } catch {
    return null
  }
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status })
}
