import { NextRequest } from 'next/server'
import { authorizeEmployeePortalRequest, portalJsonError } from '@/lib/server/employeePortalAuthorization'

export const dynamic = 'force-dynamic'
const BUCKET = 'company-policies'

export async function GET(req: NextRequest) {
  const auth = await authorizeEmployeePortalRequest(req)
  if (!auth) return portalJsonError('Employee portal access denied', 403)
  const [docResult, companyResult] = await Promise.all([
    auth.db.from('company_policy_documents').select('storage_path,updated_at').eq('company_id', auth.employee.company_id).eq('policy_type', 'pto').maybeSingle(),
    auth.db.from('companies').select('name').eq('id', auth.employee.company_id).maybeSingle(),
  ])
  const { data: doc, error } = docResult
  if (error) return portalJsonError('Unable to load PTO policy', 500)
  if (companyResult.error) return portalJsonError('Unable to load PTO policy', 500)
  if (!doc) return Response.json({ company: { name: companyResult.data?.name ?? 'Your company' }, policy: null }, { headers: { 'Cache-Control': 'no-store' } })
  const file = await auth.db.storage.from(BUCKET).download(doc.storage_path)
  if (file.error || !file.data) return portalJsonError('Unable to load PTO policy', 500)
  return Response.json({ company: { name: companyResult.data?.name ?? 'Your company' }, policy: { markdown: await file.data.text(), updatedAt: doc.updated_at } }, { headers: { 'Cache-Control': 'no-store' } })
}
