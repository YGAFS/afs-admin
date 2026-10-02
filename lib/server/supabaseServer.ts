import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) throw new Error('Supabase server environment is not configured')
  return { url, anonKey, serviceKey }
}

export function bearerToken(req: NextRequest) {
  const value = req.headers.get('authorization') ?? ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

export function serviceRoleClient() {
  const { url, serviceKey } = config()
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

export function anonymousClient() {
  const { url, anonKey } = config()
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

export function userJwtClient(token: string) {
  const { url, anonKey } = config()
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

export async function authenticatedUser(req: NextRequest): Promise<{
  token: string
  user: User
  db: SupabaseClient
} | null> {
  const token = bearerToken(req)
  if (!token) return null
  // JWT verification for normal Portal requests must stay in the caller's
  // public Supabase project context. Service-role is reserved for the
  // administrative operations that actually require it.
  const auth = anonymousClient()
  const result = await auth.auth.getUser(token)
  if (result.error || !result.data.user?.id) return null
  return { token, user: result.data.user, db: userJwtClient(token) }
}

export function employeeAccountManagementEnabled() {
  return employeePortalV2SchemaEnabled()
    && process.env.EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED === 'true'
}

export function employeePortalV2SchemaEnabled() {
  return process.env.EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED === 'true'
}

export function canonicalPortalOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://hr.afstransco.com'
  const origin = new URL(configured).origin
  if (process.env.NODE_ENV === 'production' && origin !== 'https://hr.afstransco.com') {
    throw new Error('Production Portal origin must be https://hr.afstransco.com')
  }
  return origin
}
