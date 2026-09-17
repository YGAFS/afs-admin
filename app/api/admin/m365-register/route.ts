import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server configuration is missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

async function isAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  const { data, error } = await db().auth.getUser(token)
  return !error && data.user?.email?.trim().toLowerCase() === 'admin@afstransco.com'
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await req.json() as { display_name?: string | null; email_address?: string | null; license_plan?: string | null; created_date?: string | null }
    const email = body.email_address?.trim().toLowerCase()
    if (!email || !email.endsWith('@afstransco.com')) return NextResponse.json({ error: 'AFS email address is required' }, { status: 400 })
    const client = db()
    const { data: existing, error: lookupError } = await client.from('licenses').select('account_id').eq('company', 'AFS')
    if (lookupError) throw new Error(`Unable to read AFS account IDs: ${lookupError.message}`)
    const used = new Set((existing ?? []).map(row => String(row.account_id ?? '').toUpperCase()))
    const numbers = [...used].map(value => Number(value.match(/^A-?(\d+)$/)?.[1] ?? 0))
    let next = Math.max(0, ...numbers) + 1
    let accountId = `A${String(next).padStart(3, '0')}`
    while (used.has(accountId) && next < 100000) { next += 1; accountId = `A${String(next).padStart(3, '0')}` }
    const { data, error } = await client.from('licenses').insert({
      account_id: accountId, display_name: body.display_name?.trim() || null, email_address: email,
      account_type: 'Individual', license_plan: body.license_plan?.trim() || null, monthly_cost_cad: 0,
      status: 'Active', company: 'AFS', created_date: body.created_date || new Date().toISOString().slice(0, 10),
      notes: 'Imported from Microsoft 365 comparison',
    }).select('id,account_id,email_address').single()
    if (error) throw new Error(`Unable to register AFS account: ${error.message}`)
    return NextResponse.json({ ok: true, account: data })
  } catch (error) {
    console.error('[m365-register]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'M365 account registration failed' }, { status: 500 })
  }
}
