'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { useAuth, type Role } from './providers'
import { STATUS_BADGE, computeNextAction } from '@/lib/purchaseRequestStatus'
import type { PurchaseRequest } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const ROLE_GREETING: Record<Role, string> = {
  requester: '내 요청 현황입니다.',
  purchasing: '처리가 필요한 구매 요청입니다.',
  operations: 'PO 입력이 필요한 건입니다.',
  bookkeeping: '회계 처리 및 고객 청구가 필요한 건입니다.',
  admin: '전체 현황입니다.',
}

export default function DashboardPage() {
  const { user, role } = useAuth()
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!role || role === 'none') return
    supabase
      .from('purchase_requests')
      .select('*')
      .not('status', 'in', '(closed,rejected)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setRequests((data as PurchaseRequest[]) ?? [])
        setLoading(false)
      })
  }, [role])

  const myActionItems = useMemo(() => {
    if (!role) return []
    return requests.filter(r => {
      if (role === 'requester') return r.requested_by_email === user?.email && computeNextAction(r)?.role === 'requester'
      return computeNextAction(r)?.role === role
    })
  }, [requests, role, user?.email])

  const counts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return {
      awaitingReview: requests.filter(r => r.status === 'submitted' || r.status === 'under_review').length,
      awaitingPurchase: requests.filter(r => r.status === 'approved').length,
      awaitingPo: requests.filter(r => r.status === 'awaiting_po').length,
      awaitingBookkeeping: requests.filter(r => r.status === 'awaiting_bookkeeping').length,
      billingPending: requests.filter(r => r.is_customer_chargeback && r.status === 'accounting_recorded').length,
      delayed: requests.filter(r => r.needed_by_date && r.needed_by_date < today && !['awaiting_bookkeeping', 'accounting_recorded', 'customer_billed'].includes(r.status)).length,
    }
  }, [requests])

  if (!role || role === 'none') return null

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">대시보드</h1>
        <p className="text-sm text-ink-faint mt-1">{ROLE_GREETING[role]}</p>
      </div>

      {(role === 'purchasing' || role === 'admin') && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <StatTile label="검토 대기" value={counts.awaitingReview} />
          <StatTile label="발주 대기" value={counts.awaitingPurchase} />
          <StatTile label="PO 대기" value={counts.awaitingPo} />
          <StatTile label="경리 대기" value={counts.awaitingBookkeeping} />
          <StatTile label="청구 대기" value={counts.billingPending} />
          <StatTile label="지연" value={counts.delayed} highlight={counts.delayed > 0} />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-line-soft overflow-hidden">
        <div className="px-6 py-4 border-b border-line-soft">
          <h2 className="text-sm font-semibold text-ink">내가 처리해야 할 항목</h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-ink-faint">불러오는 중…</div>
        ) : myActionItems.length === 0 ? (
          <div className="p-6 text-sm text-ink-faint">처리할 항목이 없습니다.</div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {myActionItems.map(r => {
              const badge = STATUS_BADGE[r.status]
              const next = computeNextAction(r)
              return (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`} className="flex items-center justify-between px-6 py-3 hover:bg-pill/50 transition-colors">
                    <div>
                      <span className="text-xs font-mono text-ink-faint mr-2">{r.request_number}</span>
                      <span className="text-sm text-ink">{r.item_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs ${badge.className}`}>{badge.label}</span>
                      {next && <span className="text-xs text-ink-muted">{next.label}</span>}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {role === 'requester' && (
        <Link href="/requests/new" className="inline-block px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90">
          + 새 구매 요청 작성
        </Link>
      )}
    </div>
  )
}

function StatTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-line-soft p-4">
      <div className={`text-2xl font-bold ${highlight ? 'text-signal-neg' : 'text-ink'}`}>{value}</div>
      <div className="text-xs text-ink-faint mt-0.5">{label}</div>
    </div>
  )
}
