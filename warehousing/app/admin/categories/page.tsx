'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

interface Category {
  id: string
  name: string
  requires_identifier: boolean
  is_active: boolean
  sort_order: number
}

const emptyCategory: Partial<Category> = { name: '', requires_identifier: false, is_active: true, sort_order: 0 }

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editCat, setEditCat] = useState<Partial<Category>>(emptyCategory)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('purchase_categories').select('*').order('sort_order')
    setCategories((data as Category[]) ?? [])
    setLoading(false)
  }

  function openAdd() {
    setEditCat({ ...emptyCategory, sort_order: categories.length + 1 })
    setEditingId(null)
    setShowModal(true)
  }

  function openEdit(c: Category) {
    setEditCat(c)
    setEditingId(c.id)
    setShowModal(true)
  }

  async function saveCategory() {
    if (!editCat.name?.trim()) return
    setSaving(true)
    const payload = {
      name: editCat.name.trim(),
      requires_identifier: !!editCat.requires_identifier,
      is_active: editCat.is_active ?? true,
      sort_order: editCat.sort_order ?? 0,
    }
    if (editingId) {
      await supabase.from('purchase_categories').update(payload).eq('id', editingId)
    } else {
      await supabase.from('purchase_categories').insert(payload)
    }
    setSaving(false)
    setShowModal(false)
    load()
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-ink">구매 카테고리</h1>
        <button
          onClick={openAdd}
          className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 transition-colors"
        >
          + 카테고리 추가
        </button>
      </div>
      <p className="text-sm text-ink-faint mb-6">
        &quot;식별정보 필요&quot;가 켜진 카테고리는 요청서 제출 시 SKU 또는 상품 URL 중 하나가 반드시 있어야 합니다.
      </p>

      <div className="bg-white rounded-xl border border-line-soft overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-ink-faint">불러오는 중…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-ink-faint uppercase tracking-wide">
                <th className="px-4 py-2">이름</th>
                <th className="px-4 py-2">식별정보 필요</th>
                <th className="px-4 py-2">사용 중</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map(c => (
                <tr key={c.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 text-ink">{c.name}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{c.requires_identifier ? '필요' : '-'}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{c.is_active ? '사용 중' : '비활성'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => openEdit(c)} className="text-xs text-ink-muted hover:text-ink underline">
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">{editingId ? '카테고리 수정' : '카테고리 추가'}</h2>
              <button onClick={() => setShowModal(false)} className="text-ink-faint hover:text-ink">✕</button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">이름</label>
              <input
                value={editCat.name ?? ''}
                onChange={e => setEditCat(c => ({ ...c, name: e.target.value }))}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={!!editCat.requires_identifier}
                onChange={e => setEditCat(c => ({ ...c, requires_identifier: e.target.checked }))}
                className="w-4 h-4 accent-ink"
              />
              SKU 또는 상품 URL 필수 (Warehouse Supplies, Equipment 등)
            </label>

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={editCat.is_active ?? true}
                onChange={e => setEditCat(c => ({ ...c, is_active: e.target.checked }))}
                className="w-4 h-4 accent-ink"
              />
              사용 중 (새 요청서 작성 시 선택 가능)
            </label>

            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">정렬 순서</label>
              <input
                type="number"
                value={editCat.sort_order ?? 0}
                onChange={e => setEditCat(c => ({ ...c, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-24 border border-line rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-sm text-ink-muted border border-line bg-white rounded-lg hover:bg-pill transition-colors"
              >
                취소
              </button>
              <button
                onClick={saveCategory}
                disabled={saving}
                className="px-3 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint transition-colors"
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
