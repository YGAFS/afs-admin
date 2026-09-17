import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { listDirectoryAudits, listSubscribedSkus, listUsers, M365_SKU_DISPLAY_NAMES, type M365AuditEvent, type M365Sku, type M365User } from '@/lib/server/m365Graph'

export const dynamic = 'force-dynamic'

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server configuration is missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  const client = db()
  const { data, error } = await client.auth.getUser(token)
  return !error && data.user?.email?.trim().toLowerCase() === 'admin@afstransco.com'
}

type LicenseRow = { id: string; account_id: string; display_name: string | null; email_address: string | null; license_plan: string | null; status: string | null; company: string | null; created_date: string | null }

function userEmails(user: M365User) {
  const aliases = (user.proxyAddresses ?? []).map(value => value.replace(/^smtp:/i, '').trim())
  return [user.mail, user.userPrincipalName, ...(user.otherMails ?? []), ...aliases]
    .filter((value): value is string => !!value).map(value => value.toLowerCase())
}
function emailOf(user: M365User) {
  return userEmails(user).find(value => value.endsWith('@afstransco.com')) ?? userEmails(user)[0] ?? ''
}
function isAfsUser(user: M365User) { return userEmails(user).some(value => value.endsWith('@afstransco.com')) }
function clean(value: string | null | undefined) { return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ') }
function planTokens(value: string | null | undefined) { return clean(value).replace(/[^a-z0-9]+/g, '') }

function planKeys(value: string | null | undefined) {
  const token = planTokens(value)
  const keys: string[] = []
  if (token.includes('businesspremium') || token === 'spb') keys.push('businesspremium')
  if (token.includes('businessstandard') || token === 'o365businesspremium') keys.push('businessstandard')
  if (token.includes('businessbasic') || token === 'o365businessessentials') keys.push('businessbasic')
  if (token.includes('powerautomatefree') || token === 'flowfree') keys.push('powerautomatefree')
  if (token.includes('exchangeonlineplan1') || token === 'exchangestandard') keys.push('exchangeonlineplan1')
  return [...new Set(keys)]
}

function planMatches(local: string | null, graphPlans: string[]) {
  const localKeys = planKeys(local)
  const graphKeys = [...new Set(graphPlans.flatMap(planKeys))]
  if (!localKeys.length || !graphKeys.length) return null
  return localKeys.length === graphKeys.length && localKeys.every(key => graphKeys.includes(key))
}

function relevantAuditEvents(events: M365AuditEvent[], users: M365User[]) {
  const ids = new Set(users.map(user => user.id))
  return events.filter(event => {
    if (!event.targetResources?.some(target => target.id && ids.has(target.id))) return false
    const activity = clean(event.activityDisplayName)
    const properties = event.targetResources?.flatMap(target => target.modifiedProperties ?? []).map(property => clean(property.displayName)) ?? []
    const emailChanged = properties.some(property => ['mail', 'userprincipalname', 'proxyaddresses', 'othermails'].includes(property))
    const accountDisabled = properties.includes('accountenabled')
    return activity.includes('add user') || activity.includes('create user') || activity.includes('delete user') ||
      activity.includes('remove license') || activity.includes('revoke license') || activity.includes('assign license') ||
      activity.includes('update user license') || activity.includes('change user license') ||
      (activity.includes('update user') && (emailChanged || accountDisabled))
  })
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const requestedDays = Number(req.nextUrl.searchParams.get('days') ?? '30')
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(Math.trunc(requestedDays), 1), 90) : 30

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const [localResult, allUsers, skus, audits] = await Promise.all([
      // This app registration belongs to the AFS tenant. TNT and ZFS use
      // separate admin domains/tenants and must never enter this comparison.
      db().from('licenses').select('id,account_id,display_name,email_address,license_plan,status,company,created_date').eq('company', 'AFS').order('account_id'),
      listUsers(), listSubscribedSkus(), listDirectoryAudits(since),
    ])
    if (localResult.error) throw new Error('Unable to read local license records')
    const users = allUsers.filter(isAfsUser)
    // Unlicensed users do not represent an active subscription and are
    // intentionally excluded from comparison counts.
    const licensedUsers = users.filter(user => (user.assignedLicenses?.length ?? 0) > 0)

    const local = (localResult.data ?? []) as LicenseRow[]
    const byEmail = new Map<string, LicenseRow[]>()
    for (const row of local) {
      const key = clean(row.email_address)
      if (key) byEmail.set(key, [...(byEmail.get(key) ?? []), row])
    }
    const skuMap = new Map(skus.map(sku => [sku.skuId.toLowerCase(), sku]))
    const matchedLocalIds = new Set<string>()
    const comparisons = licensedUsers.map(user => {
      const email = emailOf(user)
      const candidates = [...new Map(userEmails(user).flatMap(key => byEmail.get(key) ?? []).map(row => [row.id, row])).values()]
      const row = candidates.length === 1 ? candidates[0] : null
      if (row) matchedLocalIds.add(row.id)
      const graphPlans = (user.assignedLicenses ?? []).map(license => {
        const sku = skuMap.get((license.skuId ?? '').toLowerCase())
        const code = sku?.skuPartNumber ?? license.skuId
        return code ? M365_SKU_DISPLAY_NAMES[code.toUpperCase()] ?? code : null
      }).filter((value): value is string => !!value)
      const localActive = row ? clean(row.status) === 'active' : null
      const graphActive = user.accountEnabled !== false && graphPlans.length > 0
      const planStatus = row ? planMatches(row.license_plan, graphPlans) : null
      return {
        graph_user_id: user.id, email: user.mail ?? user.userPrincipalName ?? null,
        graph_name: user.displayName ?? ([user.givenName, user.surname].filter(Boolean).join(' ') || null),
        graph_created_at: user.createdDateTime ?? null, graph_account_enabled: user.accountEnabled ?? null,
        graph_plans: graphPlans, local: row, local_match_count: candidates.length,
        plan_status: planStatus === true ? 'match' : planStatus === false ? 'mismatch' : 'unverified',
        result: !row ? 'microsoft_only' : candidates.length > 1 ? 'ambiguous_email' : localActive !== graphActive ? 'active_status_mismatch' : planStatus === false ? 'plan_mismatch' : planStatus === null ? 'plan_unverified' : 'match',
      }
    })
    const knownGraphEmails = new Set(users.flatMap(userEmails))
    const dbOnly = local.filter(row => !matchedLocalIds.has(row.id) && !knownGraphEmails.has(clean(row.email_address))).map(row => ({ result: 'database_only', local: row }))
    const allComparisons = [...comparisons, ...dbOnly]
    const summary = allComparisons.reduce<Record<string, number>>((acc, item) => { acc[item.result] = (acc[item.result] ?? 0) + 1; return acc }, {})

    return NextResponse.json({ tenant_company: 'AFS', mode: 'dry-run', writes_performed: false, checked_at: new Date().toISOString(), audit_since: since.toISOString(), summary, comparisons: allComparisons, audit_events: relevantAuditEvents(audits, users).slice(0, 500), sku_catalog: skus })
  } catch (error) {
    console.error('[m365-dry-run]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'M365 dry run failed' }, { status: 500 })
  }
}
