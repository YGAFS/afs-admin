'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState, Suspense, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useSearchParams } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

type Company = 'afs' | 'tnt' | 'zfs'
type Role = 'admin' | 'ap'

interface Vendor {
  id: string
  company_id: Company
  name: string
  service_type: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  contract_start: string | null
  contract_end: string | null
  onedrive_url: string | null
  notes: string | null
}

const emptyVendor: Omit<Vendor, 'id'> = {
  company_id: 'afs', name: '', service_type: '', contact_name: '',
  contact_email: '', contact_phone: '', contract_start: '', contract_end: '',
  onedrive_url: '', notes: '',
}

const CO_COLORS: Record<Company, string> = {
  afs: 'bg-blue-100 text-blue-700',
  tnt: 'bg-amber-100 text-amber-700',
  zfs: 'bg-emerald-100 text-emerald-700',
}

function fmtShortDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function VendorsContent() {
  const searchParams = useSearchParams()
  const urlCompany   = searchParams.get('company') as Company | null

  const [vendors,    setVendors]    = useState<Vendor[]>([])
  const [loading,    setLoading]    = useState(true)
  const [coFilter,   setCoFilter]   = useState<Company | 'all'>(urlCompany ?? 'all')
  const [search,     setSearch]     = useState('')
  const [showModal,  setShowModal]  = useState(false)
  const [form,       setForm]       = useState<Omit<Vendor, 'id'>>(emptyVendor)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [role,       setRole]       = useState<Role>('admin')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('utility_vendors').select('*').order('name')
    setVendors((data as Vendor[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (urlCompany) setCoFilter(urlCompany) }, [urlCompany])

  const filtered = useMemo(() => vendors.filter(v => {
    if (coFilter !== 'all' && v.company_id !== coFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return v.name.toLowerCase().includes(q) ||
        (v.service_type ?? '').toLowerCase().includes(q) ||
        (v.contact_name ?? '').toLowerCase().includes(q)
    }
    return true
  }), [vendors, coFilter, search])

  function openAdd() { setForm(emptyVendor); setEditId(null); setShowModal(true) }
  function openEdit(v: Vendor) { const { id, ...rest } = v; setForm(rest); setEditId(id); setShowModal(true) }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    if (editId) await supabase.from('utility_vendors').update(form).eq('id', editId)
    else await supabase.from('utility_vendors').insert(form)
    setSaving(false); setShowModal(false); load()
  }

  async function del(id: string) {
    await supabase.from('utility_vendors').delete().eq('id', id)
    setDelConfirm(null); load()
  }

  return (
    <div className="p-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {(['all', 'afs', 'tnt', 'zfs'] as (Company | 'all')[]).map(c => (
            <button
              key={c}
              onClick={() => setCoFilter(c)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                coFilter === c ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {c === 'all' ? 'All' : c.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search vendors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        {role === 'admin' && (
          <button
            onClick={openAdd}
            className="px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors"
          >
            + Add Vendor
          </button>
        )}
      </div>

      {/* Vendor table */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="h-14 bg-white rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm">No vendors found.</p>
          {role === 'admin' && (
            <button onClick={openAdd} className="mt-3 px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors">
              + Add First Vendor
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contract</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contract Doc</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(v => (
                <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{v.name}</p>
                    {v.notes && <p className="text-xs text-gray-400 truncate max-w-[200px]">{v.notes}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CO_COLORS[v.company_id]}`}>
                      {v.company_id.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{v.service_type ?? '—'}</td>
                  <td className="px-4 py-3">
                    {v.contact_email && (
                      <a href={`mailto:${v.contact_email}`} className="text-blue-600 hover:underline text-xs block">{v.contact_email}</a>
                    )}
                    {v.contact_phone && <span className="text-xs text-gray-500">{v.contact_phone}</span>}
                    {!v.contact_email && !v.contact_phone && <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {v.contract_start || v.contract_end
                      ? `${fmtShortDate(v.contract_start)} → ${v.contract_end ? fmtShortDate(v.contract_end) : 'ongoing'}`
                      : '—'
                    }
                  </td>
                  <td className="px-4 py-3">
                    {v.onedrive_url ? (
                      <a
                        href={v.onedrive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        ☁️ View
                      </a>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {role === 'admin' && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(v)} className="text-xs text-gray-500 hover:text-gray-800 transition-colors">Edit</button>
                        {delConfirm === v.id ? (
                          <div className="flex gap-1">
                            <button onClick={() => del(v.id)} className="text-xs text-red-600 hover:text-red-800 font-medium">Confirm</button>
                            <button onClick={() => setDelConfirm(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setDelConfirm(v.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Delete</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
            Showing {filtered.length} of {vendors.length} vendors
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editId ? 'Edit Vendor' : 'Add Vendor'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Company *</label>
                <div className="flex gap-2">
                  {(['afs', 'tnt', 'zfs'] as Company[]).map(c => (
                    <button key={c} onClick={() => setForm(f => ({ ...f, company_id: c }))}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        form.company_id === c ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>{c.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Vendor Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. BC Hydro"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Service Type</label>
                <input type="text" value={form.service_type ?? ''} onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}
                  placeholder="e.g. Electricity, Gas, Internet"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Contact Name</label>
                  <input type="text" value={form.contact_name ?? ''} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                  <input type="text" value={form.contact_phone ?? ''} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Contact Email</label>
                <input type="email" value={form.contact_email ?? ''} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Contract Start</label>
                  <input type="date" value={form.contract_start ?? ''} onChange={e => setForm(f => ({ ...f, contract_start: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Contract End</label>
                  <input type="date" value={form.contract_end ?? ''} onChange={e => setForm(f => ({ ...f, contract_end: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">OneDrive Contract URL</label>
                <input type="url" value={form.onedrive_url ?? ''} onChange={e => setForm(f => ({ ...f, onedrive_url: e.target.value }))}
                  placeholder="https://onedrive.live.com/…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                <textarea rows={2} value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving || !form.name.trim()} className="flex-1 px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function VendorsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">Loading…</div>}>
      <VendorsContent />
    </Suspense>
  )
}
