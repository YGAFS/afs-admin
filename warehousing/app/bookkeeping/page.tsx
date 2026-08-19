'use client'

export const dynamic = 'force-dynamic'

import { useAuth } from '@/app/providers'
import RequestList, { type QueueConfig } from '@/components/RequestList'

const config: QueueConfig = {
  title: '경리 대기',
  subtitle: '회계 처리 및 고객 청구가 필요한 구매 건입니다.',
  scope: 'all',
  baseStatusFilter: ['awaiting_bookkeeping', 'accounting_recorded'],
  columnSet: 'bookkeeping',
}

export default function BookkeepingPage() {
  const { user, role } = useAuth()
  if (!role || role === 'none') return null

  return <RequestList config={config} role={role} userEmail={user?.email ?? null} />
}
