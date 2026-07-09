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
        const result = await msal.handleRedirectPromise()
        if (result?.accessToken) {
          // Stash the token so sendPendingMailAfterRedirect can use it directly
          sessionStorage.setItem('msal_ready_token', result.accessToken)
        } else if (result?.account) {
          // Got account but not the right scope — try silent
          try {
            const silent = await msal.acquireTokenSilent({ scopes: MAIL_SCOPES, account: result.account })
            sessionStorage.setItem('msal_ready_token', silent.accessToken)
          } catch { /* will be retried on HR page */ }
        }
      })
      .catch(() => {})
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
