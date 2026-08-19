'use client'

export const dynamic = 'force-dynamic'

import { useAuth } from '@/app/providers'
import RequestList, { type QueueConfig } from '@/components/RequestList'

export default function RequestsPage() {
  const { user, role } = useAuth()
  if (!role || role === 'none') return null

  const config: QueueConfig =
    role === 'requester'
      ? { title: '내 요청', subtitle: '내가 작성한 구매 요청 목록입니다.', scope: 'mine', columnSet: 'purchasing' }
      : { title: '구매 요청 목록', subtitle: '전체 구매 요청을 확인하고 처리하세요.', scope: 'all', columnSet: 'purchasing' }

  return <RequestList config={config} role={role} userEmail={user?.email ?? null} />
}
