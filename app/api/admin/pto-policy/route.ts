import { NextRequest } from 'next/server'
import { authorizeHrRequest, jsonError } from '@/lib/server/hrAuthorization'

export const dynamic = 'force-dynamic'
const BUCKET = 'company-policies'

function companyId(req: NextRequest) { const raw = req.nextUrl.searchParams.get('companyId'); return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null }

export async function GET(req: NextRequest) {
  const id = companyId(req); const auth = await authorizeHrRequest(req, { action: 'read', companyId: id, allowAssignedCompanies: !id })
  if (!auth) return jsonError('Not authorized', 403)
  if (!id) { const companies = await auth.db.from('companies').select('id,code,name').order('name'); if (companies.error) return jsonError('Unable to load companies', 500); return Response.json({ companies: companies.data ?? [] }) }
  const result = await auth.db.from('company_policy_documents').select('storage_path,updated_at').eq('company_id', id).eq('policy_type', 'pto').maybeSingle()
  if (result.error) return jsonError('Unable to load policy status', 500)
  if (req.nextUrl.searchParams.get('preview') === '1' && result.data) {
    const file = await auth.db.storage.from(BUCKET).download(result.data.storage_path)
    if (file.error || !file.data) return jsonError('Unable to load policy preview', 500)
    return Response.json({ policy: { filename: result.data.storage_path.split('/').pop(), updatedAt: result.data.updated_at, markdown: await file.data.text() } })
  }
  return Response.json({ policy: result.data ? { filename: result.data.storage_path.split('/').pop(), updatedAt: result.data.updated_at } : null })
}

export async function POST(req: NextRequest) {
  const id = companyId(req); if (!id) return jsonError('Company is required', 400)
  const auth = await authorizeHrRequest(req, { action: 'write', companyId: id })
  if (!auth) return jsonError('Not authorized', 403)
  const form = await req.formData(); const file = form.get('file')
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.md')) return jsonError('Only Markdown files are accepted', 400)
  if (file.size > 1024 * 1024) return jsonError('File is too large', 400)
  const path = `${id}/pto-policy.md`; const bytes = Buffer.from(await file.arrayBuffer())
  const upload = await auth.db.storage.from(BUCKET).upload(path, bytes, { contentType: 'text/markdown; charset=utf-8', upsert: true })
  if (upload.error) return jsonError('Unable to save policy file', 500)
  const saved = await auth.db.from('company_policy_documents').upsert({ company_id: id, policy_type: 'pto', storage_path: path, updated_at: new Date().toISOString(), updated_by: auth.user.id }, { onConflict: 'company_id,policy_type' }).select('updated_at').single()
  if (saved.error) return jsonError('Unable to save policy metadata', 500)
  return Response.json({ policy: { filename: 'pto-policy.md', updatedAt: saved.data.updated_at } })
}
