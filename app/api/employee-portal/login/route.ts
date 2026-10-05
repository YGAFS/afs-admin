import { NextRequest } from 'next/server'
import {
  isPortalEmailIdentifier,
  isPortalLoginId,
  normalizePortalEmail,
  normalizePortalLoginId,
} from '@/lib/portalAccess'
import { portalRateLimitKey } from '@/lib/server/portalCredentials'
import {
  anonymousClient,
  employeePortalV2SchemaEnabled,
  serviceRoleClient,
} from '@/lib/server/supabaseServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const GENERIC_ERROR = 'Unable to sign in. Please check your Email or Login ID and password.'
const DUMMY_AUTH_EMAIL = 'portal+unknown@afstransco.invalid'

function errorResponse(status = 401) {
  return Response.json({ error: GENERIC_ERROR }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function requestIp(req: NextRequest) {
  return (req.headers.get('x-forwarded-for')?.split(',')[0]
    || req.headers.get('x-real-ip')
    || 'unknown').trim().slice(0, 128)
}

async function consumeRateLimit(keyHash: string, limit: number) {
  const result = await serviceRoleClient().rpc('portal_consume_login_attempt', {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: 900,
    p_block_seconds: 900,
  })
  return !result.error && result.data === true
}

export async function POST(req: NextRequest) {
  const input = await req.json().catch(() => null) as { identifier?: unknown; password?: unknown } | null
  const rawIdentifier = typeof input?.identifier === 'string' ? input.identifier : ''
  const password = typeof input?.password === 'string' ? input.password : ''
  const normalizedIdentifier = isPortalEmailIdentifier(rawIdentifier)
    ? normalizePortalEmail(rawIdentifier)
    : normalizePortalLoginId(rawIdentifier)

  if (!normalizedIdentifier || !password || password.length > 1024) return errorResponse()

  if (employeePortalV2SchemaEnabled()) {
    const ip = requestIp(req)
    const [ipAllowed, accountAllowed] = await Promise.all([
      consumeRateLimit(portalRateLimitKey('ip', ip), 30),
      consumeRateLimit(portalRateLimitKey('account', normalizedIdentifier), 12),
    ])
    if (!ipAllowed || !accountAllowed) return errorResponse(429)
  }

  let authEmail = DUMMY_AUTH_EMAIL
  if (isPortalEmailIdentifier(normalizedIdentifier)) {
    authEmail = normalizePortalEmail(normalizedIdentifier)
  } else if (employeePortalV2SchemaEnabled() && isPortalLoginId(normalizedIdentifier)) {
    const admin = serviceRoleClient()
    const link = await admin.from('employee_user_links')
      .select('user_id')
      .eq('portal_login_mode', 'admin_managed')
      .ilike('portal_login_id', normalizedIdentifier)
      .maybeSingle()
    if (!link.error && link.data?.user_id) {
      const user = await admin.auth.admin.getUserById(link.data.user_id)
      if (!user.error && user.data.user?.email) authEmail = user.data.user.email
    }
  }

  const signedIn = await anonymousClient().auth.signInWithPassword({ email: authEmail, password })
  const session = signedIn.data.session
  if (signedIn.error || !session?.access_token || !session.refresh_token) return errorResponse()

  return Response.json({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
