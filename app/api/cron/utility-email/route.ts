import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureMonthlyThread } from '@/lib/server/utilityEmail'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Database configuration is missing' }, { status: 500 })
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }); const now = new Date()
  try { return NextResponse.json({ thread: await ensureMonthlyThread(db, now.getFullYear(), now.getMonth() + 1) }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create monthly thread' }, { status: 500 }) }
}
