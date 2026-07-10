'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMsal, MAIL_SCOPES } from '@/lib/msal'

export default function AuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('인증 처리 중…')
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    const returnUrl = sessionStorage.getItem('msal_return_url') || '/hr/afs'

    getMsal()
      .then(async msal => {
        setStatus('handleRedirectPromise 호출 중…')
        const result = await msal.handleRedirectPromise()
        setStatus(`결과: ${result ? '토큰 있음' : 'null (응답 없음)'}`)

        if (result?.accessToken) {
          sessionStorage.setItem('msal_ready_token', result.accessToken)
          setStatus('토큰 저장 완료, 이동 중…')
          router.replace(returnUrl)
        } else if (result?.account) {
          setStatus('계정은 있으나 토큰 없음, silent 시도 중…')
          const silent = await msal.acquireTokenSilent({ scopes: MAIL_SCOPES, account: result.account })
          sessionStorage.setItem('msal_ready_token', silent.accessToken)
          router.replace(returnUrl)
        } else {
          // No auth response — just go back (user may have cancelled)
          setStatus('인증 응답 없음, 이동 중…')
          setTimeout(() => router.replace(returnUrl), 1500)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        sessionStorage.setItem('msal_cb_error', msg)
        setStatus('오류 발생')
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
