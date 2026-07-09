export { getMsal, MAIL_SCOPES } from './msal'
import { getMsal, MAIL_SCOPES } from './msal'
import { InteractionRequiredAuthError } from '@azure/msal-browser'

export type MailPayload = {
  to:      string
  cc?:     string[]
  subject: string
  body:    string
  fromName?: string
}

export async function sendGraphMail(payload: MailPayload): Promise<void> {
  const msal     = await getMsal()
  const accounts = msal.getAllAccounts()

  let tokenRes
  try {
    // Try silent token acquisition first (reuse cached token)
    tokenRes = await msal.acquireTokenSilent({
      scopes:  MAIL_SCOPES,
      account: accounts[0],
    })
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError || accounts.length === 0) {
      // Popup login if no cached token
      tokenRes = await msal.acquireTokenPopup({ scopes: MAIL_SCOPES })
    } else {
      throw e
    }
  }

  const ccRecipients = (payload.cc ?? []).map(email => ({
    emailAddress: { address: email },
  }))

  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${tokenRes.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: payload.subject,
        body:    { contentType: 'Text', content: payload.body },
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

export async function msalLogout() {
  const msal = await getMsal()
  const accounts = msal.getAllAccounts()
  if (accounts.length) {
    await msal.logoutPopup({ account: accounts[0] })
  }
}

export function getMsalAccount() {
  if (typeof window === 'undefined') return null
  // getMsal is async but account check after init is sync
  return _getCachedAccount()
}

function _getCachedAccount() {
  try {
    // Read directly from sessionStorage to avoid async
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
