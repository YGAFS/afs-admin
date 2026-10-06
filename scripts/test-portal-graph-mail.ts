import assert from 'node:assert/strict'
import { portalAuthMessage, portalGraphMailEnabled, sendPortalGraphMail } from '../lib/server/portalGraphMail.ts'

const original = {
  provider: process.env.PORTAL_AUTH_MAIL_PROVIDER,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  tenant: process.env.PORTAL_GRAPH_TENANT_ID,
  clientId: process.env.PORTAL_GRAPH_CLIENT_ID,
  clientSecret: process.env.PORTAL_GRAPH_CLIENT_SECRET,
  fetch: globalThis.fetch,
}

try {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging-ref.supabase.co'
  process.env.PORTAL_GRAPH_TENANT_ID = 'test-tenant'
  process.env.PORTAL_GRAPH_CLIENT_ID = 'test-client'
  process.env.PORTAL_GRAPH_CLIENT_SECRET = 'test-secret'
  delete process.env.PORTAL_AUTH_MAIL_PROVIDER
  assert.equal(portalGraphMailEnabled(), false)
  process.env.PORTAL_AUTH_MAIL_PROVIDER = 'graph'
  assert.equal(portalGraphMailEnabled(), true)

  const actionLink = 'https://staging-ref.supabase.co/auth/v1/verify?token=private-token&type=recovery'
  assert.throws(() => portalAuthMessage('recovery', 'https://evil.example/auth/v1/verify?token=x'))
  assert.throws(() => portalAuthMessage('invite', 'http://staging-ref.supabase.co/auth/v1/verify?token=x'))
  const message = portalAuthMessage('recovery', actionLink)
  assert.match(message.html, /Reset password/)
  assert.match(message.html, /&amp;type=recovery/)

  const requests: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} })
    return requests.length === 1
      ? new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 })
      : new Response(null, { status: 202 })
  }
  await sendPortalGraphMail('pilot@example.com', 'recovery', actionLink)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].url, 'https://graph.microsoft.com/v1.0/users/admin%40afstransco.com/sendMail')
  const payload = JSON.parse(String(requests[1].init.body))
  assert.equal(payload.message.toRecipients[0].emailAddress.address, 'pilot@example.com')
  assert.equal(payload.saveToSentItems, true)
  assert.ok(!requests.some(request => request.url.includes('private-token')))

  globalThis.fetch = async (url) => String(url).includes('/token')
    ? new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 })
    : new Response(null, { status: 403 })
  await assert.rejects(sendPortalGraphMail('pilot@example.com', 'invite', actionLink), /not accepted \(403\)/)
} finally {
  for (const [key, value] of [
    ['PORTAL_AUTH_MAIL_PROVIDER', original.provider],
    ['NEXT_PUBLIC_SUPABASE_URL', original.supabaseUrl],
    ['PORTAL_GRAPH_TENANT_ID', original.tenant],
    ['PORTAL_GRAPH_CLIENT_ID', original.clientId],
    ['PORTAL_GRAPH_CLIENT_SECRET', original.clientSecret],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = original.fetch
}

console.log('Portal Graph mail tests passed')
