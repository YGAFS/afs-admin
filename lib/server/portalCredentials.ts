import { createHash, randomBytes } from 'node:crypto'
import { normalizePortalLoginId } from '../portalAccess.ts'

export function syntheticPortalAuthEmail(loginId: string) {
  return `portal+${normalizePortalLoginId(loginId).toLowerCase()}@afstransco.invalid`
}

export function generateTemporaryPortalPassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`
}

export function portalRateLimitKey(scope: string, value: string) {
  return createHash('sha256').update(`${scope}:${value}`).digest('hex')
}
