import { NextRequest, NextResponse } from 'next/server'
import { ensureMonthlyThread, getUtilityEmailRecipientGroups, notifyBill, notifyBills, requireUtilityIngestor, requireUtilityUser, resendMonthlyThread } from '@/lib/server/utilityEmail'

export const dynamic = 'force-dynamic'

function bearer(req: NextRequest) { const value = req.headers.get('authorization') ?? ''; return value.startsWith('Bearer ') ? value.slice(7) : '' }

export async function GET(req: NextRequest) {
  const auth = await requireUtilityUser(bearer(req)); if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (auth.user.email?.trim().toLowerCase() !== 'admin@afstransco.com') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const now = new Date(); const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const monthlyBills = await auth.db.from('utility_bills').select('id,provider,utility_name,account_number,company_id,location_id,created_at,utility_locations(name,city)').gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).order('created_at', { ascending: false })
  const groupId = req.nextUrl.searchParams.get('recipientGroupId') ?? 'default'
  const thread = await auth.db.from('utility_email_threads').select('id,billing_month,sender_email,recipient_group_id,subject,created_at').eq('billing_month', month).eq('recipient_group_id', groupId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (thread.error) return NextResponse.json({ error: thread.error.message }, { status: 500 })
  if (!thread.data) return NextResponse.json({ thread: null, failed: [], notifications: [], bills: monthlyBills.data ?? [], recipientGroups: getUtilityEmailRecipientGroups() })
  const notifications = await auth.db.from('utility_email_notifications').select('id,bill_id,status,error_message,attempt_count,created_at,sent_at,graph_message_id').eq('thread_id', thread.data.id).order('created_at', { ascending: false }).limit(100)
  if (notifications.error) return NextResponse.json({ error: notifications.error.message }, { status: 500 })
  const billIds = [...new Set((notifications.data ?? []).map(row => row.bill_id))]
  const bills = billIds.length ? await auth.db.from('utility_bills').select('id,provider,utility_name').in('id', billIds) : { data: [] }
  const names = new Map((bills.data ?? []).map(bill => [bill.id, bill.provider ?? bill.utility_name]))
  const enriched = (notifications.data ?? []).map(row => ({ ...row, bill_name: names.get(row.bill_id) ?? 'Unknown bill' }))
  return NextResponse.json({ thread: thread.data, failed: enriched.filter(row => row.status === 'failed'), notifications: enriched, bills: monthlyBills.data ?? [], recipientGroups: getUtilityEmailRecipientGroups() })
}

export async function POST(req: NextRequest) {
  const token = bearer(req)
  const auth = await requireUtilityUser(token)
  const ingestor = auth ? null : requireUtilityIngestor(token)
  const db = auth?.db ?? ingestor?.db
  if (!db) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (auth && auth.user.email?.trim().toLowerCase() !== 'admin@afstransco.com') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!ingestor && auth?.role !== 'admin') return NextResponse.json({ error: 'Only utility admins can send team notifications' }, { status: 403 })
  const body = await req.json().catch(() => null) as { action?: string; billId?: string; billIds?: string[]; version?: string; force?: boolean; recipientGroupId?: string; message?: string } | null
  try {
    if (body?.action === 'root') {
      const now = new Date(); const year = now.getUTCFullYear(); const month = now.getUTCMonth() + 1
      const thread = body.force ? await resendMonthlyThread(db, year, month, body.recipientGroupId) : await ensureMonthlyThread(db, year, month, body.recipientGroupId)
      if (!thread) return NextResponse.json({ error: 'No new bills were registered this month, so no email was sent.' }, { status: 409 })
      return NextResponse.json({ thread })
    }
    if (body?.action === 'bulk' && Array.isArray(body.billIds) && body.billIds.every(id => typeof id === 'string')) return NextResponse.json(await notifyBills(db, body.billIds, body.version, body.recipientGroupId, body.message))
    if ((body?.action === 'notify' || body?.action === 'retry') && typeof body.billId === 'string') return NextResponse.json(await notifyBill(db, body.billId, body.version, body.recipientGroupId))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[utility-email-thread]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Email operation failed' }, { status: 500 })
  }
}
