import { NextRequest } from 'next/server'
import { authorizeEmployeePortalRequest, portalJsonError } from '@/lib/server/employeePortalAuthorization'
import { loadPortalPtoData, validPortalYear } from '@/lib/server/portalData'

export const dynamic = 'force-dynamic'
const ALLOWED_QUERY_PARAMS = new Set(['year'])

export async function GET(req: NextRequest) {
  const requestStarted = performance.now()
  const keys = Array.from(req.nextUrl.searchParams.keys())
  if (keys.some(key => !ALLOWED_QUERY_PARAMS.has(key))) return portalJsonError('Invalid request', 400)
  const year = validPortalYear(req.nextUrl.searchParams.get('year'))
  if (year === null) return portalJsonError('Invalid year', 400)

  const auth = await authorizeEmployeePortalRequest(req)
  if (!auth) return portalJsonError('Employee portal access denied', 403)

  try {
    const data = await loadPortalPtoData(auth.db, auth.employee, year)
    return Response.json(data, { headers: {
      'Cache-Control': 'no-store',
      'Server-Timing': `total;dur=${(performance.now() - requestStarted).toFixed(1)}`,
    } })
  } catch {
    return portalJsonError('Failed to load employee portal', 500)
  }
}
