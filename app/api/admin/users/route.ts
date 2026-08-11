import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Separate from `user_access.allowed_sections` (which controls what a
// signed-in user can *see*) -- this is who's allowed to reach this route at
// all, since it uses the service-role key. Kept as a plain constant rather
// than a DB table: changing who can manage user access is rare enough that
// a code change + deploy is the right amount of friction for it.
const ADMIN_EMAILS = ['admin@afstransco.com']

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role env vars are not configured')
  return createClient(url, key)
}

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null

  const admin = serviceClient()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user?.email) return null
  if (!ADMIN_EMAILS.includes(data.user.email)) return null
  return admin
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await admin.auth.admin.listUsers()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const users = data.users
    .map(u => ({ id: u.id, email: u.email ?? '', created_at: u.created_at }))
    .filter(u => u.email)
    .sort((a, b) => a.email.localeCompare(b.email))

  return NextResponse.json({ users })
}
