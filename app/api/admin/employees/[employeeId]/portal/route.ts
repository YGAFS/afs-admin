import { NextRequest } from 'next/server'
import { employeeAccountManagementEnabled } from '@/lib/server/supabaseServer'
import { authorizeSuperAdminRequest, portalJsonError, type PortalEmployee } from '@/lib/server/portalAuthorization'
import { loadPortalPtoData, validPortalYear } from '@/lib/server/portalData'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ employeeId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!employeeAccountManagementEnabled()) return portalJsonError('Not found', 404)
  const auth = await authorizeSuperAdminRequest(req)
  if (!auth) return portalJsonError('Forbidden', 403)

  const year = validPortalYear(req.nextUrl.searchParams.get('year'))
  if (year === null) return portalJsonError('Invalid year', 400)
  const { employeeId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) return portalJsonError('Invalid employee', 400)

  // Both reads use the admin's JWT. Stage 2C RLS explicitly grants
  // super_admin read scope while employee users remain self-linked only.
  const employeeResult = await auth.db.from('employees')
    .select('id,name,company_id,team,position,start_date,end_date,vacation_allowance,uses_accrual,is_exempt,probation_end,is_active,work_email')
    .eq('id', employeeId)
    .maybeSingle()
  if (employeeResult.error || !employeeResult.data?.company_id) return portalJsonError('Employee not found', 404)

  try {
    const data = await loadPortalPtoData(auth.db, employeeResult.data as PortalEmployee, year)
    const audit = await auth.db.rpc('audit_admin_portal_view', { p_employee_id: employeeId })
    if (audit.error) return portalJsonError('Unable to audit Admin View', 500)
    return Response.json({ ...data, adminView: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return portalJsonError('Failed to load Admin View', 500)
  }
}
