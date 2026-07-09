'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getMsal } from '@/lib/msal'

// MSAL redirect flow callback page.
// Microsoft redirects here after login; handleRedirectPromise() caches the token,
// then we navigate back to wherever the user came from.
export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    getMsal()
      .then(msal => msal.handleRedirectPromise())
      .then(() => {
        const returnUrl = sessionStorage.getItem('msal_return_url') || '/hr/afs'
        router.replace(returnUrl)
      })
      .catch(() => {
        router.replace('/hr/afs')
      })
  }, [router])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#888' }}>
      인증 처리 중…
    </div>
  )
}
