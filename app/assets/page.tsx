'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Asset = {
  id: string
  asset_id: string
  company: string | null
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
  employee_id: string | null
  employees: { name: string }[] | null
}

type Employee = { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPANIES = ['AFS', 'TNT', 'ZFS']
const CONDITIONS = ['In Use', 'Storage', 'Retired', 'Repair'] as const
const CONDITION_COLORS: Record<string, string> = {
  'In Use':  'bg-green-100 text-green-700',
  'Storage': 'bg-yellow-100 text-yellow-700',
  'Retired': 'bg-gray-100 text-gray-500',
  'Repair':  'bg-red-100 text-red-700',
}
const CONDITION_BAR_COLORS: Record<string, string> = {
  'In Use':  'bg-green-400',
  'Storage': 'bg-yellow-400',
  'Retired': 'bg-gray-300',
  'Repair':  'bg-red-400',
}
const CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Phone', 'Tablet', 'Printer', 'Server', 'Network', 'Peripheral', 'Other']

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300'
const selectCls = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white'

function DeleteDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { locale } = useLocale()
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-80">
        <p className="text-gray-800 font-medium mb-1">{t('common.delete_confirm', locale)}</p>
        <p className="text-gray-500 text-sm mb-5">{t('common.delete_warning', locale)}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.cancel', locale)}</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">{t('common.delete', locale)}</button>
        </div>
      </div>
    </div>
  )
}

// ── Asset Modal ───────────────────────────────────────────────────────────────

type AssetForm = {
  asset_id: string; company: string; category: string; item_name: string
  brand: string; model: string; serial_number: string; purchase_date: string
  purchase_price: string; vendor: string; warranty_end: string
  condition: string; location: string; employee_id: string; notes: string
}

const emptyAssetForm: AssetForm = {
  asset_id: '', company: '', category: '', item_name: '',
  brand: '', model: '', serial_number: '', purchase_date: '',
  purchase_price: '', vendor: '', warranty_end: '',
  condition: 'In Use', location: '', employee_id: '', notes: '',
}

