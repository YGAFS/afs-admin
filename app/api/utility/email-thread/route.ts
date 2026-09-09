import { NextRequest, NextResponse } from 'next/server'
import { ensureMonthlyThread, notifyBill, requireUtilityIngestor, requireUtilityUser } from '@/lib/server/utilityEmail'

export const dynamic = 'force-dynamic'

function bearer(req: NextRequest) { const value = req.headers.get('authorization') ?? ''; return value.startsWith('Bearer ') ? value.slice(7) : '' }

export async function GET(req: NextRequest) {
  const auth = await requireUtilityUser(bearer(req)); if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const now = new Date(); const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const thread = await auth.db.from('utility_email_threads').select('id,billing_month,sender_email,subject,created_at').eq('billing_month', month).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (thread.error) return NextResponse.json({ error: thread.error.message }, { status: 500 })
  if (!thread.data) return NextResponse.json({ thread: null, failed: [], notifications: [] })
  const notifications = await auth.db.from('utility_email_notifications').select('id,bill_id,status,error_message,attempt_count,created_at,sent_at,graph_message_id').eq('thread_id', thread.data.id).order('created_at', { ascending: false }).limit(100)
  if (notifications.error) return NextResponse.json({ error: notifications.error.message }, { status: 500 })
  const billIds = [...new Set((notifications.data ?? []).map(row => row.bill_id))]
  const bills = billIds.length ? await auth.db.from('utility_bills').select('id,provider,utility_name').in('id', billIds) : { data: [] }
  const names = new Map((bills.data ?? []).map(bill => [bill.id, bill.provider ?? bill.utility_name]))
  const enriched = (notifications.data ?? []).map(row => ({ ...row, bill_name: names.get(row.bill_id) ?? 'Unknown bill' }))
  return NextResponse.json({ thread: thread.data, failed: enriched.filter(row => row.status === 'failed'), notifications: enriched })
}

export async function POST(req: NextRequest) {
  const token = bearer(req)
  const auth = await requireUtilityUser(token)
  const ingestor = auth ? null : requireUtilityIngestor(token)
  const db = auth?.db ?? ingestor?.db
  if (!db) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!ingestor && auth?.role !== 'admin') return NextResponse.json({ error: 'Only utility admins can send team notifications' }, { status: 403 })
  const body = await req.json().catch(() => null) as { action?: string; billId?: string; version?: string } | null
  try {
    if (body?.action === 'root') { const now = new Date(); return NextResponse.json({ thread: await ensureMonthlyThread(db, now.getFullYear(), now.getMonth() + 1) }) }
    if ((body?.action === 'notify' || body?.action === 'retry') && typeof body.billId === 'string') return NextResponse.json(await notifyBill(db, body.billId, body.version))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Email operation failed' }, { status: 500 })
  }
}
