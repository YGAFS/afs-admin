const PORTAL_GRAPH_SENDER = 'admin@afstransco.com'

export function portalGraphMailEnabled() {
  return process.env.PORTAL_AUTH_MAIL_PROVIDER === 'graph'
}

export type PortalAuthMailKind = 'invite' | 'recovery'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

export function portalAuthMessage(kind: PortalAuthMailKind, actionLink: string) {
  const url = new URL(actionLink)
  const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseOrigin = configuredSupabaseUrl ? new URL(configuredSupabaseUrl).origin : null
  if (url.protocol !== 'https:' || !supabaseOrigin || url.origin !== supabaseOrigin) {
    throw new Error('Invalid Portal Auth link origin')
  }
  const title = kind === 'invite' ? 'Set up your Employee Portal password' : 'Reset your Employee Portal password'
  const button = kind === 'invite' ? 'Set up password' : 'Reset password'
  return {
    subject: `AFS Employee Portal — ${title}`,
    html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h2>${title}</h2><p>Use this one-time link to ${kind === 'invite' ? 'set up' : 'reset'} your Employee Portal password.</p><p><a href="${escapeHtml(actionLink)}">${button}</a></p><p>If you did not request this, contact HR. Do not forward this email.</p></div>`,
  }
}

export async function sendPortalGraphMail(to: string, kind: PortalAuthMailKind, actionLink: string) {
  const tenant = process.env.PORTAL_GRAPH_TENANT_ID
  const clientId = process.env.PORTAL_GRAPH_CLIENT_ID
  const clientSecret = process.env.PORTAL_GRAPH_CLIENT_SECRET
  if (!tenant || !clientId || !clientSecret) throw new Error('Portal Graph mail is not configured')

  const message = portalAuthMessage(kind, actionLink)
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  if (!tokenResponse.ok) throw new Error(`Portal Graph token request failed (${tokenResponse.status})`)
  const token = await tokenResponse.json() as { access_token?: string }
  if (!token.access_token) throw new Error('Portal Graph token was unavailable')

  const mailResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(PORTAL_GRAPH_SENDER)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: 'HTML', content: message.html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  if (mailResponse.status !== 202) throw new Error(`Portal Graph mail was not accepted (${mailResponse.status})`)
}
