import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

type GraphMessage = { id: string; conversationId?: string | null }
type GraphMessageList = { value?: GraphMessage[] }
export type UtilityEmailRecipientGroup = { id: string; label: string; recipients: string[] }
type LocationRef = { name?: string | null; city?: string | null }
type Bill = { id: string; provider: string | null; utility_name: string; amount: number | null; currency: string; due_date: string | null; billing_month: number | null; billing_year: number | null; account_number?: string | null; company_id?: string | null; onedrive_file_url?: string | null; utility_locations?: LocationRef | LocationRef[] | null; updated_at?: string | null }

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server configuration is missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export function requireUtilityIngestor(token: string): { db: SupabaseClient } | null {
  const expected = (process.env.UTILITY_EMAIL_NOTIFY_SECRET ?? process.env.CRON_SECRET)?.trim()
  if (!expected || !token || token !== expected) return null
  return { db: db() }
}

export async function requireUtilityUser(token: string): Promise<{ user: User; db: SupabaseClient; role: 'admin' | 'ap' } | null> {
  if (!token) return null
  const client = db()
  const result = await client.auth.getUser(token)
  if (result.error || !result.data.user?.id) return null
  const role = await client.from('utility_user_roles').select('role').eq('user_id', result.data.user.id).maybeSingle()
  const roleValue = role.data?.role
  if (role.error || !['admin', 'ap'].includes(roleValue ?? '')) return null
  return { user: result.data.user, db: client, role: roleValue as 'admin' | 'ap' }
}

function recipientGroups(): UtilityEmailRecipientGroup[] {
  const fallback = (process.env.UTILITY_EMAIL_RECIPIENTS ?? '').split(',').map(v => v.trim()).filter(Boolean)
  const raw = process.env.UTILITY_EMAIL_RECIPIENT_GROUPS?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const groups = parsed.map((group, index) => {
          const value = group as { id?: unknown; label?: unknown; recipients?: unknown }
          const recipients = Array.isArray(value.recipients) ? value.recipients.map(String).map(v => v.trim()).filter(Boolean) : []
          return { id: String(value.id ?? `group-${index + 1}`), label: String(value.label ?? value.id ?? `Group ${index + 1}`), recipients }
        }).filter(group => group.recipients.length > 0)
        if (groups.length) return groups
      }
    } catch (error) {
      console.warn('[utility-email-thread] invalid UTILITY_EMAIL_RECIPIENT_GROUPS JSON', error)
    }
  }
  return fallback.length ? [{ id: 'default', label: 'Default recipients', recipients: fallback }] : []
}

export function getUtilityEmailRecipientGroups() { return recipientGroups().map(({ id, label }) => ({ id, label })) }

function config(groupId?: string) {
  const sender = process.env.UTILITY_EMAIL_SENDER?.trim()
  const groups = recipientGroups()
  const group = groups.find(value => value.id === groupId) ?? groups[0]
  const recipients = group?.recipients ?? []
  if (!sender || recipients.length === 0) throw new Error('UTILITY_EMAIL_SENDER and UTILITY_EMAIL_RECIPIENTS are not configured')
  if (!process.env.MS_GRAPH_TENANT_ID || !process.env.MS_GRAPH_CLIENT_ID || !process.env.MS_GRAPH_CLIENT_SECRET) throw new Error('Microsoft Graph mail credentials are not configured')
  return { sender, recipients, groupId: group?.id ?? 'default' }
}

async function graphToken() {
  const tenant = process.env.MS_GRAPH_TENANT_ID!
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.MS_GRAPH_CLIENT_ID!, client_secret: process.env.MS_GRAPH_CLIENT_SECRET!, scope: 'https://graph.microsoft.com/.default' })
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000)
  let res: Response
  try { res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store', signal: controller.signal }) } finally { clearTimeout(timeout) }
  if (!res.ok) throw new Error(`Graph token error ${res.status}`)
  const responseText = await res.text()
  try {
    const parsed = JSON.parse(responseText) as { access_token?: string }
    if (!parsed.access_token) throw new Error('missing access token')
    return parsed.access_token
  } catch { throw new Error('Graph token response was invalid') }
}

