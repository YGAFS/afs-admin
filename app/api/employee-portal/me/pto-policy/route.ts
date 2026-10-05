import { NextRequest } from 'next/server'
import { authorizeEmployeePortalRequest, portalJsonError } from '@/lib/server/employeePortalAuthorization'
import { loadPolicyDocument } from '@/lib/server/policyDocument'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeEmployeePortalRequest(req)
  if (!auth) return portalJsonError('Employee portal access denied', 403)
  const company = await auth.db.from('companies').select('name,code').eq('id', auth.employee.company_id).maybeSingle()
  if (company.error || !company.data) return portalJsonError('Unable to load PTO policy', 500)
  if (company.data.code?.trim().toUpperCase() !== 'AFS') {
    return portalJsonError('This PTO policy is only available to AFS employees', 403)
  }
  try {
    const policy = await loadPolicyDocument(company.data.code)
    return Response.json({ company: { name: company.data.name }, policy }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return portalJsonError('The policy document is invalid', 500)
  }
}
