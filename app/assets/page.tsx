'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Asset = {
  id: string
  asset_id: string
  category: string | null
  item_name: string | null
  brand: string | null
  model: string | null
  serial_number: string | null
  purchase_date: string | null
  purchase_price: number | null
  vendor: string | null
  warranty_end: string | null
  condition: string
  location: string | null
  notes: string | null
  employees: { name: string } | null
}

const CONDITION_COLORS: Record<string, string> = {
  'In Use':    'bg-green-100 text-green-700',
  'Storage':   'bg-yellow-100 text-yellow-700',
  'Retired':   'bg-gray-100 text-gray-500',
  'Repair':    'bg-red-100 text-red-700',
}

export default function AssetsPage() {
  const [rows, setRows] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')

  useEffect(() => {
    supabase
      .from('assets')
      .select('id,asset_id,category,item_name,brand,model,serial_number,purchase_date,purchase_price,vendor,warranty_end,condition,location,notes,employees(name)')
      .order('category')
      .then(({ data }) => {
        setRows((data as Asset[]) ?? [])
        setLoading(false)
      })
  }, [])

  const cats = Array.from(new Set(rows.map(r => r.category).filter(Boolean))) as string[]

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || [r.item_name, r.brand, r.model, r.asset_id, r.employees?.name, r.serial_number]
      .some(v => v?.toLowerCase().includes(q))
    const matchCat = !catFilter || r.category === catFilter
    return matchSearch && matchCat
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">IT Assets</h1>
          <p className="text-sm text-gray-500 mt-0.5">총 {rows.length}건</p>
        </div>
        <div className="flex gap-2">
          <select
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
          >
            <option value="">전체 카테고리</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            className="border rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="이름 / 모델 검색…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Asset ID</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-left">Brand / Model</th>
                <th className="px-4 py-3 text-left">Serial</th>
                <th className="px-4 py-3 text-left">Assigned To</th>
                <th className="px-4 py-3 text-left">구입일</th>
                <th className="px-4 py-3 text-right">구입가</th>
                <th className="px-4 py-3 text-left">보증 만료</th>
                <th className="px-4 py-3 text-left">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.asset_id}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{r.category ?? '—'}</td>
                  <td className="px-4 py-2 font-medium text-gray-800">{r.item_name ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{[r.brand, r.model].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.serial_number ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{r.employees?.name ?? <span className="text-gray-300">미배정</span>}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{r.purchase_date ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{r.purchase_price != null ? `$${r.purchase_price.toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{r.warranty_end ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONDITION_COLORS[r.condition] ?? 'bg-gray-100 text-gray-500'}`}>
                      {r.condition}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-center text-gray-400 py-8 text-sm">결과 없음</p>
          )}
        </div>
      )}
    </div>
  )
}
