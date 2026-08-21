'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

// ── Types ─────────────────────────────────────────────────────────────────────

type EmailPlan = { id: string; name: string; monthly_cost_cad: number }

type License = {
  id: string
  account_id: string
  display_name: string | null
  email_address: string | null
  alias: string | null
  account_type: string
  license_plan: string | null
  monthly_cost_cad: number
  status: string
  company: string | null
  employee_id: string | null
  created_date: string | null
  notes: string | null
  employees: { name: string }[] | null
}

type SubEmployee = { employee_id: string; employees: { name: string }[] | null }
type SubEmpRow = { subscription_id: string; employee_id: string; employees: { name: string }[] | null }

type Subscription = {
  id: string
  sub_id: string | null
  company: string | null
  vendor: string | null
  product: string | null
  plan_name: string | null
  billing_cycle: string | null
  cost_cad: number
  renewal_date: string | null
  billing_day: number | null
  employee_id: string | null
  owner: string | null
  status: string
  notes: string | null
  employees: { name: string }[] | null
  subscription_employees: SubEmployee[]
}

type Employee = { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPANIES = ['AFS', 'TNT', 'ZFS']
const STATUS_OPTIONS = ['Active', 'Inactive']
const ACCOUNT_TYPES = ['Individual', 'Shared']
const BILLING_CYCLES = ['Monthly', 'Annual', 'One-time']

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeNextAccountId(licenses: License[]): string {
  const nums = licenses
    .map(l => {
      const m = l.account_id?.match(/(\d+)$/)
      return m ? parseInt(m[1], 10) : null
    })
    .filter((n): n is number => n !== null)
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `A-${String(max + 1).padStart(3, '0')}`
}

function nextBillingDate(day: number): string {
  const today = new Date()
  let year = today.getFullYear()
  let month = today.getMonth()
  const candidate = new Date(year, month, day)
  if (candidate <= today) {
    month += 1
    if (month > 11) { month = 0; year += 1 }
  }
  return new Date(year, month, day).toISOString().split('T')[0]
}

function isRenewingSoon(sub: Subscription): boolean {
  const dateStr = sub.billing_day ? nextBillingDate(sub.billing_day) : sub.renewal_date
  if (!dateStr) return false
  const diff = (new Date(dateStr).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 30
}

function linkedCount(sub: Subscription): number {
  return sub.subscription_employees?.length || 1
}

function costPerPerson(sub: Subscription): number {
  return (sub.cost_cad ?? 0) / linkedCount(sub)
}

function getSubEmployeeName(
  rel: { name: string }[] | { name: string } | null | undefined,
  employeeId?: string | null,
  employees?: Employee[]
): string | null {
  if (Array.isArray(rel)) return rel[0]?.name ?? null
  if (rel && typeof rel === 'object' && 'name' in rel) return rel.name ?? null
  if (employeeId && employees) return employees.find(e => e.id === employeeId)?.name ?? null
  return null
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
}

function statusColor(s: string) {
  return s === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
}

function accountTypeColor(tp: string) {
  return tp === 'Shared' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
const inputFlexCls = 'min-w-0 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300'
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

// ── Plan Manager Modal ────────────────────────────────────────────────────────

function PlanManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { locale } = useLocale()
  const [plans, setPlans] = useState<EmailPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', monthly_cost_cad: '' })
  const [newForm, setNewForm] = useState({ name: '', monthly_cost_cad: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function loadPlans() {
    const { data } = await supabase.from('email_plans').select('*').order('name')
    setPlans((data as EmailPlan[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadPlans() }, [])

  async function handleAdd() {
    if (!newForm.name.trim()) { setError(t('licenses.plan.name_req', locale)); return }
    setSaving(true)
    const { error: err } = await supabase.from('email_plans').insert({
      name: newForm.name.trim(),
      monthly_cost_cad: parseFloat(newForm.monthly_cost_cad) || 0,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setNewForm({ name: '', monthly_cost_cad: '' })
    setError('')
    await loadPlans()
    onChanged()
  }

  async function handleSaveEdit(id: string) {
    if (!editForm.name.trim()) { setError(t('licenses.plan.name_req', locale)); return }
    setSaving(true)
    const { error: err } = await supabase.from('email_plans').update({
      name: editForm.name.trim(),
      monthly_cost_cad: parseFloat(editForm.monthly_cost_cad) || 0,
    }).eq('id', id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setEditId(null)
    setError('')
    await loadPlans()
    onChanged()
  }

  async function handleDelete(id: string) {
    await supabase.from('email_plans').delete().eq('id', id)
    await loadPlans()
    onChanged()
  }

  return (
    <Modal title={t('licenses.plan.modal_title', locale)} onClose={onClose}>
      {error && <p className="text-red-500 text-xs mb-3 bg-red-50 p-2 rounded">{error}</p>}
      {loading ? (
        <p className="text-gray-400 text-sm py-4 text-center">Loading…</p>
      ) : (
        <div className="space-y-1 mb-4">
          {plans.length === 0 && (
            <p className="text-gray-400 text-sm py-3 text-center">{t('licenses.plan.no_plans', locale)}</p>
          )}
          {plans.map(plan => (
            <div key={plan.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
              {editId === plan.id ? (
                <>
                  <input
                    className={`${inputFlexCls} flex-1`}
                    value={editForm.name}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                    placeholder={t('licenses.plan.name', locale)}
                  />
                  <input
                    className={`${inputFlexCls} w-28 shrink-0`}
                    type="number" min="0" step="0.01"
                    value={editForm.monthly_cost_cad}
                    onChange={e => setEditForm(p => ({ ...p, monthly_cost_cad: e.target.value }))}
                  />
                  <button
                    onClick={() => handleSaveEdit(plan.id)}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 shrink-0"
                  >
                    {t('licenses.plan.save', locale)}
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 shrink-0"
                  >
                    {t('common.cancel', locale)}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-800">{plan.name}</span>
                  <span className="text-sm font-medium text-gray-600 w-24 text-right">${plan.monthly_cost_cad.toFixed(2)}</span>
                  <button
                    onClick={() => { setEditId(plan.id); setEditForm({ name: plan.name, monthly_cost_cad: String(plan.monthly_cost_cad) }) }}
                    className="text-xs text-blue-500 hover:underline shrink-0"
                  >
                    {t('licenses.plan.edit', locale)}
                  </button>
                  <button
                    onClick={() => handleDelete(plan.id)}
                    className="text-xs text-red-400 hover:underline shrink-0"
                  >
                    {t('common.delete', locale)}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border-t pt-3">
        <p className="text-xs font-medium text-gray-500 mb-2">{t('licenses.plan.add', locale)}</p>
        <div className="flex gap-2">
          <input
            className={`${inputFlexCls} flex-1`}
            placeholder={t('licenses.plan.name', locale)}
            value={newForm.name}
            onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          />
          <input
            className={`${inputFlexCls} w-28 shrink-0`}
            type="number" min="0" step="0.01"
            placeholder="0.00"
            value={newForm.monthly_cost_cad}
            onChange={e => setNewForm(p => ({ ...p, monthly_cost_cad: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          />
          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            {t('common.add', locale)}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── License Modal ─────────────────────────────────────────────────────────────

type LicenseForm = {
  account_id: string; display_name: string; email_address: string; alias: string
  account_type: string; license_plan: string; monthly_cost_cad: string
  status: string; company: string; employee_id: string; notes: string
}

const emptyLicenseForm: LicenseForm = {
  account_id: '', display_name: '', email_address: '', alias: '',
  account_type: 'Individual', license_plan: '', monthly_cost_cad: '0',
  status: 'Active', company: '', employee_id: '', notes: '',
}

function LicenseModal({ initial, clone, employees, emailPlans, nextAccountId, onClose, onSave }: {
  initial?: License; clone?: License; employees: Employee[]
  emailPlans: EmailPlan[]; nextAccountId: string
  onClose: () => void; onSave: () => void
}) {
  const { locale } = useLocale()
  const src = initial ?? clone
  const [form, setForm] = useState<LicenseForm>(src ? {
    account_id: initial ? (src.account_id ?? '') : '',
    display_name: src.display_name ?? '',
    email_address: initial ? (src.email_address ?? '') : '',
    alias: src.alias ?? '',
    account_type: src.account_type ?? 'Individual',
    license_plan: src.license_plan ?? '',
    monthly_cost_cad: String(src.monthly_cost_cad ?? 0),
    status: src.status ?? 'Active',
    company: src.company ?? '',
    employee_id: src.employee_id ?? '',
    notes: src.notes ?? '',
  } : { ...emptyLicenseForm, account_id: nextAccountId })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const initialSnapshot = JSON.stringify(src ? {
    account_id: initial ? (src.account_id ?? '') : '',
    display_name: src.display_name ?? '',
    email_address: initial ? (src.email_address ?? '') : '',
    alias: src.alias ?? '',
    account_type: src.account_type ?? 'Individual',
    license_plan: src.license_plan ?? '',
    monthly_cost_cad: String(src.monthly_cost_cad ?? 0),
    status: src.status ?? 'Active',
    company: src.company ?? '',
    employee_id: src.employee_id ?? '',
    notes: src.notes ?? '',
  } : { ...emptyLicenseForm, account_id: nextAccountId })
  const isDirty = JSON.stringify(form) !== initialSnapshot

  const set = (k: keyof LicenseForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  function handlePlanChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const name = e.target.value
    const plan = emailPlans.find(p => p.name === name)
    setForm(prev => ({
      ...prev,
      license_plan: name,
      monthly_cost_cad: plan ? String(plan.monthly_cost_cad) : prev.monthly_cost_cad,
    }))
  }

  async function handleSubmit() {
    if (!form.account_id.trim()) { setError(t('licenses.form.account_id_req', locale)); return }
    setSaving(true)
    const payload = {
      account_id: form.account_id.trim(),
      display_name: form.display_name || null,
      email_address: form.email_address || null,
      alias: form.alias || null,
      account_type: form.account_type,
      license_plan: form.license_plan || null,
      monthly_cost_cad: parseFloat(form.monthly_cost_cad) || 0,
      status: form.status,
      company: form.company || null,
      employee_id: form.employee_id || null,
      notes: form.notes || null,
    }
    const { error: err } = initial
      ? await supabase.from('licenses').update(payload).eq('id', initial.id)
      : await supabase.from('licenses').insert(payload)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSave()
  }

  function handleCloseRequest() {
    if (saving) return
    if (isDirty && !window.confirm('Your changes have not been saved. Close without saving?')) return
    onClose()
  }

  const title = initial
    ? t('licenses.modal.edit_account', locale)
    : clone
      ? t('licenses.modal.clone_account', locale)
      : t('licenses.modal.add_account', locale)

  return (
    <Modal title={title} onClose={handleCloseRequest}>
      {error && <p className="text-red-500 text-xs mb-3 bg-red-50 p-2 rounded">{error}</p>}
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Account ID *">
          <div className="relative">
            <input className={inputCls} value={form.account_id} onChange={set('account_id')} placeholder="A-001" />
            {!initial && !clone && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-400 pointer-events-none">
                {t('licenses.form.auto_id_note', locale)}
              </span>
            )}
          </div>
        </Field>
        <Field label="Company">
          <select className={selectCls} value={form.company} onChange={set('company')}>
            <option value="">{t('common.select', locale)}</option>
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Display Name"><input className={inputCls} value={form.display_name} onChange={set('display_name')} /></Field>
        <Field label="Email Address"><input className={inputCls} type="email" value={form.email_address} onChange={set('email_address')} /></Field>
        <Field label="Alias"><input className={inputCls} value={form.alias} onChange={set('alias')} /></Field>
        <Field label="Account Type">
          <select className={selectCls} value={form.account_type} onChange={set('account_type')}>
            {ACCOUNT_TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
          </select>
        </Field>
        <Field label="License Plan">
          <select className={selectCls} value={form.license_plan} onChange={handlePlanChange}>
            <option value="">{t('licenses.form.plan_ph', locale)}</option>
            {emailPlans.map(p => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
            {form.license_plan && !emailPlans.find(p => p.name === form.license_plan) && (
              <option value={form.license_plan}>{form.license_plan}</option>
            )}
          </select>
        </Field>
        <Field label="Monthly Cost (CAD)">
          <input
            className={inputCls}
            type="number" min="0" step="0.01"
            value={form.monthly_cost_cad}
            onChange={set('monthly_cost_cad')}
          />
          {emailPlans.find(p => p.name === form.license_plan) && (
            <p className="text-xs text-blue-500 mt-1">
              ✓ {t('licenses.form.auto_id_note', locale)} (${emailPlans.find(p => p.name === form.license_plan)?.monthly_cost_cad.toFixed(2)} CAD)
            </p>
          )}
        </Field>
        <Field label="Status">
          <select className={selectCls} value={form.status} onChange={set('status')}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Linked Employee">
          <select className={selectCls} value={form.employee_id} onChange={set('employee_id')}>
            <option value="">{t('common.unlinked', locale)}</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea className={inputCls} rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={handleCloseRequest} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.cancel', locale)}</button>
        <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? t('common.saving', locale) : t('common.save', locale)}
        </button>
      </div>
    </Modal>
  )
}

// ── Subscription Modal ────────────────────────────────────────────────────────

type SubForm = {
  sub_id: string; company: string; vendor: string; product: string; plan_name: string
  billing_cycle: string; cost_cad: string; billing_day: string; renewal_date: string
  employee_ids: string[]; owner: string; status: string; notes: string
}

const emptySubForm: SubForm = {
  sub_id: '', company: '', vendor: '', product: '', plan_name: '',
  billing_cycle: 'Annual', cost_cad: '0', billing_day: '', renewal_date: '',
  employee_ids: [], owner: '', status: 'Active', notes: '',
}

function SubModal({ initial, clone, employees, onClose, onSave }: {
  initial?: Subscription; clone?: Subscription; employees: Employee[]; onClose: () => void; onSave: () => void
}) {
  const { locale } = useLocale()
  const src = initial ?? clone
  const [form, setForm] = useState<SubForm>(src ? {
    sub_id: '',
    company: src.company ?? '',
    vendor: src.vendor ?? '',
    product: src.product ?? '',
    plan_name: src.plan_name ?? '',
    billing_cycle: src.billing_cycle ?? 'Annual',
    cost_cad: String(src.cost_cad ?? 0),
    billing_day: src.billing_day ? String(src.billing_day) : '',
    renewal_date: src.renewal_date ?? '',
    employee_ids: (src.subscription_employees ?? []).map(se => se.employee_id),
    owner: src.owner ?? '',
    status: src.status ?? 'Active',
    notes: src.notes ?? '',
  } : emptySubForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [empSearch, setEmpSearch] = useState('')
  const initialSnapshot = JSON.stringify(src ? {
    sub_id: '',
    company: src.company ?? '',
    vendor: src.vendor ?? '',
    product: src.product ?? '',
    plan_name: src.plan_name ?? '',
    billing_cycle: src.billing_cycle ?? 'Annual',
    cost_cad: String(src.cost_cad ?? 0),
    billing_day: src.billing_day ? String(src.billing_day) : '',
    renewal_date: src.renewal_date ?? '',
    employee_ids: (src.subscription_employees ?? []).map(se => se.employee_id),
    owner: src.owner ?? '',
    status: src.status ?? 'Active',
    notes: src.notes ?? '',
  } : emptySubForm)
  const isDirty = JSON.stringify(form) !== initialSnapshot || !!empSearch.trim()

  const set = (k: keyof Omit<SubForm, 'employee_ids'>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  function toggleEmployee(id: string) {
    setForm(p => ({
      ...p,
      employee_ids: p.employee_ids.includes(id)
        ? p.employee_ids.filter(x => x !== id)
        : [...p.employee_ids, id],
    }))
  }

  const filteredEmps = empSearch.trim()
    ? employees.filter(e => e.name.toLowerCase().includes(empSearch.toLowerCase()))
    : employees

  const cost = parseFloat(form.cost_cad) || 0
  const perPerson = form.employee_ids.length > 1 ? cost / form.employee_ids.length : null

  const billingDayNum = parseInt(form.billing_day)
  const nextDate = billingDayNum >= 1 && billingDayNum <= 31 ? nextBillingDate(billingDayNum) : null

  async function handleSubmit() {
    if (!form.vendor.trim() && !form.product.trim()) { setError(t('licenses.form.vendor_or_product', locale)); return }
    setSaving(true)

    const basePayload = {
      sub_id: form.sub_id || null,
      company: form.company || null,
      vendor: form.vendor || null,
      product: form.product || null,
      plan_name: form.plan_name || null,
      billing_cycle: form.billing_cycle || null,
      cost_cad: cost,
      renewal_date: !form.billing_day && form.renewal_date ? form.renewal_date : null,
      owner: form.owner || null,
      status: form.status,
      notes: form.notes || null,
    }
    const billingDayVal = billingDayNum >= 1 && billingDayNum <= 31 ? billingDayNum : null

    async function tryUpsert(includeBillingDay: boolean) {
      const payload = includeBillingDay ? { ...basePayload, billing_day: billingDayVal } : basePayload
      if (initial) {
        return supabase.from('subscriptions').update(payload).eq('id', initial.id).select('id').single()
      } else {
        return supabase.from('subscriptions').insert(payload).select('id').single()
      }
    }

    let result = await tryUpsert(true)
    if (result.error?.message?.includes('billing_day')) {
      result = await tryUpsert(false)
    }
    if (result.error || !result.data) {
      setSaving(false); setError(result.error?.message ?? t('licenses.form.save_failed', locale)); return
    }
    const subId: string = result.data.id

    const { error: delErr } = await supabase
      .from('subscription_employees').delete().eq('subscription_id', subId)
    if (delErr) { setSaving(false); setError(`${t('licenses.form.link_reset_failed', locale)} ${delErr.message}`); return }

    if (form.employee_ids.length > 0) {
      const { error: insErr } = await supabase.from('subscription_employees').insert(
        form.employee_ids.map(eid => ({ subscription_id: subId, employee_id: eid }))
      )
      if (insErr) { setSaving(false); setError(`${t('licenses.form.link_save_failed', locale)} ${insErr.message}`); return }
    }

    setSaving(false)
    onSave()
  }

  function handleCloseRequest() {
    if (saving) return
    if (isDirty && !window.confirm('Your changes have not been saved. Close without saving?')) return
    onClose()
  }

  const title = initial
    ? t('licenses.modal.edit_sub', locale)
    : clone
      ? t('licenses.modal.clone_sub', locale)
      : t('licenses.modal.add_sub', locale)

  return (
    <Modal title={title} onClose={handleCloseRequest}>
      {error && <p className="text-red-500 text-xs mb-3 bg-red-50 p-2 rounded">{error}</p>}
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Vendor *"><input className={inputCls} value={form.vendor} onChange={set('vendor')} placeholder="Adobe, Loadlink…" /></Field>
        <Field label="Product *"><input className={inputCls} value={form.product} onChange={set('product')} placeholder="Acrobat Reader…" /></Field>
        <Field label="Plan Name"><input className={inputCls} value={form.plan_name} onChange={set('plan_name')} /></Field>
        <Field label="Company">
          <select className={selectCls} value={form.company} onChange={set('company')}>
            <option value="">{t('common.select', locale)}</option>
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Billing Cycle">
          <select className={selectCls} value={form.billing_cycle} onChange={set('billing_cycle')}>
            {BILLING_CYCLES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Cost (CAD)"><input className={inputCls} type="number" min="0" step="0.01" value={form.cost_cad} onChange={set('cost_cad')} /></Field>

        <div className="col-span-2 grid grid-cols-2 gap-x-3">
          <Field label={t('licenses.form.billing_day', locale)}>
            <input
              className={inputCls}
              type="number" min="1" max="31"
              placeholder={t('licenses.form.billing_day_ph', locale)}
              value={form.billing_day}
              onChange={set('billing_day')}
            />
            {nextDate && (
              <p className="text-xs text-blue-600 mt-1">{t('licenses.form.next_billing', locale)} {nextDate}</p>
            )}
          </Field>
          <Field label={t('licenses.form.renewal_date', locale)}>
            <input
              className={`${inputCls} ${form.billing_day ? 'opacity-40' : ''}`}
              type="date"
              value={form.billing_day ? '' : form.renewal_date}
              onChange={set('renewal_date')}
              disabled={!!form.billing_day}
            />
          </Field>
        </div>

        <Field label={t('licenses.form.owner', locale)}><input className={inputCls} value={form.owner} onChange={set('owner')} /></Field>
        <Field label="Status">
          <select className={selectCls} value={form.status} onChange={set('status')}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t('licenses.form.sub_id', locale)}>
          <input className={inputCls} value={form.sub_id} onChange={set('sub_id')} placeholder={t('licenses.form.sub_id_ph', locale)} />
        </Field>
      </div>

      <Field label={t('licenses.form.linked_employees', locale)}>
        <input
          className="w-full border rounded-lg px-3 py-1.5 text-sm mb-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder={t('licenses.form.emp_search_ph', locale)}
          value={empSearch}
          onChange={e => setEmpSearch(e.target.value)}
        />
        <div className="border rounded-lg max-h-36 overflow-y-auto bg-gray-50">
          {form.employee_ids.length > 0 && (
            <>
              {employees.filter(e => form.employee_ids.includes(e.id)).map(e => (
                <label key={e.id} className="flex items-center gap-2 cursor-pointer bg-violet-50 hover:bg-violet-100 px-2 py-1 transition-colors">
                  <input type="checkbox" className="rounded accent-violet-600" checked onChange={() => toggleEmployee(e.id)} />
                  <span className="text-sm font-medium text-violet-700">{e.name}</span>
                </label>
              ))}
              <div className="border-t border-gray-200" />
            </>
          )}
          {filteredEmps.filter(e => !form.employee_ids.includes(e.id)).map(e => (
            <label key={e.id} className="flex items-center gap-2 cursor-pointer hover:bg-white px-2 py-1 transition-colors">
              <input type="checkbox" className="rounded" checked={false} onChange={() => toggleEmployee(e.id)} />
              <span className="text-sm text-gray-700">{e.name}</span>
            </label>
          ))}
          {filteredEmps.filter(e => !form.employee_ids.includes(e.id)).length === 0 &&
           form.employee_ids.length === 0 && (
            <p className="text-center text-gray-400 text-xs py-3">{t('licenses.form.no_emp_results', locale)}</p>
          )}
        </div>
        {perPerson !== null && (
          <p className="text-xs text-violet-600 mt-1.5 font-medium">
            {form.employee_ids.length} {t('common.people', locale)} → ${perPerson.toFixed(2)} CAD / person
          </p>
        )}
      </Field>

      <Field label="Notes"><textarea className={inputCls} rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={handleCloseRequest} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.cancel', locale)}</button>
        <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? t('common.saving', locale) : t('common.save', locale)}
        </button>
      </div>
    </Modal>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, colorClass }: { label: string; value: string; sub: string; colorClass: string }) {
  return (
    <div className={`bg-white rounded-xl shadow p-5 border-t-4 ${colorClass}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  )
}

function BarList({ items, barColor }: { items: { label: string; value: number; display: string }[]; barColor: string }) {
  const { locale } = useLocale()
  const max = Math.max(...items.map(i => i.value), 1)
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-2">
          <div className="flex-1 text-xs text-gray-600 truncate">{item.label}</div>
          <div className="text-xs font-medium text-gray-800 w-14 text-right shrink-0">{item.display}</div>
          <div className="w-20 bg-gray-100 rounded-full h-1.5 overflow-hidden shrink-0">
            <div className={`${barColor} h-full rounded-full`} style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-gray-400 text-sm">{t('common.no_data', locale)}</p>}
    </div>
  )
}

function Dashboard({ licenses, subscriptions, company }: {
  licenses: License[]; subscriptions: Subscription[]; company: string
}) {
  const { locale } = useLocale()
  const filtLic = company ? licenses.filter(l => l.company === company) : licenses
  const filtSub = company ? subscriptions.filter(s => s.company === company) : subscriptions

  const activeLic = filtLic.filter(l => l.status === 'Active')
  const licCost = activeLic
    .filter(l => l.account_type === 'Individual')
    .reduce((s, l) => s + (l.monthly_cost_cad ?? 0), 0)

  const activeSub = filtSub.filter(s => s.status === 'Active')
  const subCostMonthly = activeSub.reduce((s, sub) => {
    const cost = sub.cost_cad ?? 0
    return s + (sub.billing_cycle === 'Annual' ? cost / 12 : cost)
  }, 0)

  const byPlan: Record<string, number> = {}
  activeLic.forEach(l => {
    const p = l.license_plan ?? 'Unknown'
    byPlan[p] = (byPlan[p] ?? 0) + 1
  })

  const byVendor: Record<string, number> = {}
  activeSub.forEach(s => {
    const v = s.vendor ?? 'Unknown'
    const cost = s.cost_cad ?? 0
    byVendor[v] = (byVendor[v] ?? 0) + (s.billing_cycle === 'Annual' ? cost / 12 : cost)
  })

  const soon = activeSub.filter(isRenewingSoon)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('licenses.stat.m365_active', locale)} value={String(activeLic.length)} sub={`${filtLic.length} total`} colorClass="border-blue-500" />
        <StatCard label={t('licenses.stat.m365_cost', locale)} value={`$${licCost.toFixed(0)}`} sub={t('licenses.stat.m365_cost_sub', locale)} colorClass="border-indigo-500" />
        <StatCard label={t('licenses.stat.subs_active', locale)} value={String(activeSub.length)} sub={`${filtSub.length} total`} colorClass="border-violet-500" />
        <StatCard label={t('licenses.stat.subs_cost', locale)} value={`$${subCostMonthly.toFixed(0)}`} sub={t('licenses.stat.cad_month', locale)} colorClass="border-purple-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">{t('licenses.chart.m365_by_plan', locale)}</h3>
          <BarList barColor="bg-blue-400" items={Object.entries(byPlan).sort((a,b)=>b[1]-a[1]).map(([label, value]) => ({ label, value, display: `${value}` }))} />
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">{t('licenses.chart.sub_by_vendor', locale)}</h3>
          <BarList barColor="bg-violet-400" items={Object.entries(byVendor).sort((a,b)=>b[1]-a[1]).map(([label, value]) => ({ label, value, display: `$${value.toFixed(0)}` }))} />
        </div>
      </div>

      {soon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-semibold text-amber-800 text-sm mb-2">{t('licenses.renewal_alert', locale)}</h3>
          <div className="space-y-1">
            {soon.map(s => {
              const dateStr = s.billing_day ? nextBillingDate(s.billing_day) : s.renewal_date
              return (
                <div key={s.id} className="flex justify-between text-xs text-amber-700">
                  <span>{s.vendor} — {s.product}</span>
                  <span>{dateStr} · ${(s.cost_cad ?? 0).toFixed(2)} CAD</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-5 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{t('licenses.total_monthly', locale)}</span>
        <span className="text-2xl font-bold text-gray-900">
          ${(licCost + subCostMonthly).toFixed(2)} <span className="text-sm font-normal text-gray-400">{t('licenses.stat.cad_month', locale)}</span>
        </span>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ViewTab = 'dashboard' | 'licenses' | 'subscriptions'
type LicSortCol = 'account_id' | 'display_name' | 'account_type' | 'license_plan' | 'monthly_cost_cad' | 'status'

export default function LicensesPage() {
  const { locale } = useLocale()
  const [licenses, setLicenses] = useState<License[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [emailPlans, setEmailPlans] = useState<EmailPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState('')
  const [view, setView] = useState<ViewTab>('dashboard')
  const [licSearch, setLicSearch] = useState('')
  const [subSearch, setSubSearch] = useState('')
  const [licSort, setLicSort] = useState<{ col: LicSortCol; dir: 'asc' | 'desc' }>({ col: 'account_id', dir: 'asc' })
  const [licModal, setLicModal] = useState<{ open: boolean; item?: License; clone?: License }>({ open: false })
  const [subModal, setSubModal] = useState<{ open: boolean; item?: Subscription; clone?: Subscription }>({ open: false })
  const [planManagerOpen, setPlanManagerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'license' | 'subscription'; id: string } | null>(null)
  const [rowMenu, setRowMenu] = useState<{
    type: 'license' | 'subscription'
    item: License | Subscription
    x: number
    y: number
  } | null>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) setRowMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)

    const [
      { data: lic, error: licErr },
      { data: sub, error: subErr },
      { data: emp },
      { data: plans },
    ] = await Promise.all([
      supabase.from('licenses')
        .select('id,account_id,display_name,email_address,alias,account_type,license_plan,monthly_cost_cad,status,company,employee_id,created_date,notes,employees!employee_id(name)')
        .order('company'),
      supabase.from('subscriptions')
        .select('*,employees!employee_id(name)')
        .order('vendor'),
      supabase.from('employees').select('id,name').eq('is_active', true).is('end_date', null).order('name'),
      supabase.from('email_plans').select('*').order('name'),
    ])

    if (licErr) console.error('[licenses]', licErr.message)
    if (subErr) console.error('[subscriptions]', subErr.message)

    const seMap: Record<string, SubEmployee[]> = {}
    const { data: seRows, error: seErr } = await supabase
      .from('subscription_employees')
      .select('subscription_id,employee_id,employees!employee_id(name)')
    if (seErr) console.warn('[subscription_employees]', seErr.message)
    ;(seRows as SubEmpRow[] ?? []).forEach(row => {
      if (!seMap[row.subscription_id]) seMap[row.subscription_id] = []
      seMap[row.subscription_id].push({ employee_id: row.employee_id, employees: row.employees })
    })

    const subsWithEmployees: Subscription[] = (sub ?? []).map((s: Subscription) => ({
      ...s,
      subscription_employees: seMap[s.id] ?? [],
    }))

    setLicenses((lic as License[]) ?? [])
    setSubscriptions(subsWithEmployees)
    setEmployees((emp as Employee[]) ?? [])
    setEmailPlans((plans as EmailPlan[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete() {
    if (!deleteTarget) return
    await supabase.from(deleteTarget.type === 'license' ? 'licenses' : 'subscriptions')
      .delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    load()
  }

  const filtLic = licenses.filter(l => {
    const matchCo = !company || l.company === company
    const q = licSearch.toLowerCase()
    const empName = l.employee_id ? employees.find(e => e.id === l.employee_id)?.name : undefined
    return matchCo && (!q || [l.display_name, l.email_address, l.account_id, empName].some(v => v?.toLowerCase().includes(q)))
  })

  function toggleLicSort(col: LicSortCol) {
    setLicSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }))
  }

  const sortedLic = [...filtLic].sort((a, b) => {
    const { col, dir } = licSort
    let av: string | number = ''
    let bv: string | number = ''
    if (col === 'account_id')        { av = a.account_id ?? '';          bv = b.account_id ?? '' }
    else if (col === 'display_name') { av = a.display_name ?? '';        bv = b.display_name ?? '' }
    else if (col === 'account_type') { av = a.account_type ?? '';        bv = b.account_type ?? '' }
    else if (col === 'license_plan') { av = a.license_plan ?? '';        bv = b.license_plan ?? '' }
    else if (col === 'monthly_cost_cad') { av = a.monthly_cost_cad ?? 0; bv = b.monthly_cost_cad ?? 0 }
    else if (col === 'status')       { av = a.status ?? '';              bv = b.status ?? '' }
    if (av < bv) return dir === 'asc' ? -1 : 1
    if (av > bv) return dir === 'asc' ? 1 : -1
    return 0
  })

  const filtSub = subscriptions.filter(s => {
    const matchCo = !company || s.company === company
    const q = subSearch.toLowerCase()
    return matchCo && (!q || [s.vendor, s.product, s.plan_name, s.owner].some(v => v?.toLowerCase().includes(q)))
  })

  const companyTabs = [
    { label: t('common.all', locale), value: '' },
    ...COMPANIES.map(c => ({ label: c, value: c })),
  ]
  const viewTabs: { labelKey: string; value: ViewTab }[] = [
    { labelKey: 'licenses.tab.dashboard',     value: 'dashboard' },
    { labelKey: 'licenses.tab.licenses',       value: 'licenses' },
    { labelKey: 'licenses.tab.subscriptions',  value: 'subscriptions' },
  ]

  return (
    <div className="min-h-screen bg-pill">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-ink">{t('licenses.title', locale)}</h1>
        <p className="text-sm text-ink-muted mt-1">{t('licenses.subtitle', locale)}</p>
      </div>

      <div className="flex gap-1 bg-white border border-line rounded-xl p-1 mb-4 w-fit flex-wrap">
        {companyTabs.map(tab => (
          <button key={tab.value} onClick={() => setCompany(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              company === tab.value ? 'bg-ink text-white' : 'text-ink-muted hover:bg-pill hover:text-ink'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1 bg-white border border-line rounded-xl p-1 mb-5 w-fit">
        {viewTabs.map(tab => (
          <button key={tab.value} onClick={() => setView(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === tab.value ? 'bg-pill text-ink' : 'text-ink-muted hover:bg-pill hover:text-ink'
            }`}>
            {t(tab.labelKey, locale)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : (
        <>
          {view === 'dashboard' && (
            <Dashboard licenses={licenses} subscriptions={subscriptions} company={company} />
          )}

          {view === 'licenses' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <input className="border rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder={t('licenses.search.license_ph', locale)} value={licSearch} onChange={e => setLicSearch(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={() => setPlanManagerOpen(true)}
                    className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200">
                    {t('licenses.plan.manage', locale)}
                  </button>
                  <button onClick={() => setLicModal({ open: true })}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                    {t('licenses.add_account', locale)}
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm min-w-max">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      {(['account_id', 'display_name'] as LicSortCol[]).map(col => {
                        const labels: Record<string, string> = { account_id: 'Account ID', display_name: 'Display Name' }
                        const active = licSort.col === col
                        return (
                          <th key={col} onClick={() => toggleLicSort(col)}
                            className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 select-none">
                            <span className="flex items-center gap-1">
                              {labels[col]}
                              <span className={active ? 'text-blue-500' : 'text-gray-300'}>
                                {active ? (licSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                              </span>
                            </span>
                          </th>
                        )
                      })}
                      <th className="px-4 py-3 text-left">Email</th>
                      {(['account_type', 'license_plan'] as LicSortCol[]).map(col => {
                        const labels: Record<string, string> = { account_type: 'Type', license_plan: 'Plan' }
                        const active = licSort.col === col
                        return (
                          <th key={col} onClick={() => toggleLicSort(col)}
                            className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 select-none">
                            <span className="flex items-center gap-1">
                              {labels[col]}
                              <span className={active ? 'text-blue-500' : 'text-gray-300'}>
                                {active ? (licSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                              </span>
                            </span>
                          </th>
                        )
                      })}
                      <th className="px-4 py-3 text-left">Company</th>
                      <th className="px-4 py-3 text-left">{t('licenses.col.owner', locale)}</th>
                      <th onClick={() => toggleLicSort('monthly_cost_cad')}
                        className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100 select-none">
                        <span className="flex items-center justify-end gap-1">
                          {t('licenses.col.monthly_cost', locale)}
                          <span className={licSort.col === 'monthly_cost_cad' ? 'text-blue-500' : 'text-gray-300'}>
                            {licSort.col === 'monthly_cost_cad' ? (licSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </span>
                      </th>
                      <th onClick={() => toggleLicSort('status')}
                        className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 select-none">
                        <span className="flex items-center gap-1">
                          Status
                          <span className={licSort.col === 'status' ? 'text-blue-500' : 'text-gray-300'}>
                            {licSort.col === 'status' ? (licSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedLic.map(r => (
                      <tr
                        key={r.id}
                        className="hover:bg-gray-50 cursor-context-menu"
                        onContextMenu={e => {
                          e.preventDefault()
                          setRowMenu({ type: 'license', item: r, x: e.clientX, y: e.clientY })
                        }}>
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.account_id}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{r.display_name ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{r.email_address ?? '—'}</td>
                        <td className="px-4 py-2"><Badge label={r.account_type} color={accountTypeColor(r.account_type)} /></td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{r.license_plan ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{r.company ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {r.employee_id
                            ? (employees.find(e => e.id === r.employee_id)?.name ?? r.employee_id)
                            : <span className="text-gray-300">{t('common.unlinked', locale)}</span>
                          }
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {r.account_type === 'Individual' ? `$${r.monthly_cost_cad.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-2"><Badge label={r.status} color={statusColor(r.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedLic.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{t('common.no_results', locale)}</p>}
              </div>
            </div>
          )}

          {view === 'subscriptions' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <input className="border rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder={t('licenses.search.sub_ph', locale)} value={subSearch} onChange={e => setSubSearch(e.target.value)} />
                <button onClick={() => setSubModal({ open: true })}
                  className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">
                  {t('licenses.add_sub', locale)}
                </button>
              </div>
              <div className="bg-white rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm min-w-max">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Vendor</th>
                      <th className="px-4 py-3 text-left">Product</th>
                      <th className="px-4 py-3 text-left">Plan</th>
                      <th className="px-4 py-3 text-left">Billing</th>
                      <th className="px-4 py-3 text-left">{t('licenses.col.billing_date', locale)}</th>
                      <th className="px-4 py-3 text-right">{t('licenses.col.cost_cad', locale)}</th>
                      <th className="px-4 py-3 text-left">Company</th>
                      <th className="px-4 py-3 text-left">Owner</th>
                      <th className="px-4 py-3 text-left">{t('licenses.col.users', locale)}</th>
                      <th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtSub.map(r => {
                      const soon = isRenewingSoon(r)
                      const linked = r.subscription_employees ?? []
                      const count = linked.length
                      const dateStr = r.billing_day
                        ? (locale === 'ko' ? `매월 ${r.billing_day}일` : `every ${r.billing_day}th`)
                        : (r.renewal_date ?? '—')
                      const nextDate = r.billing_day ? nextBillingDate(r.billing_day) : null
                      return (
                        <tr
                          key={r.id}
                          className={`hover:bg-gray-50 cursor-context-menu ${soon ? 'bg-amber-50' : ''}`}
                          onContextMenu={e => {
                            e.preventDefault()
                            setRowMenu({ type: 'subscription', item: r, x: e.clientX, y: e.clientY })
                          }}>
                          <td className="px-4 py-2 font-medium text-gray-800">{r.vendor ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-700">{r.product ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{r.plan_name ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{r.billing_cycle ?? '—'}</td>
                          <td className="px-4 py-2 text-xs">
                            <span className={soon ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                              {dateStr}{soon && ' ⚠'}
                            </span>
                            {nextDate && <span className="block text-gray-400 text-xs">{t('licenses.next_billing_label', locale)} {nextDate}</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className="font-medium">${(r.cost_cad ?? 0).toFixed(2)}</span>
                            {count > 1 && (
                              <span className="block text-xs text-violet-500">${costPerPerson(r).toFixed(2)} / person</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{r.company ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{r.owner ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">
                            {count === 0
                              ? <span className="text-gray-300">{t('common.none', locale)}</span>
                              : (
                                <div className="max-w-56 whitespace-normal leading-5">
                                  {linked
                                    .map(se => getSubEmployeeName(se.employees as any, se.employee_id, employees))
                                    .filter((name): name is string => !!name)
                                    .join(', ')}
                                </div>
                              )
                            }
                          </td>
                          <td className="px-4 py-2"><Badge label={r.status} color={statusColor(r.status)} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filtSub.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{t('common.no_results', locale)}</p>}
              </div>
            </div>
          )}
        </>
      )}

      {licModal.open && (
        <LicenseModal
          initial={licModal.item} clone={licModal.clone}
          employees={employees} emailPlans={emailPlans}
          nextAccountId={computeNextAccountId(licenses)}
          onClose={() => setLicModal({ open: false })}
          onSave={() => { setLicModal({ open: false }); load() }}
        />
      )}
      {planManagerOpen && (
        <PlanManagerModal
          onClose={() => setPlanManagerOpen(false)}
          onChanged={load}
        />
      )}
      {subModal.open && (
        <SubModal initial={subModal.item} clone={subModal.clone} employees={employees}
          onClose={() => setSubModal({ open: false })}
          onSave={() => { setSubModal({ open: false }); load() }} />
      )}
      {deleteTarget && (
        <DeleteDialog onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      )}
      {rowMenu && (
        <div
          ref={rowMenuRef}
          style={{ position: 'fixed', top: rowMenu.y, left: rowMenu.x, zIndex: 60 }}
          className="bg-white border border-line rounded-xl shadow-xl py-1 min-w-32">
          <button
            onClick={() => {
              if (rowMenu.type === 'license') setLicModal({ open: true, item: rowMenu.item as License })
              else setSubModal({ open: true, item: rowMenu.item as Subscription })
              setRowMenu(null)
            }}
            className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-pill">
            {t('common.edit', locale)}
          </button>
          <button
            onClick={() => {
              if (rowMenu.type === 'license') setLicModal({ open: true, clone: rowMenu.item as License })
              else setSubModal({ open: true, clone: rowMenu.item as Subscription })
              setRowMenu(null)
            }}
            className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-pill">
            {t('common.clone', locale)}
          </button>
          <button
            onClick={() => {
              setDeleteTarget({ type: rowMenu.type, id: rowMenu.item.id })
              setRowMenu(null)
            }}
            className="w-full px-3 py-2 text-left text-sm text-signal-neg hover:bg-pill">
            {t('common.delete', locale)}
          </button>
        </div>
      )}
      </div>
    </div>
  )
}

