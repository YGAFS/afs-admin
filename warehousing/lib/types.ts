export type CompanyId = 'afs' | 'tnt' | 'zfs'

export type PurchaseStatus =
  | 'draft' | 'submitted' | 'under_review' | 'more_info_requested'
  | 'approved' | 'rejected' | 'ordered' | 'awaiting_po' | 'po_received'
  | 'awaiting_bookkeeping' | 'accounting_recorded' | 'customer_billed' | 'closed'

export type DeliveryMethod = 'delivery' | 'pickup' | 'other'
export type PoRequired = 'yes' | 'no' | 'unknown'
export type CustomerBillingStatus = 'not_applicable' | 'pending' | 'billed'
export type Currency = 'CAD' | 'USD'

export interface Category {
  id: string
  name: string
  requires_identifier: boolean
  is_active: boolean
  sort_order: number
}

export interface Customer {
  id: string
  company_id: CompanyId
  name: string
  code: string | null
  notes: string | null
  is_active: boolean
}

export interface Location {
  id: string
  company_id: CompanyId
  name: string
  region: string | null
  city: string | null
  address: string | null
}

export interface PaymentMethod {
  id: string
  company_id: CompanyId
  label: string
}

export interface PurchaseRequest {
  id: string
  request_number: string
  company_id: CompanyId
  requested_by_email: string
  status: PurchaseStatus

  // Request details
  item_name: string
  description: string | null
  quantity: number | null
  unit_type: string | null
  product_url: string | null
  sku: string | null
  specifications: string | null
  preferred_vendor: string | null
  estimated_price: number | null
  needed_by_date: string | null
  delivery_method: DeliveryMethod | null
  delivery_location_id: string | null
  business_reason: string | null
  notes: string | null
  category_id: string | null

  // Chargeback / PO
  is_customer_chargeback: boolean
  customer_id: string | null
  po_required: PoRequired
  billing_notes: string | null
  po_number: string | null
  po_entered_by: string | null
  po_entered_at: string | null
  customer_billing_status: CustomerBillingStatus
  customer_billed_by: string | null
  customer_billed_at: string | null

  // Purchasing
  vendor: string | null
  actual_quantity: number | null
  subtotal: number | null
  tax: number | null
  shipping: number | null
  total: number | null
  currency: Currency
  payment_method_id: string | null
  order_date: string | null
  order_number: string | null
  expected_delivery_date: string | null
  actual_delivery_date: string | null
  purchase_notes: string | null
  purchased_by: string | null

  // Accounting
  ready_for_bookkeeping: boolean
  ready_for_bookkeeping_at: string | null
  sent_to_bookkeeping_at: string | null
  sent_to_bookkeeping_by: string | null
  accounting_recorded: boolean
  accounting_recorded_by: string | null
  accounting_recorded_at: string | null

  // Approval
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null

  submitted_at: string | null
  created_at: string
  updated_at: string
}

export interface ActivityEntry {
  id: string
  purchase_request_id: string
  actor_email: string
  action: string
  detail: string | null
  created_at: string
}

export interface Attachment {
  id: string
  purchase_request_id: string
  storage_path: string
  file_name: string
  file_type: string | null
  uploaded_by: string
  created_at: string
}
