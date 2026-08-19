'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'
import RequestForm, { type DraftRequest } from '@/components/RequestForm'
import { missingRequiredFields } from '@/lib/purchaseRequestStatus'
import { logActivity } from '@/lib/activity'
import type { Category, CompanyId } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const COMPANIES: { id: CompanyId; label: string }[] = [
  { id: 'afs', label: 'AFS' },
  { id: 'tnt', label: 'TNT' },
  { id: 'zfs', label: 'ZFS' },
]

export default function NewRequestPage() {
  const router = useRouter()
  const { user, locale } = useAuth()
  const [companyId, setCompanyId] = useState<CompanyId>('afs')
  const [draft, setDraft] = useState<DraftRequest>({ is_customer_chargeback: false, po_required: 'unknown', currency: 'CAD' })
  const [showValidation, setShowValidation] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function patch(p: DraftRequest) {
    setDraft(d => ({ ...d, ...p }))
  }

  async function saveDraft() {
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('purchase_requests')
      .insert({ ...draft, company_id: companyId, requested_by_email: user?.email, status: 'draft' })
      .select('id')
      .single()
    setSaving(false)
    if (err || !data) {
      setError(err?.message ?? (locale === 'ko' ? '저장에 실패했습니다.' : 'Failed to save draft.'))
      return
    }
    await logActivity(data.id, user?.email ?? '', 'draft_created', locale === 'ko' ? '임시저장으로 요청서 생성' : 'Created request as draft')
    router.push(`/requests/${data.id}`)
  }

  async function submit() {
    setShowValidation(true)
    let category: Category | null = null
    if (draft.category_id) {
      const { data } = await supabase.from('purchase_categories').select('*').eq('id', draft.category_id).single()
      category = (data as Category) ?? null
    }
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
    if (errors.length) {
      setError(errors[0])
      return
    }

    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('purchase_requests')
      .insert({
        ...draft,
        company_id: companyId,
        requested_by_email: user?.email,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    setSaving(false)
    if (err || !data) {
      setError(err?.message ?? (locale === 'ko' ? '제출에 실패했습니다.' : 'Failed to submit request.'))
      return
    }
    await logActivity(data.id, user?.email ?? '', 'submitted', locale === 'ko' ? `${user?.email}님이 요청서를 제출했습니다` : `${user?.email} submitted the request`)
    router.push(`/requests/${data.id}`)
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-ink mb-1">{locale === 'ko' ? '새 구매 요청 작성' : 'Create a New Purchase Request'}</h1>
      <p className="text-sm text-ink-faint mb-6">
        {locale === 'ko' ? '필요한 정보를 최대한 자세히 입력하면 처리 속도가 빨라집니다.' : 'Add as much detail as you can to help the team process this faster.'}
      </p>

      <div className="bg-white rounded-2xl border border-line-soft p-6 space-y-6">
        <div>
          <label className="block text-xs font-semibold text-ink-muted mb-1">{locale === 'ko' ? '회사' : 'Company'}</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value as CompanyId)} className="w-40 border border-line rounded-lg px-3 py-2 text-sm">
            {COMPANIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <RequestForm value={draft} onChange={patch} companyId={companyId} showValidation={showValidation} />

        {error && (
          <div className="bg-red-50 border border-red-200 text-signal-neg text-sm rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
          <button
            onClick={saveDraft}
            disabled={saving}
            className="px-4 py-2 text-sm text-ink-muted border border-line bg-white rounded-lg hover:bg-pill transition-colors"
          >
            {locale === 'ko' ? '임시저장' : 'Save Draft'}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint transition-colors"
          >
            {saving ? (locale === 'ko' ? '처리 중…' : 'Working...') : (locale === 'ko' ? '제출' : 'Submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