async function graph(path: string, init: RequestInit = {}) {
  const token = await graphToken()
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000)
  let res: Response
  try { res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'IdType="ImmutableId"', ...(init.headers ?? {}) }, cache: 'no-store', signal: controller.signal }) } finally { clearTimeout(timeout) }
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`)
  if (res.status === 204) return null
  const responseText = await res.text()
  if (!responseText.trim()) return {}
  try { return JSON.parse(responseText) }
  catch { throw new Error(`Graph ${res.status}: invalid JSON response`) }
}

function monthDate(year: number, month: number) { return `${year}-${String(month).padStart(2, '0')}-01` }
function subject(year: number, month: number) { return `[Utility Bills] ${new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` }
function dashboardUrl() { return 'https://hr.afstransco.com/utilities/bills' }
function escapeHtml(value: unknown) {
  return String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}
function companyLabel(companyId: string | null | undefined) { return ({ afs: 'AFS', tnt: 'TNT', zfs: 'ZFS' }[companyId ?? ''] ?? companyId ?? '—') }
function locationLabel(location: Bill['utility_locations']) { const value = Array.isArray(location) ? location[0] : location; return value?.name ?? value?.city ?? '—' }
function accountLabel(account: string | null | undefined) { const value = account?.trim(); return value ? `****${value.slice(-4)}` : '—' }
function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

async function monthlyBillBody(client: SupabaseClient, year: number, month: number, title: string) {
  // Email months are registration months. billing_month remains the bill's
  // issue/statement month and is used by the dashboard, not notification routing.
  const range = monthRange(year, month)
  const bills = await client.from('utility_bills').select('provider,utility_name,amount,currency,due_date,account_number,company_id,onedrive_file_url,utility_locations(name,city)').gte('created_at', range.start).lt('created_at', range.end).order('provider')
  if (bills.error) throw bills.error
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#172033;max-width:760px;margin:0 auto;line-height:1.5"><h2 style="text-align:center;margin:0 0 18px;color:#111827">${escapeHtml(title)}</h2><p style="text-align:center">Utility bill tracking is now available.</p><p style="text-align:center">Please review current bills, due dates, and payment status below.</p>${billTable(bills.data as Bill[]) || '<p style="text-align:center">No bills have been registered yet.</p>'}<p style="text-align:center;margin:24px 0"><a href="${dashboardUrl()}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:6px">View Utility Dashboard</a></p><p style="text-align:center;color:#4b5563">Updates to individual bills will be posted in this email thread.</p></div>`
}

function billTable(bills: Bill[]) {
  const rows = bills.map(bill => {
    const name = bill.provider ?? bill.utility_name
    const amount = bill.amount == null ? '—' : `${bill.currency === 'USD' ? 'US$' : 'CA$'}${Number(bill.amount).toFixed(2)}`
    const download = bill.onedrive_file_url ? `<a href="${escapeHtml(bill.onedrive_file_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;padding:8px 12px;border-radius:6px;white-space:nowrap">Download</a>` : '—'
    return `<tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(name)}</strong><br><span style="font-size:12px;color:#6b7280">${escapeHtml(companyLabel(bill.company_id))} · ${escapeHtml(locationLabel(bill.utility_locations))} · Account ${escapeHtml(accountLabel(bill.account_number))}</span></td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap"><strong>${escapeHtml(amount)}</strong></td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap">Due <strong>${escapeHtml(bill.due_date)}</strong></td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap">${download}</td></tr>`
  }).join('')
  return rows ? `<table style="width:100%;border-collapse:collapse;margin:22px 0"><thead><tr style="background:#f3f4f6"><th style="padding:10px 12px;text-align:left">Utility / account</th><th style="padding:10px 12px;text-align:right">Amount</th><th style="padding:10px 12px;text-align:right">Due date</th><th style="padding:10px 12px;text-align:right">File</th></tr></thead><tbody>${rows}</tbody></table>` : ''
}

export async function ensureMonthlyThread(client: SupabaseClient, year: number, month: number, groupId?: string) {
  const { sender, recipients, groupId: selectedGroupId } = config(groupId); const billingMonth = monthDate(year, month); const title = subject(year, month)
  const existing = await client.from('utility_email_threads').select('*').eq('billing_month', billingMonth).eq('sender_email', sender).eq('recipient_group_id', selectedGroupId).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return existing.data
  const range = monthRange(year, month)
  const registered = await client.from('utility_bills').select('id', { count: 'exact', head: true }).gte('created_at', range.start).lt('created_at', range.end)
  if (registered.error) throw registered.error
  if (!registered.count) return null
  // Only the legacy default anchor may be recovered by subject. Searching by
  // subject alone cannot distinguish TEST GDE 1 from TEST GDE 2, so never use
  // that recovery path for a configured recipient group.
  if (selectedGroupId === 'default') {
    try {
      const filter = encodeURIComponent(`subject eq '${title.replace(/'/g, "''")}'`)
      const sent = await graph(`/users/${encodeURIComponent(sender)}/mailFolders/sentitems/messages?$filter=${filter}&$top=10&$select=id,conversationId,subject`) as GraphMessageList
      const prior = sent.value?.[0]
      if (prior?.id) {
        const recovered = await client.from('utility_email_threads').insert({ billing_month: billingMonth, sender_email: sender, recipient_group_id: selectedGroupId, root_message_id: prior.id, conversation_id: prior.conversationId ?? null, subject: title, recipients }).select('*').single()
        if (!recovered.error) return recovered.data
      }
    } catch (error) {
      console.warn('[utility-email-thread] root recovery lookup failed', error)
    }
  }
  const content = await monthlyBillBody(client, year, month, title)
  const created = await graph(`/users/${encodeURIComponent(sender)}/messages`, { method: 'POST', body: JSON.stringify({ subject: title, body: { contentType: 'HTML', content }, toRecipients: recipients.map(address => ({ emailAddress: { address } })) }) }) as GraphMessage
  if (!created?.id) throw new Error('Graph did not return a draft message id')
  const inserted = await client.from('utility_email_threads').insert({ billing_month: billingMonth, sender_email: sender, recipient_group_id: selectedGroupId, root_message_id: created.id, conversation_id: created.conversationId ?? null, subject: title, recipients }).select('*').single()
  if (inserted.error) {
    const raced = await client.from('utility_email_threads').select('*').eq('billing_month', billingMonth).eq('sender_email', sender).eq('recipient_group_id', selectedGroupId).maybeSingle()
    if (raced.data) return raced.data
    throw inserted.error
  }
  await graph(`/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(created.id)}/send`, { method: 'POST' })
  return inserted.data
}

