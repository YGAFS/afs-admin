'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import type { Role } from '@/app/providers'
import { STATUS_BADGE, computeNextAction } from '@/lib/purchaseRequestStatus'
import type { Customer, Location, PurchaseRequest, PurchaseStatus } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

export interface QueueConfig {
  title: string
  subtitle: string
  /** 'mine' restricts to the signed-in user's own requests (requester view). 'queue' shows everything the role can see. */
  scope: 'mine' | 'all'
  /** Preselected status filter — e.g. bookkeeping only cares about these statuses by default. */
  baseStatusFilter?: PurchaseStatus[]
  /** Which extra column set to render — the two queues in the brief differ in column shape, not structure. */
  columnSet: 'purchasing' | 'bookkeeping'
}

interface Props {
  config: QueueConfig
  role: Role
  userEmail: string | null
}

const ALL_STATUSES: PurchaseStatus[] = [
  'draft', 'submitted', 'under_review', 'more_info_requested', 'approved', 'rejected',
  'ordered', 'awaiting_po', 'po_received', 'awaiting_bookkeeping', 'accounting_recorded',
  'customer_billed', 'closed',
]

export default function RequestList({ config, role, userEmail }: Props) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [customers, setCustomers] = useState<Record<string, Customer>>({})
  const [locations, setLocations] = useState<Record<string, Location>>({})
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | 'all'>(config.baseStatusFilter?.[0] ?? 'all')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [config.scope, userEmail])

  async function load() {
    setLoading(true)
    let query = supabase.from('purchase_requests').select('*').order('created_at', { ascending: false })
    if (config.scope === 'mine' && userEmail) {
      query = query.eq('requested_by_email', userEmail)
    }
    if (config.baseStatusFilter?.length) {
      query = query.in('status', config.baseStatusFilter)
    }
    const { data } = await query
    const rows = (data as PurchaseRequest[]) ?? []
    setRequests(rows)

    const customerIds = [...new Set(rows.map(r => r.customer_id).filter(Boolean))] as string[]
    const locationIds = [...new Set(rows.map(r => r.delivery_location_id).filter(Boolean))] as string[]
    if (customerIds.length) {
      const { data: custs } = await supabase.from('customers').select('*').in('id', customerIds)
      setCustomers(Object.fromEntries(((custs as Customer[]) ?? []).map(c => [c.id, c])))
    }
    if (locationIds.length) {
      const { data: locs } = await supabase.from('utility_locations').select('id, company_id, name, region, city, address').in('id', locationIds)
      setLocations(Object.fromEntries(((locs as Location[]) ?? []).map(l => [l.id, l])))
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (!config.baseStatusFilter && statusFilter !== 'all' && r.status !== statusFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const hay = [r.request_number, r.item_name, r.vendor, r.order_number, r.po_number, customers[r.customer_id ?? '']?.name]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [requests, statusFilter, search, config.baseStatusFilter, customers])

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-ink mb-1">{config.title}</h1>
      <p className="text-sm text-ink-faint mb-6">{config.subtitle}</p>

      <div className="flex items-center gap-3 mb-4">
        {!config.baseStatusFilter && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as PurchaseStatus | 'all')} className="border border-line rounded-lg px-3 py-1.5 text-sm">
            <option value="all">전체 상태</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_BADGE[s].label}</option>)}
          </select>
        )}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="요청번호, 품목, 업체, 주문번호, PO번호, 고객으로 검색"
          className="flex-1 border border-line rounded-lg px-3 py-1.5 text-sm"
        />
      </div>

      <div className="bg-white rounded-xl border border-line-soft overflow-hidden overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-ink-faint">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-ink-faint">해당하는 요청이 없습니다.</div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-ink-faint uppercase tracking-wide">
                <th className="px-4 py-2">요청번호</th>
                <th className="px-4 py-2">품목</th>
                {config.columnSet === 'purchasing' ? (
                  <>
                    <th className="px-4 py-2">요청자</th>
                    <th className="px-4 py-2">위치</th>
                    <th className="px-4 py-2">수량</th>
                    <th className="px-4 py-2">고객</th>
                    <th className="px-4 py-2">필요일</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-2">업체</th>
                    <th className="px-4 py-2">구매일</th>
                    <th className="px-4 py-2">합계</th>
                    <th className="px-4 py-2">고객</th>
                    <th className="px-4 py-2">PO</th>
                  </>
                )}
                <th className="px-4 py-2">상태</th>
                <th className="px-4 py-2">해야 할 일</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const badge = STATUS_BADGE[r.status]
                const next = computeNextAction(r)
                const location = r.delivery_location_id ? locations[r.delivery_location_id] : null
                const customer = r.customer_id ? customers[r.customer_id] : null
                return (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-pill/50">
                    <td className="px-4 py-2.5">
                      <Link href={`/requests/${r.id}`} className="text-ink font-mono text-xs hover:underline">{r.request_number}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{r.item_name}</td>
                    {config.columnSet === 'purchasing' ? (
                      <>
                        <td className="px-4 py-2.5 text-ink-muted">{r.requested_by_email}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{location?.name ?? '-'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{r.quantity ?? '-'} {r.unit_type ?? ''}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{customer?.name ?? '-'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{r.needed_by_date ?? '-'}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-ink-muted">{r.vendor ?? '-'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{r.order_date ?? '-'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{r.total != null ? `${r.total} ${r.currency}` : '-'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{customer?.name ?? '-'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{r.po_number ?? (r.po_required === 'yes' ? '대기' : '-')}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5"><span className={`text-xs ${badge.className}`}>{badge.label}</span></td>
                    <td className="px-4 py-2.5 text-ink-muted text-xs">{next?.label ?? '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
