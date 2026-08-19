'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { ActivityEntry } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ActivityLog({ purchaseRequestId, refreshKey }: { purchaseRequestId: string; refreshKey?: number }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('purchase_request_activity')
      .select('*')
      .eq('purchase_request_id', purchaseRequestId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setEntries((data as ActivityEntry[]) ?? [])
        setLoading(false)
      })
  }, [purchaseRequestId, refreshKey])

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">진행 이력</h3>
      {loading ? (
        <p className="text-sm text-ink-faint">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-ink-faint">아직 기록이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(e => (
            <li key={e.id} className="text-sm text-ink-muted">
              <span className="text-ink-faint">{formatTime(e.created_at)}</span>
              {' — '}
              <span className="text-ink">{e.actor_email}</span>
              {e.detail ? `: ${e.detail}` : ` — ${e.action}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
