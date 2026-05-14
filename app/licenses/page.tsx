'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type License = {
  id: string
  account_id: string
  display_name: string | null
  email_address: string | null
  account_type: string
  license_plan: string | null
  monthly_cost_cad: number
  status: string
  company: string | null
  employees: { name: string } | null
}

export default function LicensesPage() {
  const [rows, setRows] = useState<License[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('licenses')
      .select('id,account_id,display_name,email_address,account_type,license_plan,monthly_cost_cad,status,company,employees(name)')
      .order('company', { ascending: true })
      .then(({ data }) => {
        setRows((data as License[]) ?? [])
        setLoading(false)
      })
  }, [])

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    return !q || [r.display_name, r.email_address, r.account_id, r.employees?.name]
      .some(v => v?.toLowerCase().includes(q))
  })

  const totalCost = rows
    .filter(r => r.account_type === 'Individual' && r.status === 'Active')
    .reduce((s, r) => s + (r.monthly_cost_cad ?? 0), 0)

  const statusBadge = (s: string) => {
    const cls = s === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{s}</span>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">M365 Email Subscriptions</h1>
          <p className="text-sm text-gray-500 mt-0.5">월 총 비용 (Active Individual): <span className="font-semibold text-indigo-700">${totalCost.toFixed(2)} CAD</span></p>
        </div>
        <input
          className="border rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="이름 / 이메일 검색…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Account ID</th>
                <th className="px-4 py-3 text-left">Display Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Linked Employee</th>
                <th className="px-4 py-3 text-right">월 비용</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.account_id}</td>
                  <td className="px-4 py-2 font-medium text-gray-800">{r.display_name ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{r.email_address ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.account_type === 'Shared' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {r.account_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600 text-xs">{r.license_plan ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{r.company ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{r.employees?.name ?? <span className="text-gray-300">미연결</span>}</td>
                  <td className="px-4 py-2 text-right font-medium">
                    {r.account_type === 'Individual' ? `$${r.monthly_cost_cad.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2">{statusBadge(r.status)}</td>
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
