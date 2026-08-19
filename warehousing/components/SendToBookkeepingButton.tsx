'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { sendGraphMail } from '@/lib/graphMail'
import type { Customer, PaymentMethod, PurchaseRequest } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

async function buildBody(req: PurchaseRequest): Promise<string> {
  let customerName = ''
  if (req.customer_id) {
    const { data } = await supabase.from('customers').select('name').eq('id', req.customer_id).maybeSingle()
    customerName = (data as Customer | null)?.name ?? ''
  }
  let cardLabel = ''
  if (req.payment_method_id) {
    const { data } = await supabase.from('payment_methods').select('label').eq('id', req.payment_method_id).maybeSingle()
    cardLabel = (data as PaymentMethod | null)?.label ?? ''
  }
  const lines = [
    `요청 번호: ${req.request_number}`,
    `업체: ${req.vendor ?? '-'}`,
    `구매일: ${req.order_date ?? '-'}`,
    `합계: ${req.total != null ? `${req.total} ${req.currency}` : '-'}`,
    `사용 카드: ${cardLabel || '-'}`,
    `요청자: ${req.requested_by_email}`,
    `구매자: ${req.purchased_by ?? '-'}`,
  ]
  if (customerName) lines.push(`고객: ${customerName}`)
  if (req.po_number) lines.push(`PO 번호: ${req.po_number}`)
  lines.push(`주문번호: ${req.order_number ?? '-'}`)
  return lines.join('\n')
}

export default function SendToBookkeepingButton({ req, onSent }: { req: PurchaseRequest; onSent: () => void }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setSending(true)
    setError(null)

    const { data: setting } = await supabase.from('warehousing_settings').select('value').eq('key', 'bookkeeping_email').maybeSingle()
    const to = setting?.value?.trim()
    if (!to) {
      setError('경리 담당자 이메일이 설정되지 않았습니다. 관리자 페이지에서 설정해 주세요.')
      setSending(false)
      return
    }

    try {
      const body = await buildBody(req)
      await sendGraphMail({
        to,
        subject: `[구매요청] ${req.request_number} — ${req.item_name}`,
        body,
      })
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : '전송에 실패했습니다.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button onClick={handleClick} disabled={sending} className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint">
        {sending ? '전송 중…' : '경리에게 전달'}
      </button>
      {error && <p className="text-xs text-signal-neg">{error}</p>}
    </div>
  )
}
