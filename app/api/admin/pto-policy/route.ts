import { NextRequest } from 'next/server'
import { authorizeHrRequest, jsonError } from '@/lib/server/hrAuthorization'
import { loadPolicyDocument } from '@/lib/server/policyDocument'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeHrRequest(req, { action: 'read', allowAssignedCompanies: true })
  if (!auth?.isSuperAdmin) return jsonError('Not authorized', 403)
  const companies = await auth.db.from('companies').select('id,code,name').order('name')
  if (companies.error) return jsonError('Unable to load companies', 500)
  const policies = await Promise.all((companies.data ?? []).map(async company => {
    const policy = await loadPolicyDocument(company.code)
    return { company, policy: policy ? { metadata: policy.metadata, markdown: policy.markdown } : null }
  }))
  return Response.json({ policies }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST() {
  return Response.json({ error: 'Policies are managed as reviewed Git Markdown files.' }, { status: 405, headers: { Allow: 'GET' } })
}
