'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

type Company = 'afs' | 'tnt' | 'zfs'

interface Location {
  id: string
  company_id: Company
  region: string | null
  city: string
  name: string
  address: string | null
  notes: string | null
  created_at: string
}

interface LocationStats {
  vendorCount: number
  billCount: number
}

const CO_LABEL: Record<Company, string> = {
  afs: 'AFS Trans Co',
  tnt: 'TNT Express Lines',
  zfs: 'Zenith Fortio Services Inc.',
}

const CO_COLOR: Record<Company, string> = {
  afs: 'border-line text-blue-600',
  tnt: 'border-line text-amber-600',
  zfs: 'border-line text-emerald-600',
}

const CO_BADGE: Record<Company, string> = {
  afs: 'text-blue-600',
  tnt: 'text-amber-600',
  zfs: 'text-emerald-600',
}

function emptyLocation(): Omit<Location, 'id' | 'created_at'> {
  return { company_id: 'afs', region: '', city: '', name: '', address: '', notes: '' }
}

function LocationModal({
  initial, onClose, onSave,
}: {
  initial: Partial<Location>
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({ ...emptyLocation(), ...initial })
  const [saving, setSaving] = useState(false)
  const isEdit = !!(initial as Location).id

  async function save() {
    if (!form.name.trim() || !form.city.trim()) return
    setSaving(true)
    const payload = {
      company_id: form.company_id,
      region: form.region || null,
      city: form.city.trim(),
      name: form.name.trim(),
      address: form.address || null,
      notes: form.notes || null,
    }
    if (isEdit) {
      await supabase.from('utility_locations').update(payload).eq('id', (initial as Location).id)
    } else {
      await supabase.from('utility_locations').insert(payload)
    }
    setSaving(false)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Location' : 'Add Location'}</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-muted text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Company *</label>
            <div className="flex gap-2">
              {(['afs', 'tnt', 'zfs'] as Company[]).map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, company_id: c }))}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    form.company_id === c ? 'bg-ink text-white border-ink' : 'border-line text-ink-muted hover:bg-pill'
                  }`}>{c.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Location Name *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Surrey Head Office"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">City *</label>
              <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="e.g. Surrey"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Region / Province</label>
              <input type="text" value={form.region ?? ''} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                placeholder="e.g. British Columbia"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Address</label>
            <input type="text" value={form.address ?? ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Street address"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-muted mb-1">Notes</label>
            <textarea rows={2} value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink resize-none" />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm text-ink-muted bg-pill rounded-lg hover:bg-line transition-colors">Cancel</button>
          <button onClick={save} disabled={saving || !form.name.trim() || !form.city.trim()}
            className="flex-1 px-4 py-2 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-line transition-colors">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Location'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LocationsContent() {
  const [locations, setLocations] = useState<Location[]>([])
  const [stats,     setStats]     = useState<Record<string, LocationStats>>({})
  const [loading,   setLoading]   = useState(true)
  const [coFilter,  setCoFilter]  = useState<Company | 'all'>('all')
  const [showModal, setShowModal] = useState(false)
  const [editLoc,   setEditLoc]   = useState<Partial<Location> | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: locs }, { data: accounts }, { data: bills }] = await Promise.all([
      supabase.from('utility_locations').select('*').order('company_id').order('name'),
      supabase.from('utility_service_accounts').select('location_id, vendor_id'),
      supabase.from('utility_bills').select('location_id'),
    ])

    const locList = (locs as Location[]) ?? []
    setLocations(locList)

    const s: Record<string, LocationStats> = {}
    locList.forEach(l => {
      const vendorIds = new Set(
        ((accounts ?? []) as { location_id: string | null; vendor_id: string }[])
          .filter(a => a.location_id === l.id)
          .map(a => a.vendor_id)
      )
      const billCount = ((bills ?? []) as { location_id: string | null }[])
        .filter(b => b.location_id === l.id).length
      s[l.id] = { vendorCount: vendorIds.size, billCount }
    })
    setStats(s)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function deleteLocation(id: string) {
    await supabase.from('utility_locations').delete().eq('id', id)
    setDelConfirm(null)
    load()
  }

  const filtered = coFilter === 'all' ? locations : locations.filter(l => l.company_id === coFilter)

  const grouped = (['afs', 'tnt', 'zfs'] as Company[]).map(co => ({
    co,
    items: filtered.filter(l => l.company_id === co),
  })).filter(g => g.items.length > 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex gap-1 bg-pill rounded-lg p-1">
          {(['all', 'afs', 'tnt', 'zfs'] as (Company | 'all')[]).map(c => (
            <button key={c} onClick={() => setCoFilter(c)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                coFilter === c ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}>
              {c === 'all' ? 'All' : c.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditLoc(null); setShowModal(true) }}
          className="px-4 py-1.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 transition-colors">
          + Add Location
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5].map(i => <div key={i} className="h-36 bg-white rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-sm text-ink-faint">No locations found.</div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ co, items }) => (
            <div key={co}>
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border mb-4 ${CO_COLOR[co]}`}>
                <span>{co.toUpperCase()}</span>
                <span className="opacity-60">·</span>
                <span>{CO_LABEL[co]}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map(loc => {
                  const s = stats[loc.id] ?? { vendorCount: 0, billCount: 0 }
                  return (
                    <div key={loc.id} className="bg-white rounded-2xl border border-line-soft p-5 hover:shadow-md transition-shadow group">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-ink truncate">{loc.name}</h3>
                          <p className="text-xs text-ink-muted mt-0.5">
                            {loc.city}{loc.region ? `, ${loc.region}` : ''}
                          </p>
                        </div>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${CO_BADGE[co]}`}>
                          {co.toUpperCase()}
                        </span>
                      </div>

                      {loc.address && (
                        <p className="text-xs text-ink-faint mb-3 leading-relaxed">{loc.address}</p>
                      )}

                      <div className="flex gap-4 mb-3">
                        <div className="text-center">
                          <p className="text-lg font-bold text-ink">{s.vendorCount}</p>
                          <p className="text-[10px] text-ink-faint uppercase tracking-wide">Vendors</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-ink">{s.billCount}</p>
                          <p className="text-[10px] text-ink-faint uppercase tracking-wide">Bills</p>
                        </div>
                      </div>

                      {loc.notes && (
                        <p className="text-xs text-ink-faint italic border-t border-line-soft pt-2">{loc.notes}</p>
                      )}

                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-soft opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditLoc(loc); setShowModal(true) }}
                          className="text-xs text-ink-muted hover:text-ink transition-colors font-medium">Edit</button>
                        {delConfirm === loc.id ? (
                          <div className="flex gap-1 ml-auto">
                            <button onClick={() => deleteLocation(loc.id)} className="text-xs text-signal-neg font-medium hover:opacity-70">Delete</button>
                            <button onClick={() => setDelConfirm(null)} className="text-xs text-ink-faint">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setDelConfirm(loc.id)} className="text-xs text-ink-faint hover:text-signal-neg transition-colors ml-auto">Delete</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <LocationModal
          initial={editLoc ?? {}}
          onClose={() => { setShowModal(false); setEditLoc(null) }}
          onSave={() => { setShowModal(false); setEditLoc(null); load() }}
        />
      )}
    </div>
  )
}

export default function LocationsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-faint text-sm">Loading…</div>}>
      <LocationsContent />
    </Suspense>
  )
}
