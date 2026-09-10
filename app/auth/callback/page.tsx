'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMsal, MAIL_SCOPES } from '@/lib/msal'

export default function AuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('Processing authentication…')
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    const returnUrl = sessionStorage.getItem('msal_return_url') || '/hr/afs'

    getMsal()
      .then(async msal => {
        setStatus('Calling handleRedirectPromise…')
        const result = await msal.handleRedirectPromise()
        setStatus(`Result: ${result ? 'token found' : 'null (no response)'}`)

        // In MSAL v5, initialize() may have already consumed the redirect response.
        // handleRedirectPromise() returns null in that case, but the token is in cache.
        const account = result?.account ?? msal.getAllAccounts()[0]

        if (result?.accessToken) {
          // Got token directly from handleRedirectPromise
          sessionStorage.setItem('msal_ready_token', result.accessToken)
          setStatus('Token saved. Redirecting…')
          router.replace(returnUrl)
        } else if (account) {
          // Token was processed by initialize() — acquire silently from cache
          setStatus(`Account found (${account.username}). Acquiring a silent token…`)
          const silent = await msal.acquireTokenSilent({ scopes: MAIL_SCOPES, account })
          sessionStorage.setItem('msal_ready_token', silent.accessToken)
          setStatus('Token saved. Redirecting…')
          router.replace(returnUrl)
        } else {
          setStatus(`No authentication response — URL: ${window.location.search || window.location.hash || '(none)'}`)
          // Wait so user can read the status before navigating
          setTimeout(() => router.replace(returnUrl), 3000)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        sessionStorage.setItem('msal_cb_error', msg)
        setStatus('An error occurred')
      })
  }, [router])

  const style: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif',
    gap: 12, padding: 24,
  }

  return (
    <div style={style}>
      <div style={{ color: '#888', fontSize: 14 }}>{status}</div>
      {error && (
        <div style={{ color: 'red', fontSize: 13, maxWidth: 600, textAlign: 'center', wordBreak: 'break-all' }}>
          ❌ {error}
        </div>
      )}
    </div>
  )
}
