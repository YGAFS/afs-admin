'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'
import RequestForm, { type DraftRequest } from '@/components/RequestForm'
import ActivityLog from '@/components/ActivityLog'
import RequestDetailSections from '@/components/RequestDetailSections'
import AttachmentUploader from '@/components/AttachmentUploader'
import { STATUS_BADGE, computeNextAction, missingRequiredFields, isBlocked } from '@/lib/purchaseRequestStatus'
import { canEditRequestDetails, visibleSections } from '@/lib/purchaseRequestAccess'
import { logActivity } from '@/lib/activity'
import type { Category, PurchaseRequest } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

export default function RequestDetailPage() {
  const { id } = useParams() as { id: string }
  const { user, role } = useAuth()
  const [req, setReq] = useState<PurchaseRequest | null>(null)
  const [category, setCategory] = useState<Category | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [draft, setDraft] = useState<DraftRequest>({})
  const [showValidation, setShowValidation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activityKey, setActivityKey] = useState(0)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('purchase_requests').select('*').eq('id', id).maybeSingle()
    if (!data) { setNotFound(true); setLoading(false); return }
    const pr = data as PurchaseRequest
    setReq(pr)
    setDraft(pr)
    if (pr.category_id) {
      const { data: cat } = await supabase.from('purchase_categories').select('*').eq('id', pr.category_id).maybeSingle()
      setCategory((cat as Category) ?? null)
    }
    setLoading(false)
  }

  if (loading) return <div className="p-8 text-sm text-ink-faint">불러오는 중…</div>
  if (notFound || !req || !role || role === 'none') return <div className="p-8 text-sm text-ink-muted">요청을 찾을 수 없습니다.</div>

  const sections = visibleSections(role, req)
  const isOwner = req.requested_by_email === user?.email
  const canEditDetails = canEditRequestDetails(role, req, user?.email ?? null)

  // A requester may only look at their own requests — everything else on
  // this page is empty/blank for them if they try another id directly.
  if (role === 'requester' && !isOwner) {
    return <div className="p-8 text-sm text-ink-muted">본인이 작성한 요청만 볼 수 있습니다.</div>
  }

  const nextAction = computeNextAction(req)
  const badge = STATUS_BADGE[req.status]

  async function saveRequestDetails() {
    setShowValidation(true)
    const { errors } = missingRequiredFields(
      {
        item_name: draft.item_name ?? '',
        quantity: draft.quantity ?? null,
        sku: draft.sku ?? null,
        product_url: draft.product_url ?? null,
        specifications: draft.specifications ?? null,
        is_customer_chargeback: !!draft.is_customer_chargeback,
        customer_id: draft.customer_id ?? null,
        po_required: draft.po_required ?? 'unknown',
      },
      category
    )
    if (req!.status !== 'draft' && errors.length) { setError(errors[0]); return }

    setError(null)
    await supabase.from('purchase_requests').update(draft).eq('id', id)
    load()
  }

  async function resubmit() {
    const blockedReason = isBlocked({ ...req!, ...draft } as PurchaseRequest, 'submitted', category)
    if (blockedReason) { setShowValidation(true); setError(blockedReason); return }
    setError(null)
    await supabase.from('purchase_requests').update({ ...draft, status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', id)
    await logActivity(id, user?.email ?? '', 'resubmitted', `${user?.email}님이 추가 정보를 입력하고 재제출했습니다`)
    setActivityKey(k => k + 1)
    load()
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono text-ink-faint">{req.request_number}</span>
          <span className={`text-xs ${badge.className}`}>{badge.label}</span>
        </div>
        <h1 className="text-xl font-bold text-ink">{req.item_name}</h1>
        <p className="text-sm text-ink-muted mt-1">
          {req.requested_by_email} · {req.company_id.toUpperCase()}
          {req.needed_by_date && ` · 필요일 ${req.needed_by_date}`}
        </p>
      </div>

      {nextAction && (
        <div className="bg-pill rounded-lg px-4 py-3 text-sm text-ink">
          <span className="font-semibold">다음 단계:</span> {nextAction.label}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-signal-neg text-sm rounded-lg px-3 py-2">{error}</div>
      )}

      {sections.requestDetails && (
        <div className="bg-white rounded-2xl border border-line-soft p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">요청 상세</h2>
            {canEditDetails && (
              <button onClick={saveRequestDetails} className="text-xs text-white bg-ink px-3 py-1.5 rounded-lg hover:bg-ink/90">
                변경사항 저장
              </button>
            )}
          </div>
          <RequestForm
            value={draft}
            onChange={p => setDraft(d => ({ ...d, ...p }))}
            companyId={req.company_id}
            readOnly={!canEditDetails}
            showValidation={showValidation}
          />
          <AttachmentUploader
            purchaseRequestId={req.id}
            fileType="photo"
            label="사진 / 참고 파일"
            editable={canEditDetails}
            uploadedBy={user?.email ?? ''}
          />
          {canEditDetails && req.status === 'more_info_requested' && (
            <div className="flex justify-end border-t border-line-soft pt-4">
              <button onClick={resubmit} className="px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90">
                재제출
              </button>
            </div>
          )}
        </div>
      )}

      <RequestDetailSections req={req} category={category} role={role} onChanged={() => { load(); setActivityKey(k => k + 1) }} />

      <div className="bg-white rounded-2xl border border-line-soft p-6">
        <ActivityLog purchaseRequestId={id} refreshKey={activityKey} />
      </div>
    </div>
  )
}
