import { NextRequest } from 'next/server'
import { authorizeEmployeeDirectory } from '@/lib/server/employeeDirectoryAuthorization'

export async function GET(req: NextRequest) {
  const section = req.nextUrl.searchParams.get('section')
  if (section !== 'assets' && section !== 'licenses') return Response.json({ error: 'Invalid directory scope' }, { status: 400 })
  const auth = await authorizeEmployeeDirectory(req, section)
  if (!auth) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const result = await auth.db.from('employees').select('id,name').eq('is_active', true).is('end_date', null).order('name')
  if (result.error) return Response.json({ error: 'Failed to load employee directory' }, { status: 500 })
  return Response.json({ data: result.data ?? [] })
}
