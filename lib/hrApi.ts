'use client'

import { supabase } from '@/lib/supabase'

let sessionPromise: ReturnType<typeof supabase.auth.getSession> | null = null
let hrRequestSequence = 0
supabase.auth.onAuthStateChange(() => { sessionPromise = null })

function getSession() {
  if (!sessionPromise) sessionPromise = supabase.auth.getSession()
  return sessionPromise
}

export async function hrFetch<T = unknown>(path: string, init?: RequestInit): Promise<{ data: T | null; error: Error | null }> {
  const { data: { session }, error: sessionError } = await getSession()
  if (sessionError || !session?.access_token) return { data: null, error: new Error('Authenticated session required') }
  try {
    const requestId = ++hrRequestSequence
    const startedAt = performance.now()
    console.info(`[HR timing] request ${requestId} start ${init?.method ?? 'GET'} ${path}`)
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(init?.headers ?? {}) },
    })
    const headersAt = performance.now()
    const elapsed = headersAt - startedAt
    const serverTiming = response.headers.get('server-timing')
    console.info(`[HR timing] request ${requestId} response headers ${Math.round(elapsed)}ms status=${response.status}`, serverTiming ?? '')
    console.info(`[HR timing] request ${requestId} response.json start ${Math.round(performance.now() - startedAt)}ms`)
    const body = await response.json().catch(() => null)
    console.info(`[HR timing] request ${requestId} response.json done ${Math.round(performance.now() - startedAt)}ms`)
    if (!response.ok) return { data: null, error: new Error(body?.error ?? `HR request failed (${response.status})`) }
    return { data: body as T, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('HR request failed') }
  }
}
