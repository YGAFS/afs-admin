import type { PurchaseRequest } from './types'
import type { Role } from '@/app/providers'

export interface SectionVisibility {
  requestDetails: boolean
  purchasing: boolean
  poBilling: boolean
  accounting: boolean
}

/**
 * Which sections of the Request Detail page a role can even see, rendered
 * conditionally rather than just visually disabled — a requester's browser
 * never receives another department's card/pricing info in the DOM.
 *
 * Judgment call (flagged in the implementation plan, not stated explicitly
 * in the brief): `operations` sees the PO/Billing section only, not full
 * purchasing pricing (subtotal/tax/total/card) — the brief grants them
 * "customer and chargeback information," not pricing, and the same
 * least-privilege logic the brief applies to requesters (who must not see
 * card details) extends to them by default.
 */
export function visibleSections(role: Role, req: Pick<PurchaseRequest, 'is_customer_chargeback'>): SectionVisibility {
  switch (role) {
    case 'requester':
      return { requestDetails: true, purchasing: false, poBilling: false, accounting: false }
    case 'operations':
      return { requestDetails: true, purchasing: false, poBilling: req.is_customer_chargeback, accounting: false }
    case 'purchasing':
      return { requestDetails: true, purchasing: true, poBilling: req.is_customer_chargeback, accounting: true }
    case 'bookkeeping':
      return { requestDetails: true, purchasing: true, poBilling: req.is_customer_chargeback, accounting: true }
    case 'admin':
      return { requestDetails: true, purchasing: true, poBilling: req.is_customer_chargeback, accounting: true }
  }
}

/** Whether the given role can currently edit the Request Details fields (item/qty/SKU/etc). */
export function canEditRequestDetails(role: Role, req: Pick<PurchaseRequest, 'status' | 'requested_by_email'>, userEmail: string | null): boolean {
  if (role === 'admin') return true
  const editableStatus = req.status === 'draft' || req.status === 'more_info_requested'
  if (role === 'requester') return editableStatus && req.requested_by_email === userEmail
  return false
}

/** Whether the given role can edit the Purchasing section (approve/vendor/pricing/order info). */
export function canEditPurchasing(role: Role): boolean {
  return role === 'purchasing' || role === 'admin'
}

/** Whether the given role can edit the PO number / PO notes. */
export function canEditPo(role: Role): boolean {
  return role === 'operations' || role === 'admin'
}

/** Whether the given role can edit the Accounting section (recorded / customer billed). */
export function canEditAccounting(role: Role): boolean {
  return role === 'bookkeeping' || role === 'admin'
}