export async function resendMonthlyThread(client: SupabaseClient, year: number, month: number, groupId?: string) {
  const { sender, recipients, groupId: selectedGroupId } = config(groupId); const billingMonth = monthDate(year, month); const title = subject(year, month)
  const thread = await client.from('utility_email_threads').select('*').eq('billing_month', billingMonth).eq('sender_email', sender).eq('recipient_group_id', selectedGroupId).maybeSingle()
  if (thread.error) throw thread.error
  if (!thread.data) return ensureMonthlyThread(client, year, month, groupId)
  const content = await monthlyBillBody(client, year, month, title)
  const draft = await graph(`/users/${encodeURIComponent(sender)}/messages`, { method: 'POST', body: JSON.stringify({ subject: title, body: { contentType: 'HTML', content }, toRecipients: recipients.map((address: string) => ({ emailAddress: { address } })) }) }) as GraphMessage
  if (!draft?.id) throw new Error('Graph did not return a resend draft message id')
  const updated = await client.from('utility_email_threads').update({ root_message_id: draft.id, conversation_id: draft.conversationId ?? null, subject: title, recipients }).eq('id', thread.data.id).select('*').single()
  if (updated.error) throw updated.error
  await graph(`/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(draft.id)}/send`, { method: 'POST' })
  return { ...updated.data, resent: true }
}

export async function notifyBills(client: SupabaseClient, billIds: string[], version?: string, groupId?: string) {
  const { sender } = config(groupId)
  const uniqueBillIds = Array.from(new Set(billIds))
  if (!uniqueBillIds.length) throw new Error('At least one bill is required')
  const billResult = await client.from('utility_bills').select('id,provider,utility_name,amount,currency,due_date,billing_month,billing_year,account_number,company_id,onedrive_file_url,utility_locations(name,city),updated_at').in('id', uniqueBillIds)
  if (billResult.error || !billResult.data || billResult.data.length !== uniqueBillIds.length) throw new Error('One or more bills could not be found')
  const bills = billResult.data as Bill[]
  const now = new Date(); const year = now.getUTCFullYear(); const month = now.getUTCMonth() + 1
  const thread = await ensureMonthlyThread(client, year, month, groupId)
  if (!thread) throw new Error('No bills are registered for this month')
  const notificationRows = bills.map(bill => ({ bill_id: bill.id, thread_id: thread.id, notification_type: 'bill_updated', idempotency_key: `bill:${bill.id}:manual:${version ?? Date.now()}:${crypto.randomUUID()}`, status: 'queued' }))
  const queued = await client.from('utility_email_notifications').insert(notificationRows).select('*')
  if (queued.error || !queued.data?.length) throw queued.error ?? new Error('Unable to queue bill notifications')
  const notifications = queued.data
  try {
    await client.from('utility_email_notifications').update({ status: 'sending', attempt_count: 1 }).in('id', notifications.map(item => item.id))
    const draft = await graph(`/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(thread.root_message_id)}/createReplyAll`, { method: 'POST', body: JSON.stringify({}) }) as GraphMessage
    const details = billTable(bills)
    const heading = bills.length === 1 ? `${escapeHtml(bills[0].provider ?? bills[0].utility_name)} bill updated` : `${bills.length} utility bills updated`
    await graph(`/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify({ body: { contentType: 'HTML', content: `<div style="font-family:Arial,Helvetica,sans-serif;color:#172033;max-width:680px;margin:0 auto;text-align:center;line-height:1.5"><h2 style="margin:0 0 18px;color:#111827"><strong>${heading}</strong></h2>${details}<p style="margin:24px 0"><a href="${dashboardUrl()}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:6px">View Utility Dashboard</a></p></div>` } }) })
    await graph(`/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(draft.id)}/send`, { method: 'POST' })
    await client.from('utility_email_notifications').update({ status: 'sent', graph_message_id: draft.id, sent_at: new Date().toISOString(), error_message: null }).in('id', notifications.map(item => item.id))
    return { status: 'sent', billCount: bills.length }
  } catch (error) {
    await client.from('utility_email_notifications').update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Unknown error' }).in('id', notifications.map(item => item.id))
    throw error
  }
}

export async function notifyBill(client: SupabaseClient, billId: string, version?: string, groupId?: string) {
  return notifyBills(client, [billId], version, groupId)
}
