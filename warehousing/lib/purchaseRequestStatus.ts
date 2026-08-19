import type { Category, PurchaseRequest, PurchaseStatus } from './types'
import type { Role } from '@/app/providers'

export const STATUS_BADGE: Record<PurchaseStatus, { label: string; className: string }> = {
  draft:                 { label: '임시저장',        className: 'text-ink-faint font-medium' },
  submitted:             { label: '제출됨',          className: 'text-ink-muted font-medium' },
  under_review:          { label: '검토 중',          className: 'text-amber-600 font-semibold' },
  more_info_requested:   { label: '추가 정보 요청',    className: 'text-signal-neg font-semibold' },
  approved:              { label: '승인됨',           className: 'text-signal-pos font-semibold' },
  rejected:              { label: '반려됨',           className: 'text-signal-neg font-semibold' },
  ordered:               { label: '발주 완료',         className: 'text-ink-muted font-medium' },
  awaiting_po:           { label: 'PO 대기',           className: 'text-amber-600 font-semibold' },
  po_received:           { label: 'PO 접수',           className: 'text-ink-muted font-medium' },
  awaiting_bookkeeping:  { label: '경리 대기',         className: 'text-amber-600 font-semibold' },
  accounting_recorded:   { label: '회계 처리 완료',     className: 'text-ink-muted font-medium' },
  customer_billed:       { label: '고객 청구 완료',     className: 'text-signal-pos font-semibold' },
  closed:                { label: '종료',              className: 'text-ink-faint font-medium' },
}

/** Which statuses this request will pass through, given its chargeback/PO flags. Used to render progress steps. */
export function applicableStatusSequence(req: Pick<PurchaseRequest, 'is_customer_chargeback' | 'po_required'>): PurchaseStatus[] {
  const seq: PurchaseStatus[] = ['draft', 'submitted', 'under_review', 'approved', 'ordered']
  if (req.is_customer_chargeback && req.po_required === 'yes') {
    seq.push('awaiting_po', 'po_received')
  }
  seq.push('awaiting_bookkeeping', 'accounting_recorded')
  if (req.is_customer_chargeback) {
    seq.push('customer_billed')
  }
  seq.push('closed')
  return seq
}

/** What needs to happen next, and who owns it — powers the detail page's "next step" prompt and dashboard counts. */
export function computeNextAction(req: PurchaseRequest): { role: Role; label: string } | null {
  switch (req.status) {
    case 'draft':               return { role: 'requester', label: '요청서를 제출하세요' }
    case 'submitted':
    case 'under_review':        return { role: 'purchasing', label: '검토가 필요합니다' }
    case 'more_info_requested': return { role: 'requester', label: '추가 정보를 입력하세요' }
    case 'approved':            return { role: 'purchasing', label: '발주를 진행하세요' }
    case 'ordered':              return { role: 'purchasing', label: '다음 단계로 진행하세요' }
    case 'awaiting_po':          return { role: 'operations', label: 'PO 번호를 입력하세요' }
    case 'po_received':          return { role: 'purchasing', label: '경리 전달을 준비하세요' }
    case 'awaiting_bookkeeping': return { role: 'bookkeeping', label: '회계 처리가 필요합니다' }
    case 'accounting_recorded':
      return req.is_customer_chargeback
        ? { role: 'bookkeeping', label: '고객 청구 처리가 필요합니다' }
        : { role: 'purchasing', label: '요청을 종료할 수 있습니다' }
    case 'customer_billed':      return { role: 'purchasing', label: '요청을 종료할 수 있습니다' }
    case 'rejected':
    case 'closed':
    default:
      return null
  }
}

/** Submit-time validation: `errors` block submission, `warnings` are shown but don't block it. */
export function missingRequiredFields(
  req: Pick<PurchaseRequest, 'item_name' | 'quantity' | 'sku' | 'product_url' | 'specifications' | 'is_customer_chargeback' | 'customer_id' | 'po_required'>,
  category: Category | null
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  if (!req.item_name?.trim()) errors.push('품목명을 입력하세요.')
  if (!req.quantity || req.quantity <= 0) errors.push('수량을 입력하세요.')

  if (category?.requires_identifier) {
    if (!req.sku?.trim() && !req.product_url?.trim()) {
      errors.push(`"${category.name}" 카테고리는 SKU 또는 상품 URL 중 하나가 반드시 있어야 합니다.`)
    }
    if (!req.specifications?.trim()) {
      warnings.push('사양(Specifications)을 함께 입력하면 처리가 더 빨라집니다.')
    }
  }

  if (req.is_customer_chargeback) {
    if (!req.customer_id) errors.push('고객 청구 건은 고객을 선택해야 합니다.')
    if (req.po_required === 'unknown') warnings.push('PO 필요 여부를 확인해 주세요 (모를 경우 담당자에게 문의).')
  }

  return { errors, warnings }
}

/**
 * Whether a status transition is currently allowed given the request's own
 * data — returns a reason string if blocked, or null if OK. Called by every
 * transition button, not just at submit time.
 */
export function isBlocked(req: PurchaseRequest, targetStatus: PurchaseStatus, category: Category | null): string | null {
  if (targetStatus === 'submitted') {
    const { errors } = missingRequiredFields(req, category)
    if (errors.length) return errors[0]
  }

  if (targetStatus === 'accounting_recorded' && req.is_customer_chargeback && req.po_required === 'yes' && !req.po_number?.trim()) {
    return 'PO 번호가 입력되어야 회계 처리 완료로 넘어갈 수 있습니다.'
  }

  if (targetStatus === 'customer_billed' && !req.accounting_recorded) {
    return '회계 처리가 먼저 완료되어야 합니다.'
  }

  if (targetStatus === 'closed') {
    if (req.is_customer_chargeback && req.customer_billing_status !== 'billed') {
      return '고객 청구가 완료되어야 종료할 수 있습니다.'
    }
    if (!req.is_customer_chargeback && !req.accounting_recorded) {
      return '회계 처리가 완료되어야 종료할 수 있습니다.'
    }
  }

  return null
}
