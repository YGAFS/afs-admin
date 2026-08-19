'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { Role } from '@/app/providers'
import { useAuth } from '@/app/providers'
import { isBlocked } from '@/lib/purchaseRequestStatus'
import { visibleSections, canEditPurchasing, canEditPo, canEditAccounting } from '@/lib/purchaseRequestAccess'
import { logActivity } from '@/lib/activity'
import type { Category, Customer, PaymentMethod, PurchaseRequest, PurchaseStatus } from '@/lib/types'
import { useEffect } from 'react'
import SendToBookkeepingButton from './SendToBookkeepingButton'
import AttachmentUploader from './AttachmentUploader'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const inputClass = 'w-full border border-line rounded-lg px-3 py-2 text-sm disabled:bg-pill disabled:text-ink-faint'
const labelClass = 'block text-xs font-semibold text-ink-muted mb-1'

interface Props {
  req: PurchaseRequest
  category: Category | null
  role: Role
  onChanged: () => void
}

export default function RequestDetailSections({ req, category, role, onChanged }: Props) {
  const { user } = useAuth()
  const sections = visibleSections(role, req)
  const [error, setError] = useState<string | null>(null)

  async function update(payload: Partial<PurchaseRequest>) {
    await supabase.from('purchase_requests').update(payload).eq('id', req.id)
  }

  async function transition(target: PurchaseStatus, payload: Partial<PurchaseRequest>, actionLabel: string) {
    const merged = { ...req, ...payload } as PurchaseRequest
    const reason = isBlocked(merged, target, category)
    if (reason) { setError(reason); return }
    setError(null)
    await update({ ...payload, status: target })
    await logActivity(req.id, user?.email ?? '', target, `${user?.email}님이 ${actionLabel}`)
    onChanged()
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-signal-neg text-sm rounded-lg px-3 py-2">{error}</div>
      )}

      {sections.purchasing && (
        <PurchasingSection
          req={req}
          userEmail={user?.email ?? ''}
          editable={canEditPurchasing(role) && !['closed', 'rejected'].includes(req.status)}
          canApprove={canEditPurchasing(role) && ['submitted', 'under_review'].includes(req.status)}
          onApprove={() => transition('approved', { reviewed_by: user?.email ?? null, reviewed_at: new Date().toISOString() }, '요청을 승인했습니다')}
          onReject={reason => transition('rejected', { reviewed_by: user?.email ?? null, reviewed_at: new Date().toISOString(), rejection_reason: reason }, `요청을 반려했습니다 (${reason})`)}
          onRequestInfo={() => transition('more_info_requested', {}, '추가 정보를 요청했습니다')}
          onSaveOrder={payload => {
            const nextStatus: PurchaseStatus = req.is_customer_chargeback && req.po_required === 'yes' ? 'awaiting_po' : 'awaiting_bookkeeping'
            transition(nextStatus, { ...payload, purchased_by: user?.email ?? null }, '발주 정보를 입력했습니다')
          }}
          onUpdate={update}
        />
      )}

      {sections.poBilling && (
        <PoBillingSection
          req={req}
          editablePo={canEditPo(role) && !['closed', 'rejected'].includes(req.status)}
          onSavePo={(poNumber, notes) => {
            const detail = req.po_number ? `PO 번호를 ${req.po_number} → ${poNumber}로 수정했습니다` : `PO 번호 ${poNumber}를 입력했습니다`
            const payload: Partial<PurchaseRequest> = {
              po_number: poNumber,
              billing_notes: notes,
              po_entered_by: user?.email ?? null,
              po_entered_at: new Date().toISOString(),
            }
            if (req.status === 'awaiting_po') {
              transition('po_received', payload, detail)
            } else {
              update(payload).then(() => { logActivity(req.id, user?.email ?? '', 'po_updated', detail); onChanged() })
            }
          }}
        />
      )}

      {sections.accounting && (
        <AccountingSection
          req={req}
          editable={canEditAccounting(role)}
          onSendToBookkeeping={() => update({ ready_for_bookkeeping: true, ready_for_bookkeeping_at: new Date().toISOString(), sent_to_bookkeeping_at: new Date().toISOString(), sent_to_bookkeeping_by: user?.email ?? null }).then(() => { logActivity(req.id, user?.email ?? '', 'sent_to_bookkeeping', `${user?.email}님이 경리에게 전달했습니다`); onChanged() })}
          onMarkRecorded={() => transition('accounting_recorded', { accounting_recorded: true, accounting_recorded_by: user?.email ?? null, accounting_recorded_at: new Date().toISOString() }, '회계 처리를 완료했습니다')}
          onMarkBilled={() => transition('customer_billed', { customer_billing_status: 'billed', customer_billed_by: user?.email ?? null, customer_billed_at: new Date().toISOString() }, '고객 청구를 완료했습니다')}
          onClose={() => transition('closed', {}, '요청을 종료했습니다')}
        />
      )}
    </div>
  )
}

