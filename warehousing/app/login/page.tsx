'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

export default function LoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError('이메일 또는 비밀번호가 올바르지 않습니다'); return }
    router.replace('/')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-ink rounded-xl mb-4">
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <h1 className="text-2xl font-bold text-ink">AFS Warehousing</h1>
          <p className="text-sm text-ink-muted mt-1">구매 요청 시스템에 로그인하세요</p>
        </div>

        <form onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-line-soft p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-signal-neg text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">이메일</label>
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              placeholder="you@afstransco.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">비밀번호</label>
            <input
              type="password" required value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-ink hover:bg-ink/90 disabled:bg-ink-faint text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
            {loading ? '로그인 중…' : '로그인'}
          </button>
          <p className="text-xs text-ink-faint text-center pt-1">
            AFS Admin(HR) 계정과 동일한 이메일/비밀번호를 사용합니다
          </p>
        </form>
      </div>
    </div>
  )
}
