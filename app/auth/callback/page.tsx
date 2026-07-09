'use client'

import { useEffect } from 'react'
import { getMsal } from '@/lib/msal'

// Dedicated MSAL redirect page.
// MSAL opens a popup → Microsoft login → redirects here.
// getMsal() calls initialize(), which detects the auth response,
// processes the token, and automatically closes this popup window.
export default function AuthCallback() {
  useEffect(() => {
    getMsal()
      .then(msal => msal.handleRedirectPromise())
      .then(result => {
        // MSAL v5 does not auto-close the popup after redirect — do it manually
        if (result || window.opener) window.close()
      })
      .catch(() => { if (window.opener) window.close() })
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#888' }}>
      Authenticating…
    </div>
  )
}
