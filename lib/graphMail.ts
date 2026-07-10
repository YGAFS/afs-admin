export { getMsal, MAIL_SCOPES } from './msal'
import { getMsal, MAIL_SCOPES } from './msal'

export type MailPayload = {
  to:      string
  cc?:     string[]
  subject: string
  body:    string
  fromName?: string
}

const PENDING_MAIL_KEY = 'msal_pending_mail'
const RETURN_URL_KEY   = 'msal_return_url'

function clearMsalInteractionState() {
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) ?? ''
      if (k.includes('msal') && (k.includes('interaction.status') || k.includes('request.params'))) keys.push(k)
    }
    keys.forEach(k => sessionStorage.removeItem(k))
  } catch {}
}

export async function sendGraphMail(payload: MailPayload): Promise<void> {
  const msal     = await getMsal()
  const accounts = msal.getAllAccounts()

  // Try silent token first (cached)
  if (accounts.length > 0) {
    try {
      const tokenRes = await msal.acquireTokenSilent({ scopes: MAIL_SCOPES, account: accounts[0] })
      await _postMail(tokenRes.accessToken, payload)
      return
    } catch {
      // Fall through to redirect
    }
  }

  // No cached token — clear any stale interaction lock, then redirect
  clearMsalInteractionState()
  sessionStorage.setItem(PENDING_MAIL_KEY, JSON.stringify(payload))
  sessionStorage.setItem(RETURN_URL_KEY, window.location.pathname)
  await msal.acquireTokenRedirect({ scopes: MAIL_SCOPES })
  // Page navigates away here; execution stops
}

const SIGNATURE_HTML = `
<div style="font-family: Aptos, Arial, sans-serif; font-size: 13px; color: #212121;">
  <p style="margin: 0 0 12px 0;">Best regards,</p>
  <p style="margin: 0;">
    <strong>Yun Gyeong Jang</strong><br>
    <strong><em>Office Administrator</em></strong>
  </p>
  <p style="margin: 14px 0;">
    <strong>Email:</strong>
    <a href="mailto:yungyeong.j@afstransco.com">yungyeong.j@afstransco.com</a>
  </p>
  <p style="margin: 0;">
    <strong>Mobile:</strong> (604) 780-9448<br>
    <strong>Office:</strong> (604) 674-4930<br>
    <strong>Address:</strong> 103 - 15030 54A Ave, Surrey, BC, V3S 5X7
  </p>
  <p style="margin: 14px 0 0 0;">
    <strong>Communication you can trust | Competitive rates | Service you can rely on</strong><br>
    <em>See us online at <a href="https://www.afstransco.com/">www.afstransco.com</a></em>
  </p>
</div>`

async function _postMail(accessToken: string, payload: MailPayload) {
  const ccRecipients = (payload.cc ?? []).map(email => ({
    emailAddress: { address: email },
  }))

  // Convert plain text body to HTML and append signature
  const bodyHtml = payload.body
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  const fullHtml = `<div style="font-family: Aptos, Arial, sans-serif; font-size: 13px;">${bodyHtml}</div><br>${SIGNATURE_HTML}`

  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: payload.subject,
        body:    { contentType: 'HTML', content: fullHtml },
        toRecipients: [{ emailAddress: { address: payload.to } }],
        ...(ccRecipients.length ? { ccRecipients } : {}),
      },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Graph API error ${res.status}`)
  }
}

const READY_TOKEN_KEY = 'msal_ready_token'

/** Called on HR page mount — sends any pending email left over from redirect auth */
export async function sendPendingMailAfterRedirect(): Promise<{ sent: boolean; error?: string }> {
  const raw = sessionStorage.getItem(PENDING_MAIL_KEY)
  if (!raw) return { sent: false }

  sessionStorage.removeItem(PENDING_MAIL_KEY)
  sessionStorage.removeItem(RETURN_URL_KEY)

  try {
    const payload = JSON.parse(raw) as MailPayload

    // Show any error logged by /auth/callback for debugging
    const cbError = sessionStorage.getItem('msal_cb_error')
    if (cbError) sessionStorage.removeItem('msal_cb_error')

    const msal = await getMsal()

    // The urlHash key in sessionStorage means MSAL stored an unprocessed auth response.
    // Call handleRedirectPromise() here to consume it and get the token.
    const redirectResult = await msal.handleRedirectPromise().catch(() => null)
    if (redirectResult?.accessToken) {
      await _postMail(redirectResult.accessToken, payload)
      return { sent: true }
    }

    // Primary: use the token stashed by /auth/callback
    const readyToken = sessionStorage.getItem(READY_TOKEN_KEY)
    if (readyToken) {
      sessionStorage.removeItem(READY_TOKEN_KEY)
      await _postMail(readyToken, payload)
      return { sent: true }
    }

    // Fallback: try silent with cached account
    const accounts = msal.getAllAccounts()
    if (!accounts.length) return { sent: false, error: cbError ? `[CB오류] ${cbError}` : '인증 후 계정을 찾을 수 없습니다' }
    const tokenRes = await msal.acquireTokenSilent({ scopes: MAIL_SCOPES, account: accounts[0] })
    await _postMail(tokenRes.accessToken, payload)
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export async function msalLogout() {
  const msal = await getMsal()
  const accounts = msal.getAllAccounts()
  if (accounts.length) {
    await msal.logoutPopup({ account: accounts[0] })
  }
}

export function getMsalAccount() {
  if (typeof window === 'undefined') return null
  return _getCachedAccount()
}

function _getCachedAccount() {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i) ?? ''
      if (key.includes('login.windows.net') && key.includes('homeAccountId')) {
        const val = JSON.parse(sessionStorage.getItem(key) ?? '{}')
        if (val.username) return val as { username: string; name: string }
      }
    }
  } catch {}
  return null
}