function AssetModal({ initial, clone, employees, onClose, onSave }: {
  initial?: Asset; clone?: Asset; employees: Employee[]; onClose: () => void; onSave: () => void
}) {
  const { locale } = useLocale()
  const src = initial ?? clone
  const [form, setForm] = useState<AssetForm>(src ? {
    asset_id: initial ? (src.asset_id ?? '') : '',
    company: src.company ?? '',
    category: src.category ?? '',
    item_name: src.item_name ?? '',
    brand: src.brand ?? '',
    model: src.model ?? '',
    serial_number: initial ? (src.serial_number ?? '') : '',
    purchase_date: src.purchase_date ?? '',
    purchase_price: src.purchase_price != null ? String(src.purchase_price) : '',
    vendor: src.vendor ?? '',
    warranty_end: src.warranty_end ?? '',
    condition: src.condition ?? 'In Use',
    location: src.location ?? '',
    employee_id: src.employee_id ?? '',
    notes: src.notes ?? '',
  } : emptyAssetForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof AssetForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleSubmit() {
    if (!form.asset_id.trim()) { setError(t('assets.form.asset_id_req', locale)); return }
    if (!form.item_name.trim()) { setError(t('assets.form.item_name_req', locale)); return }
    setSaving(true)
    const payload = {
      asset_id: form.asset_id.trim(),
      company: form.company || null,
      category: form.category || null,
      item_name: form.item_name.trim(),
      brand: form.brand || null,
      model: form.model || null,
      serial_number: form.serial_number || null,
      purchase_date: form.purchase_date || null,
      purchase_price: form.purchase_price !== '' ? parseFloat(form.purchase_price) : null,
      vendor: form.vendor || null,
      warranty_end: form.warranty_end || null,
      condition: form.condition,
      location: form.location || null,
      employee_id: form.employee_id || null,
      notes: form.notes || null,
    }
    const { error: err } = initial
      ? await supabase.from('assets').update(payload).eq('id', initial.id)
      : await supabase.from('assets').insert(payload)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSave()
  }

  const title = initial
    ? t('assets.modal.edit', locale)
    : clone
      ? t('assets.modal.clone', locale)
      : t('assets.modal.add', locale)

  return (
    <Modal title={title} onClose={onClose}>
      {error && <p className="text-red-500 text-xs mb-3 bg-red-50 p-2 rounded">{error}</p>}
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Asset ID *"><input className={inputCls} value={form.asset_id} onChange={set('asset_id')} placeholder="IT-001" /></Field>
        <Field label="Company">
          <select className={selectCls} value={form.company} onChange={set('company')}>
            <option value="">{t('common.select', locale)}</option>
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Item Name *"><input className={inputCls} value={form.item_name} onChange={set('item_name')} /></Field>
        <Field label="Category">
          <select className={selectCls} value={form.category} onChange={set('category')}>
            <option value="">{t('common.select', locale)}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Brand"><input className={inputCls} value={form.brand} onChange={set('brand')} /></Field>
        <Field label="Model"><input className={inputCls} value={form.model} onChange={set('model')} /></Field>
        <Field label="Serial Number"><input className={inputCls} value={form.serial_number} onChange={set('serial_number')} /></Field>
        <Field label="Condition">
          <select className={selectCls} value={form.condition} onChange={set('condition')}>
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Purchase Date"><input className={inputCls} type="date" value={form.purchase_date} onChange={set('purchase_date')} /></Field>
        <Field label="Purchase Price (CAD)"><input className={inputCls} type="number" min="0" step="0.01" value={form.purchase_price} onChange={set('purchase_price')} /></Field>
        <Field label="Vendor"><input className={inputCls} value={form.vendor} onChange={set('vendor')} /></Field>
        <Field label="Warranty End"><input className={inputCls} type="date" value={form.warranty_end} onChange={set('warranty_end')} /></Field>
        <Field label="Location"><input className={inputCls} value={form.location} onChange={set('location')} /></Field>
        <Field label="Assigned To">
          <select className={selectCls} value={form.employee_id} onChange={set('employee_id')}>
            <option value="">{t('common.unassigned', locale)}</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea className={inputCls} rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.cancel', locale)}</button>
        <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? t('common.saving', locale) : t('common.save', locale)}
        </button>
      </div>
    </Modal>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ assets, company }: { assets: Asset[]; company: string }) {
  const { locale } = useLocale()
  const filt = company ? assets.filter(a => a.company === company) : assets

  const byCond: Record<string, number> = {}
  filt.forEach(a => { byCond[a.condition] = (byCond[a.condition] ?? 0) + 1 })

  const byCat: Record<string, number> = {}
  filt.forEach(a => { const c = a.category ?? 'Unknown'; byCat[c] = (byCat[c] ?? 0) + 1 })

  const totalValue = filt.reduce((s, a) => s + (a.purchase_price ?? 0), 0)

  const today = new Date()
  const warrantyExpiring = filt
    .filter(a => a.condition === 'In Use' && a.warranty_end)
    .filter(a => {
      const diff = (new Date(a.warranty_end!).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      return diff >= 0 && diff <= 60
    })
    .sort((a, b) => a.warranty_end!.localeCompare(b.warranty_end!))

  const catMax = Math.max(...Object.values(byCat), 1)
  const condMax = Math.max(...Object.values(byCond), 1)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow p-5 border-t-4 border-blue-500">
          <p className="text-xs text-gray-500 mb-1">{t('assets.stat.total', locale)}</p>
          <p className="text-2xl font-bold text-gray-800">{filt.length}<span className="text-sm font-normal text-gray-400 ml-1">{t('common.items', locale)}</span></p>
          <p className="text-xs text-gray-400 mt-1">{company || t('assets.stat.all_companies', locale)}</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5 border-t-4 border-green-500">
          <p className="text-xs text-gray-500 mb-1">{t('assets.stat.in_use', locale)}</p>
          <p className="text-2xl font-bold text-green-700">{byCond['In Use'] ?? 0}<span className="text-sm font-normal text-gray-400 ml-1">{t('common.items', locale)}</span></p>
          <p className="text-xs text-gray-400 mt-1">In Use</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5 border-t-4 border-yellow-500">
          <p className="text-xs text-gray-500 mb-1">{t('assets.stat.storage', locale)}</p>
          <p className="text-2xl font-bold text-yellow-600">{byCond['Storage'] ?? 0}<span className="text-sm font-normal text-gray-400 ml-1">{t('common.items', locale)}</span></p>
          <p className="text-xs text-gray-400 mt-1">Storage</p>
        </div>
        <div className="bg-white rounded-xl shadow p-5 border-t-4 border-gray-400">
          <p className="text-xs text-gray-500 mb-1">{t('assets.stat.total_value', locale)}</p>
          <p className="text-2xl font-bold text-gray-700">${totalValue.toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">CAD</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">{t('assets.chart.by_category', locale)}</h3>
          <div className="space-y-2">
            {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-2">
                <div className="flex-1 text-xs text-gray-600 truncate">{cat}</div>
                <div className="text-xs font-medium text-gray-800 w-6 text-right">{count}</div>
                <div className="w-24 bg-gray-100 rounded-full h-1.5 overflow-hidden shrink-0">
                  <div className="bg-blue-400 h-full rounded-full" style={{ width: `${(count / catMax) * 100}%` }} />
                </div>
              </div>
            ))}
            {Object.keys(byCat).length === 0 && <p className="text-gray-400 text-sm">{t('common.no_data', locale)}</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">{t('assets.chart.by_condition', locale)}</h3>
          <div className="space-y-2">
            {CONDITIONS.map(cond => {
              const count = byCond[cond] ?? 0
              return (
                <div key={cond} className="flex items-center gap-2">
                  <div className="w-20 shrink-0">
                    <Badge label={cond} color={CONDITION_COLORS[cond]} />
                  </div>
                  <div className="text-xs font-medium text-gray-800 w-6 text-right">{count}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div className={`${CONDITION_BAR_COLORS[cond]} h-full rounded-full`} style={{ width: `${(count / condMax) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {warrantyExpiring.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-semibold text-amber-800 text-sm mb-2">{t('assets.warranty_alert', locale)}</h3>
          <div className="space-y-1">
            {warrantyExpiring.map(a => (
              <div key={a.id} className="flex justify-between text-xs text-amber-700">
                <span>{a.item_name} ({a.asset_id})</span>
                <span>{t('assets.warranty_expires', locale)} {a.warranty_end} · {a.employees?.[0]?.name ?? t('common.unassigned', locale)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ViewTab = 'dashboard' | 'list'

export default function AssetsPage() {
  const { locale } = useLocale()
  const [assets, setAssets] = useState<Asset[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState('')
  const [view, setView] = useState<ViewTab>('dashboard')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [modal, setModal] = useState<{ open: boolean; item?: Asset; clone?: Asset }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: a }, { data: e }] = await Promise.all([
      supabase.from('assets')
        .select('id,asset_id,company,category,item_name,brand,model,serial_number,purchase_date,purchase_price,vendor,warranty_end,condition,location,notes,employee_id,employees(name)')
        .order('category'),
      supabase.from('employees').select('id,name').order('name'),
    ])
    setAssets((a as Asset[]) ?? [])
    setEmployees((e as Employee[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete() {
    if (!deleteTarget) return
    await supabase.from('assets').delete().eq('id', deleteTarget)
    setDeleteTarget(null)
    load()
  }

  const cats = Array.from(new Set(assets.map(r => r.category).filter(Boolean))) as string[]

  const filtered = assets.filter(a => {
    const matchCo = !company || a.company === company
    const matchCat = !catFilter || a.category === catFilter
    const q = search.toLowerCase()
    const matchQ = !q || [a.item_name, a.brand, a.model, a.asset_id, a.serial_number, a.employees?.[0]?.name]
      .some(v => v?.toLowerCase().includes(q))
    return matchCo && matchCat && matchQ
  })

  const companyTabs = [
    { label: t('assets.all_companies', locale), value: '' },
    ...COMPANIES.map(c => ({ label: c, value: c })),
  ]

  const viewTabs: { labelKey: string; value: ViewTab }[] = [
    { labelKey: 'assets.tab.dashboard', value: 'dashboard' },
    { labelKey: 'assets.tab.list',      value: 'list' },
  ]

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">{t('assets.title', locale)}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('assets.subtitle', locale)}</p>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {companyTabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setCompany(tab.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              company === tab.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex border-b border-gray-200 mb-5">
        {viewTabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setView(tab.value)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              view === tab.value ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(tab.labelKey, locale)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : (
        <>
          {view === 'dashboard' && <Dashboard assets={assets} company={company} />}

          {view === 'list' && (
            <div>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex gap-2">
                  <select
                    className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                    value={catFilter}
                    onChange={e => setCatFilter(e.target.value)}
                  >
                    <option value="">{t('assets.all_categories', locale)}</option>
                    {cats.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    className="border rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder={t('assets.search_placeholder', locale)}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => setModal({ open: true })}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  {t('assets.add', locale)}
                </button>
              </div>
              <div className="bg-white rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm min-w-max">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Asset ID</th>
                      <th className="px-4 py-3 text-left">Category</th>
                      <th className="px-4 py-3 text-left">Item</th>
                      <th className="px-4 py-3 text-left">Brand / Model</th>
                      <th className="px-4 py-3 text-left">Serial</th>
                      <th className="px-4 py-3 text-left">Company</th>
                      <th className="px-4 py-3 text-left">{t('assets.col.assigned_to', locale)}</th>
                      <th className="px-4 py-3 text-left">{t('assets.col.purchase_date', locale)}</th>
                      <th className="px-4 py-3 text-right">{t('assets.col.purchase_price', locale)}</th>
                      <th className="px-4 py-3 text-left">{t('assets.col.warranty', locale)}</th>
                      <th className="px-4 py-3 text-left">{t('assets.col.condition', locale)}</th>
                      <th className="px-4 py-3 text-left">{t('assets.col.actions', locale)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(r => {
                      const warrantyAlert = (() => {
                        if (!r.warranty_end || r.condition !== 'In Use') return false
                        const diff = (new Date(r.warranty_end).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
                        return diff >= 0 && diff <= 60
                      })()
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.asset_id}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{r.category ?? '—'}</td>
                          <td className="px-4 py-2 font-medium text-gray-800">{r.item_name ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{[r.brand, r.model].filter(Boolean).join(' / ') || '—'}</td>
                          <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.serial_number ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{r.company ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{r.employees?.[0]?.name ?? <span className="text-gray-300">{t('common.unassigned', locale)}</span>}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{r.purchase_date ?? '—'}</td>
                          <td className="px-4 py-2 text-right text-gray-600">
                            {r.purchase_price != null ? `$${r.purchase_price.toLocaleString()}` : '—'}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            <span className={warrantyAlert ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                              {r.warranty_end ?? '—'}{warrantyAlert && ' ⚠'}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <Badge label={r.condition} color={CONDITION_COLORS[r.condition] ?? 'bg-gray-100 text-gray-500'} />
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-2">
                              <button onClick={() => setModal({ open: true, item: r })} className="text-xs text-blue-500 hover:underline">{t('common.edit', locale)}</button>
                              <button onClick={() => setModal({ open: true, clone: r })} className="text-xs text-gray-400 hover:underline">{t('common.clone', locale)}</button>
                              <button onClick={() => setDeleteTarget(r.id)} className="text-xs text-red-400 hover:underline">{t('common.delete', locale)}</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{t('common.no_results', locale)}</p>}
              </div>
            </div>
          )}
        </>
      )}

      {modal.open && (
        <AssetModal
          initial={modal.item}
          clone={modal.clone}
          employees={employees}
          onClose={() => setModal({ open: false })}
          onSave={() => { setModal({ open: false }); load() }}
        />
      )}
      {deleteTarget && (
        <DeleteDialog onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      )}
    </div>
  )
}
