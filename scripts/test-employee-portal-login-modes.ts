import assert from 'node:assert/strict'
import {
  isPortalEmailIdentifier,
  isPortalLoginId,
  normalizePortalLoginId,
} from '../lib/portalAccess.ts'
import {
  generateTemporaryPortalPassword,
  portalRateLimitKey,
  syntheticPortalAuthEmail,
} from '../lib/server/portalCredentials.ts'
import { canonicalPortalOrigin } from '../lib/server/supabaseServer.ts'

assert.equal(normalizePortalLoginId(' a014 '), 'A014')
assert.equal(isPortalLoginId('A014'), true)
assert.equal(isPortalLoginId('a014'), true)
assert.equal(isPortalLoginId('A14'), false)
assert.equal(isPortalLoginId('shared@afstransco.com'), false)
assert.equal(isPortalEmailIdentifier('employee@example.com'), true)
assert.equal(isPortalEmailIdentifier('A014'), false)

assert.equal(syntheticPortalAuthEmail('A014'), 'portal+a014@afstransco.invalid')

const passwords = new Set(Array.from({ length: 100 }, () => generateTemporaryPortalPassword()))
assert.equal(passwords.size, 100)
for (const password of passwords) {
  assert.ok(password.length >= 36)
  assert.match(password, /[A-Z]/)
  assert.match(password, /[a-z]/)
  assert.match(password, /[0-9]/)
  assert.match(password, /[^A-Za-z0-9]/)
}

const key = portalRateLimitKey('account', 'A014')
assert.match(key, /^[0-9a-f]{64}$/)
assert.equal(key.includes('A014'), false)
assert.notEqual(key, portalRateLimitKey('account', 'A015'))

const originalVercelEnv = process.env.VERCEL_ENV
const originalVercelUrl = process.env.VERCEL_URL
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
process.env.VERCEL_ENV = 'preview'
process.env.VERCEL_URL = 'afs-admin-preview.example.vercel.app'
assert.equal(canonicalPortalOrigin(), 'https://afs-admin-preview.example.vercel.app')
process.env.VERCEL_ENV = 'production'
process.env.NEXT_PUBLIC_SITE_URL = 'https://hr.afstransco.com'
assert.equal(canonicalPortalOrigin(), 'https://hr.afstransco.com')
if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
else process.env.VERCEL_ENV = originalVercelEnv
if (originalVercelUrl === undefined) delete process.env.VERCEL_URL
else process.env.VERCEL_URL = originalVercelUrl
if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl

console.log('Employee Portal login-mode credential tests passed')
