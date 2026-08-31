'use client'

import { supabase } from '@/lib/supabase'

let sessionPromise: ReturnType<typeof supabase.auth.getSession> | null = null
supabase.auth.onAuthStateChange(() => { sessionPromise = null })

function getSession() {
  if (!sessionPromise) sessionPromise = supabase.auth.getSession()
  return sessionPromise
}

export async function hrFetch<T = unknown>(path: string, init?: RequestInit): Promise<{ data: T | null; error: Error | null }> {
  const { data: { session }, error: sessionError } = await getSession()
  if (sessionError || !session?.access_token) return { data: null, error: new Error('Authenticated session required') }
  try {
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(init?.headers ?? {}) },
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) return { data: null, error: new Error(body?.error ?? `HR request failed (${response.status})`) }
    return { data: body as T, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('HR request failed') }
  }
}
