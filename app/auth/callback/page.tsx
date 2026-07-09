'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getMsal, MAIL_SCOPES } from '@/lib/msal'

// MSAL redirect flow callback.
// Microsoft redirects here after login with ?code=...
// We exchange the code for a token and stash the access token in sessionStorage
// so the HR page can use it directly without re-authenticating.
export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const returnUrl = sessionStorage.getItem('msal_return_url') || '/hr/afs'

    getMsal()
      .then(async msal => {
        try {
          const result = await msal.handleRedirectPromise()
          if (result?.accessToken) {
            sessionStorage.setItem('msal_ready_token', result.accessToken)
          } else if (result?.account) {
            const silent = await msal.acquireTokenSilent({ scopes: MAIL_SCOPES, account: result.account })
            sessionStorage.setItem('msal_ready_token', silent.accessToken)
          } else {
            sessionStorage.setItem('msal_cb_error', 'handleRedirectPromise returned null (no auth response in URL?)')
          }
        } catch (err) {
          sessionStorage.setItem('msal_cb_error', err instanceof Error ? err.message : String(err))
        }
      })
      .catch((err) => {
        sessionStorage.setItem('msal_cb_error', 'getMsal failed: ' + String(err))
      })
      .finally(() => {
        router.replace(returnUrl)
      })
  }, [router])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#888' }}>
      인증 처리 중…
    </div>
  )
}
