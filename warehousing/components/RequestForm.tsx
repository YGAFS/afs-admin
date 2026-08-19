'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { Category, Customer, Location, PurchaseRequest } from '@/lib/types'
import { missingRequiredFields } from '@/lib/purchaseRequestStatus'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

export type DraftRequest = Partial<PurchaseRequest>

interface Props {
  value: DraftRequest
  onChange: (patch: DraftRequest) => void
  companyId: 'afs' | 'tnt' | 'zfs'
  readOnly?: boolean
  showValidation?: boolean
}

const UNIT_OPTIONS = ['ea', 'box', 'case', 'pack', 'roll', 'pallet', 'other']

export default function RequestForm({ value, onChange, companyId, readOnly, showValidation }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [locations, setLocations] = useState<Location[]>([])

  useEffect(() => {
    supabase.from('purchase_categories').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => setCategories((data as Category[]) ?? []))
    supabase.from('utility_locations').select('id, company_id, name, region, city, address').eq('company_id', companyId).order('sort_order')
      .then(({ data }) => setLocations((data as Location[]) ?? []))
  }, [companyId])

  useEffect(() => {
    if (!value.is_customer_chargeback) return
    supabase.from('customers').select('*').eq('company_id', companyId).eq('is_active', true).order('name')
      .then(({ data }) => setCustomers((data as Customer[]) ?? []))
  }, [companyId, value.is_customer_chargeback])

  const category = categories.find(c => c.id === value.category_id) ?? null
  const { errors, warnings } = missingRequiredFields(
    {
      item_name: value.item_name ?? '',
      quantity: value.quantity ?? null,
      sku: value.sku ?? null,
      product_url: value.product_url ?? null,
      specifications: value.specifications ?? null,
      is_customer_chargeback: !!value.is_customer_chargeback,
      customer_id: value.customer_id ?? null,
      po_required: value.po_required ?? 'unknown',
    },
    category
  )

  function set<K extends keyof PurchaseRequest>(key: K, val: PurchaseRequest[K]) {
    onChange({ [key]: val } as DraftRequest)
  }

  const inputClass = 'w-full border border-line rounded-lg px-3 py-2 text-sm disabled:bg-pill disabled:text-ink-faint'
  const labelClass = 'block text-xs font-semibold text-ink-muted mb-1'

  return (
    <div className="space-y-6">
      {showValidation && errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-sm text-signal-neg">{e}</p>
          ))}
        </div>
      )}
      {showValidation && warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-700">{w}</p>
          ))}
        </div>
      )}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-ink">요청 정보</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelClass}>품목명 *</label>
            <input disabled={readOnly} value={value.item_name ?? ''} onChange={e => set('item_name', e.target.value)} className={inputClass} placeholder="예: Zebra 4x6 감열 라벨" />
          </div>

          <div className="col-span-2">
            <label className={labelClass}>카테고리 *</label>
            <select disabled={readOnly} value={value.category_id ?? ''} onChange={e => set('category_id', e.target.value)} className={inputClass}>
              <option value="">선택하세요</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.requires_identifier ? ' (SKU/URL 필수)' : ''}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className={labelClass}>설명</label>
            <textarea disabled={readOnly} value={value.description ?? ''} onChange={e => set('description', e.target.value)} className={inputClass} rows={2} />
          </div>

          <div>
            <label className={labelClass}>수량 *</label>
            <input disabled={readOnly} type="number" min={0} value={value.quantity ?? ''} onChange={e => set('quantity', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>단위</label>
            <select disabled={readOnly} value={value.unit_type ?? ''} onChange={e => set('unit_type', e.target.value)} className={inputClass}>
              <option value="">선택</option>
              {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          <div>
            <label className={labelClass}>SKU / 품번</label>
            <input disabled={readOnly} value={value.sku ?? ''} onChange={e => set('sku', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>상품 URL</label>
            <input disabled={readOnly} type="url" value={value.product_url ?? ''} onChange={e => set('product_url', e.target.value)} className={inputClass} placeholder="https://…" />
          </div>

          <div className="col-span-2">
            <label className={labelClass}>사양 (Specifications)</label>
            <textarea disabled={readOnly} value={value.specifications ?? ''} onChange={e => set('specifications', e.target.value)} className={inputClass} rows={2} placeholder="크기, 색상, 규격 등 구체적으로 작성하세요" />
          </div>

          <div>
            <label className={labelClass}>선호 업체</label>
            <input disabled={readOnly} value={value.preferred_vendor ?? ''} onChange={e => set('preferred_vendor', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>예상 금액</label>
            <input disabled={readOnly} type="number" min={0} step="0.01" value={value.estimated_price ?? ''} onChange={e => set('estimated_price', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>필요 날짜</label>
            <input disabled={readOnly} type="date" value={value.needed_by_date ?? ''} onChange={e => set('needed_by_date', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>수령 방법</label>
            <select disabled={readOnly} value={value.delivery_method ?? ''} onChange={e => set('delivery_method', e.target.value as PurchaseRequest['delivery_method'])} className={inputClass}>
              <option value="">선택</option>
              <option value="delivery">배송</option>
              <option value="pickup">직접 수령</option>
              <option value="other">기타</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className={labelClass}>배송지 / 창고</label>
            <select disabled={readOnly} value={value.delivery_location_id ?? ''} onChange={e => set('delivery_location_id', e.target.value)} className={inputClass}>
              <option value="">선택</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div className="col-span-2">
            <label className={labelClass}>사유</label>
            <textarea disabled={readOnly} value={value.business_reason ?? ''} onChange={e => set('business_reason', e.target.value)} className={inputClass} rows={2} />
          </div>

          <div className="col-span-2">
            <label className={labelClass}>비고</label>
            <textarea disabled={readOnly} value={value.notes ?? ''} onChange={e => set('notes', e.target.value)} className={inputClass} rows={2} />
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-line-soft pt-4">
        <h3 className="text-sm font-semibold text-ink">고객 청구</h3>
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input
            disabled={readOnly}
            type="checkbox"
            checked={!!value.is_customer_chargeback}
            onChange={e => onChange({ is_customer_chargeback: e.target.checked, customer_id: e.target.checked ? value.customer_id : null })}
            className="w-4 h-4 accent-ink"
          />
          이 구매 건은 고객에게 청구됩니다
        </label>

        {value.is_customer_chargeback && (
          <div className="grid grid-cols-2 gap-4 pl-6">
            <div className="col-span-2">
              <label className={labelClass}>고객 *</label>
              <select disabled={readOnly} value={value.customer_id ?? ''} onChange={e => set('customer_id', e.target.value)} className={inputClass}>
                <option value="">선택하세요</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>PO 필요 여부</label>
              <select disabled={readOnly} value={value.po_required ?? 'unknown'} onChange={e => set('po_required', e.target.value as PurchaseRequest['po_required'])} className={inputClass}>
                <option value="unknown">모름</option>
                <option value="yes">필요</option>
                <option value="no">불필요</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelClass}>청구 관련 비고</label>
              <textarea disabled={readOnly} value={value.billing_notes ?? ''} onChange={e => set('billing_notes', e.target.value)} className={inputClass} rows={2} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
