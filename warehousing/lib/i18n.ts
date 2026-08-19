import type { PurchaseStatus } from './types'

export type UiLanguage = 'en' | 'ko'

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en'
export const ADMIN_EMAILS = ['admin@afstransco.com']

export const STATUS_CLASSNAMES: Record<PurchaseStatus, string> = {
  draft: 'text-ink-faint font-medium',
  submitted: 'text-ink-muted font-medium',
  under_review: 'text-amber-600 font-semibold',
  more_info_requested: 'text-signal-neg font-semibold',
  approved: 'text-signal-pos font-semibold',
  rejected: 'text-signal-neg font-semibold',
  ordered: 'text-ink-muted font-medium',
  awaiting_po: 'text-amber-600 font-semibold',
  po_received: 'text-ink-muted font-medium',
  awaiting_bookkeeping: 'text-amber-600 font-semibold',
  accounting_recorded: 'text-ink-muted font-medium',
  customer_billed: 'text-signal-pos font-semibold',
  closed: 'text-ink-faint font-medium',
}

const STATUS_LABELS: Record<UiLanguage, Record<PurchaseStatus, string>> = {
  en: {
    draft: 'Draft',
    submitted: 'Submitted',
    under_review: 'Under Review',
    more_info_requested: 'More Info Requested',
    approved: 'Approved',
    rejected: 'Rejected',
    ordered: 'Ordered',
    awaiting_po: 'Awaiting PO',
    po_received: 'PO Received',
    awaiting_bookkeeping: 'Awaiting Bookkeeping',
    accounting_recorded: 'Accounting Recorded',
    customer_billed: 'Customer Billed',
    closed: 'Closed',
  },
  ko: {
    draft: '임시저장',
    submitted: '제출됨',
    under_review: '검토 중',
    more_info_requested: '추가 정보 요청',
    approved: '승인됨',
    rejected: '반려됨',
    ordered: '발주 완료',
    awaiting_po: 'PO 대기',
    po_received: 'PO 접수',
    awaiting_bookkeeping: '경리 대기',
    accounting_recorded: '회계 처리 완료',
    customer_billed: '고객 청구 완료',
    closed: '종료',
  },
}

export function statusLabel(locale: UiLanguage, status: PurchaseStatus) {
  return STATUS_LABELS[locale][status]
}
