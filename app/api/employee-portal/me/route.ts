import { NextRequest } from 'next/server'
import { authorizeEmployeePortalRequest, portalJsonError } from '@/lib/server/employeePortalAuthorization'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeEmployeePortalRequest(req)
  if (!auth) return portalJsonError('Employee portal access denied', 403)
  return Response.json({ employee: { id: auth.employee.id, name: auth.employee.name } }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