// ── Purchasing ───────────────────────────────────────────────────────────

function PurchasingSection({ req, userEmail, editable, canApprove, onApprove, onReject, onRequestInfo, onSaveOrder, onUpdate }: {
  req: PurchaseRequest
  userEmail: string
  editable: boolean
  canApprove: boolean
  onApprove: () => void
  onReject: (reason: string) => void
  onRequestInfo: () => void
  onSaveOrder: (payload: Partial<PurchaseRequest>) => void
  onUpdate: (payload: Partial<PurchaseRequest>) => Promise<void>
}) {
  const [form, setForm] = useState<Partial<PurchaseRequest>>(req)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)

  useEffect(() => {
    supabase.from('payment_methods').select('id, company_id, label').eq('company_id', req.company_id).order('label')
      .then(({ data }) => setMethods((data as PaymentMethod[]) ?? []))
  }, [req.company_id])

  function set<K extends keyof PurchaseRequest>(key: K, val: PurchaseRequest[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  const canOrder = editable && (req.status === 'approved' || req.status === 'ordered')

  return (
    <div className="bg-white rounded-2xl border border-line-soft p-6 space-y-4">
      <h2 className="text-sm font-semibold text-ink">구매 처리</h2>

      {canApprove && (
        <div className="flex gap-2">
          <button onClick={onApprove} className="px-3 py-1.5 text-xs text-white bg-ink rounded-lg hover:bg-ink/90">승인</button>
          <button onClick={() => setShowReject(s => !s)} className="px-3 py-1.5 text-xs text-ink-muted border border-line bg-white rounded-lg hover:bg-pill">반려</button>
          <button onClick={onRequestInfo} className="px-3 py-1.5 text-xs text-ink-muted border border-line bg-white rounded-lg hover:bg-pill">추가 정보 요청</button>
        </div>
      )}
      {showReject && (
        <div className="flex gap-2">
          <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="반려 사유" className={inputClass} />
          <button onClick={() => { onReject(rejectReason); setShowReject(false) }} className="px-3 py-1.5 text-xs text-white bg-signal-neg rounded-lg shrink-0">반려 확정</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>업체 (Vendor)</label>
          <input disabled={!editable} value={form.vendor ?? ''} onChange={e => set('vendor', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>실 구매 수량</label>
          <input disabled={!editable} type="number" value={form.actual_quantity ?? ''} onChange={e => set('actual_quantity', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>소계</label>
          <input disabled={!editable} type="number" step="0.01" value={form.subtotal ?? ''} onChange={e => set('subtotal', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>세금</label>
          <input disabled={!editable} type="number" step="0.01" value={form.tax ?? ''} onChange={e => set('tax', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>배송비</label>
          <input disabled={!editable} type="number" step="0.01" value={form.shipping ?? ''} onChange={e => set('shipping', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>합계</label>
          <input disabled={!editable} type="number" step="0.01" value={form.total ?? ''} onChange={e => set('total', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>통화</label>
          <select disabled={!editable} value={form.currency ?? 'CAD'} onChange={e => set('currency', e.target.value as PurchaseRequest['currency'])} className={inputClass}>
            <option value="CAD">CAD</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>사용 카드</label>
          <select disabled={!editable} value={form.payment_method_id ?? ''} onChange={e => set('payment_method_id', e.target.value)} className={inputClass}>
            <option value="">선택</option>
            {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>발주일</label>
          <input disabled={!editable} type="date" value={form.order_date ?? ''} onChange={e => set('order_date', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>주문번호</label>
          <input disabled={!editable} value={form.order_number ?? ''} onChange={e => set('order_number', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>예상 도착일</label>
          <input disabled={!editable} type="date" value={form.expected_delivery_date ?? ''} onChange={e => set('expected_delivery_date', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>실제 도착일</label>
          <input disabled={!editable} type="date" value={form.actual_delivery_date ?? ''} onChange={e => set('actual_delivery_date', e.target.value)} className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>구매 비고</label>
          <textarea disabled={!editable} value={form.purchase_notes ?? ''} onChange={e => set('purchase_notes', e.target.value)} className={inputClass} rows={2} />
        </div>
      </div>

      <AttachmentUploader
        purchaseRequestId={req.id}
        fileType="receipt"
        label="영수증 / 인보이스"
        editable={editable}
        uploadedBy={userEmail}
      />

      {editable && (
        <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
          <button onClick={() => onUpdate(form)} className="px-3 py-1.5 text-sm text-ink-muted border border-line bg-white rounded-lg hover:bg-pill">저장</button>
          {canOrder && (
            <button onClick={() => onSaveOrder(form)} className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90">
              발주 완료로 표시
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── PO / Billing ─────────────────────────────────────────────────────────

function PoBillingSection({ req, editablePo, onSavePo }: {
  req: PurchaseRequest
  editablePo: boolean
  onSavePo: (poNumber: string, notes: string) => void
}) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [poNumber, setPoNumber] = useState(req.po_number ?? '')
  const [notes, setNotes] = useState(req.billing_notes ?? '')

  useEffect(() => {
    if (!req.customer_id) return
    supabase.from('customers').select('*').eq('id', req.customer_id).maybeSingle()
      .then(({ data }) => setCustomer((data as Customer) ?? null))
  }, [req.customer_id])

  return (
    <div className="bg-white rounded-2xl border border-line-soft p-6 space-y-4">
      <h2 className="text-sm font-semibold text-ink">고객 청구 / PO</h2>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className={labelClass}>고객</div>
          <div className="text-ink">{customer?.name ?? '-'}</div>
        </div>
        <div>
          <div className={labelClass}>PO 필요 여부</div>
          <div className="text-ink">{req.po_required === 'yes' ? '필요' : req.po_required === 'no' ? '불필요' : '모름'}</div>
        </div>
      </div>

      {req.po_required === 'yes' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>PO 번호</label>
            <input disabled={!editablePo} value={poNumber} onChange={e => setPoNumber(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>비고</label>
            <input disabled={!editablePo} value={notes} onChange={e => setNotes(e.target.value)} className={inputClass} />
          </div>
          {req.po_entered_by && (
            <p className="col-span-2 text-xs text-ink-faint">
              {req.po_entered_by}님이 입력함 ({req.po_entered_at ? new Date(req.po_entered_at).toLocaleString('ko-KR') : ''})
            </p>
          )}
          {editablePo && (
            <div className="col-span-2 flex justify-end">
              <button
                onClick={() => onSavePo(poNumber, notes)}
                disabled={!poNumber.trim()}
                className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint"
              >
                PO 저장
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Accounting ───────────────────────────────────────────────────────────

function AccountingSection({ req, editable, onSendToBookkeeping, onMarkRecorded, onMarkBilled, onClose }: {
  req: PurchaseRequest
  editable: boolean
  onSendToBookkeeping: () => void
  onMarkRecorded: () => void
  onMarkBilled: () => void
  onClose: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-line-soft p-6 space-y-4">
      <h2 className="text-sm font-semibold text-ink">경리 / 회계</h2>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <StatusRow label="경리 전달" done={!!req.sent_to_bookkeeping_at} detail={req.sent_to_bookkeeping_by} at={req.sent_to_bookkeeping_at} />
        <StatusRow label="회계 처리 완료" done={req.accounting_recorded} detail={req.accounting_recorded_by} at={req.accounting_recorded_at} />
        {req.is_customer_chargeback && (
          <StatusRow label="고객 청구 완료" done={req.customer_billing_status === 'billed'} detail={req.customer_billed_by} at={req.customer_billed_at} />
        )}
      </div>

      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
          {req.status === 'po_received' || req.status === 'ordered' ? (
            <SendToBookkeepingButton req={req} onSent={onSendToBookkeeping} />
          ) : null}
          {req.status === 'awaiting_bookkeeping' && (
            <button onClick={onMarkRecorded} className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90">
              회계 처리 완료로 표시
            </button>
          )}
          {req.status === 'accounting_recorded' && req.is_customer_chargeback && (
            <button onClick={onMarkBilled} className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90">
              고객 청구 완료로 표시
            </button>
          )}
          {(req.status === 'accounting_recorded' && !req.is_customer_chargeback) || req.status === 'customer_billed' ? (
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-ink-muted border border-line bg-white rounded-lg hover:bg-pill">
              요청 종료
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function StatusRow({ label, done, detail, at }: { label: string; done: boolean; detail: string | null; at: string | null }) {
  return (
    <div>
      <div className={labelClass}>{label}</div>
      <div className={done ? 'text-signal-pos font-medium' : 'text-ink-faint'}>
        {done ? '완료' : '대기 중'}
      </div>
      {done && detail && (
        <p className="text-xs text-ink-faint">{detail} · {at ? new Date(at).toLocaleString('ko-KR') : ''}</p>
      )}
    </div>
  )
}
