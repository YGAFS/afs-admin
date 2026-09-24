type GraphPage<T> = { value?: T[]; '@odata.nextLink'?: string }

export type M365User = {
  id: string
  displayName?: string | null
  givenName?: string | null
  surname?: string | null
  mail?: string | null
  userPrincipalName?: string | null
  proxyAddresses?: string[] | null
  otherMails?: string[] | null
  accountEnabled?: boolean | null
  createdDateTime?: string | null
  assignedLicenses?: Array<{ skuId?: string; disabledPlans?: string[] }>
}

export type M365Sku = {
  skuId: string
  skuPartNumber?: string | null
  capabilityStatus?: string | null
  consumedUnits?: number | null
  prepaidUnits?: { enabled?: number | null; suspended?: number | null; warning?: number | null } | null
  servicePlans?: Array<{ servicePlanId?: string; servicePlanName?: string; provisioningStatus?: string }>
}

// Graph returns skuPartNumber codes, while the admin center shows friendly
// product names. Keep this mapping small and explicit; unknown SKUs remain
// visible as their Graph code instead of being guessed.
export const M365_SKU_DISPLAY_NAMES: Record<string, string> = {
  SPB: 'Microsoft 365 Business Premium',
  O365_BUSINESS_PREMIUM: 'Microsoft 365 Business Standard',
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
  EXCHANGESTANDARD: 'Exchange Online (Plan 1)',
  FLOW_FREE: 'Microsoft Power Automate Free',
}

export type M365AuditEvent = {
  id: string
  activityDateTime?: string | null
  activityDisplayName?: string | null
  category?: string | null
  initiatedBy?: { user?: { id?: string; userPrincipalName?: string; displayName?: string } | null; app?: { appId?: string; displayName?: string } | null } | null
  targetResources?: Array<{ id?: string; displayName?: string; userPrincipalName?: string; type?: string; modifiedProperties?: Array<{ displayName?: string; oldValue?: string | null; newValue?: string | null }> }>
  audit_kind?: 'created' | 'license' | 'deleted' | 'email' | 'changed'
}

export type M365Company = 'AFS' | 'TNT' | 'ZFS'

type GraphConfig = {
  tenant: string
  clientId: string
  clientSecret: string
  domain: string
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function graphConfig(company: M365Company = 'AFS'): GraphConfig {
  if (company === 'TNT') return {
    tenant: requiredEnv('M365_GRAPH_TNT_TENANT_ID'),
    clientId: requiredEnv('M365_GRAPH_TNT_CLIENT_ID'),
    clientSecret: requiredEnv('M365_GRAPH_TNT_CLIENT_SECRET'),
    domain: 'tnt-expresslines.com',
  }
  if (company === 'ZFS') return {
    tenant: requiredEnv('M365_GRAPH_ZFS_TENANT_ID'),
    clientId: requiredEnv('M365_GRAPH_ZFS_CLIENT_ID'),
    clientSecret: requiredEnv('M365_GRAPH_ZFS_CLIENT_SECRET'),
    domain: 'zenithfortio.com',
  }
  return {
    tenant: requiredEnv('M365_GRAPH_TENANT_ID'),
    clientId: requiredEnv('M365_GRAPH_CLIENT_ID'),
    clientSecret: requiredEnv('M365_GRAPH_CLIENT_SECRET'),
    domain: 'afstransco.com',
  }
}

async function getToken(company: M365Company) {
  const config = graphConfig(company)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store', signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Graph token request failed (${response.status})`)
    const json = await response.json() as { access_token?: string }
    if (!json.access_token) throw new Error('Graph token response did not contain an access token')
    return json.access_token
  } finally { clearTimeout(timeout) }
}

async function graph<T>(pathOrUrl: string, company: M365Company): Promise<T> {
  const token = await getToken(company)
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://graph.microsoft.com/v1.0${pathOrUrl}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`Graph request failed (${response.status})`)
    return await response.json() as T
  } finally { clearTimeout(timeout) }
}

async function collect<T>(path: string, company: M365Company, maxPages = 100) {
  const rows: T[] = []
  let next: string | undefined = path
  let pages = 0
  while (next && pages < maxPages) {
    const page: GraphPage<T> = await graph<GraphPage<T>>(next, company)
    rows.push(...(page.value ?? []))
    next = page['@odata.nextLink']
    pages += 1
  }
  if (next) throw new Error('Graph pagination exceeded the safety limit')
  return rows
}

export async function listUsers(company: M365Company = 'AFS') {
  const select = 'id,displayName,givenName,surname,mail,userPrincipalName,proxyAddresses,otherMails,accountEnabled,createdDateTime,assignedLicenses'
  return collect<M365User>(`/users?$select=${select}&$top=999`, company)
}

export async function listSubscribedSkus(company: M365Company = 'AFS') {
  return collect<M365Sku>('/subscribedSkus?$select=skuId,skuPartNumber,capabilityStatus,consumedUnits,prepaidUnits,servicePlans', company)
}

export async function getMailboxUserPurpose(userId: string, company: M365Company = 'AFS') {
  const settings = await graph<{ userPurpose?: string | null }>(`/users/${encodeURIComponent(userId)}/mailboxSettings?$select=userPurpose`, company)
  return settings.userPurpose ?? null
}

export async function listDirectoryAudits(since: Date, company: M365Company = 'AFS') {
  const filter = encodeURIComponent(`activityDateTime ge ${since.toISOString()}`)
  // A 90-day window can exceed 20 pages in an active tenant. Keep the same
  // pagination safety mechanism as the other collection calls, with room for
  // the requested maximum window.
  // Graph can reject combining this date filter with $orderby for directory
  // audits. Sorting is performed after collection by the API route.
  return collect<M365AuditEvent>(`/auditLogs/directoryAudits?$filter=${filter}&$top=999`, company, 100)
}
