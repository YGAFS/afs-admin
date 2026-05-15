'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────

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
  employees: { name: string } | null
}

type SubEmployee = { employee_id: string; employees: { name: string } | null }
type SubEmpRow = { subscription_id: string; employee_id: string; employees: { name: string } | null }

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
  employees: { name: string } | null
  subscription_employees: SubEmployee[]
}

type Employee = { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPANIES = ['AFS', 'TNT', 'ZFS']
const STATUS_OPTIONS = ['Active', 'Inactive']
const ACCOUNT_TYPES = ['Individual', 'Shared']
const BILLING_CYCLES = ['Monthly', 'Annual', 'One-time']

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 매월 N일 기준으로 오늘 이후의 다음 결제일 */
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

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
}

function statusColor(s: string) {
  return s === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
}

function accountTypeColor(t: string) {
  return t === 'Shared' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
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
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-80">
        <p className="text-gray-800 font-medium mb-1">정말 삭제하시겠습니까?</p>
        <p className="text-gray-500 text-sm mb-5">이 작업은 되돌릴 수 없습니다.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">취소</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">삭제</button>
        </div>
      </div>
    </div>
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

function LicenseModal({ initial, clone, employees, onClose, onSave }: {
  initial?: License; clone?: License; employees: Employee[]; onClose: () => void; onSave: () => void
}) {
  const src = initial ?? clone
  const [form, setForm] = useState<LicenseForm>(src ? {
    account_id: initial ? (src.account_id ?? '') : '',  // 복제 시 ID는 비움
    display_name: src.display_name ?? '',
    email_address: initial ? (src.email_address ?? '') : '',  // 복제 시 이메일도 비움
    alias: src.alias ?? '',
    account_type: src.account_type ?? 'Individual',
    license_plan: src.license_plan ?? '',
    monthly_cost_cad: String(src.monthly_cost_cad ?? 0),
    status: src.status ?? 'Active',
    company: src.company ?? '',
    employee_id: src.employee_id ?? '',
    notes: src.notes ?? '',
  } : emptyLicenseForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof LicenseForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleSubmit() {
    if (!form.account_id.trim()) { setError('Account ID는 필수입니다.'); return }
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

  return (
    <Modal title={initial ? 'M365 계정 편집' : clone ? 'M365 계정 복제' : 'M365 계정 추가'} onClose={onClose}>
      {error && <p className="text-red-500 text-xs mb-3 bg-red-50 p-2 rounded">{error}</p>}
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Account ID *"><input className={inputCls} value={form.account_id} onChange={set('account_id')} placeholder="A-001" /></Field>
        <Field label="Company">
          <select className={selectCls} value={form.company} onChange={set('company')}>
            <option value="">선택</option>
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Display Name"><input className={inputCls} value={form.display_name} onChange={set('display_name')} /></Field>
        <Field label="Email Address"><input className={inputCls} type="email" value={form.email_address} onChange={set('email_address')} /></Field>
        <Field label="Alias"><input className={inputCls} value={form.alias} onChange={set('alias')} /></Field>
        <Field label="Account Type">
          <select className={selectCls} value={form.account_type} onChange={set('account_type')}>
            {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="License Plan"><input className={inputCls} value={form.license_plan} onChange={set('license_plan')} placeholder="Microsoft 365 Business Basic" /></Field>
        <Field label="Monthly Cost (CAD)"><input className={inputCls} type="number" min="0" step="0.01" value={form.monthly_cost_cad} onChange={set('monthly_cost_cad')} /></Field>
        <Field label="Status">
          <select className={selectCls} value={form.status} onChange={set('status')}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Linked Employee">
          <select className={selectCls} value={form.employee_id} onChange={set('employee_id')}>
            <option value="">미연결</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea className={inputCls} rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">취소</button>
        <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? '저장 중…' : '저장'}
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
  const src = initial ?? clone
  const [form, setForm] = useState<SubForm>(src ? {
    sub_id: '',  // 항상 비움 (복제/신규 모두 새 ID)
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

  const cost = parseFloat(form.cost_cad) || 0
  const perPerson = form.employee_ids.length > 1 ? cost / form.employee_ids.length : null

  const billingDayNum = parseInt(form.billing_day)
  const nextDate = billingDayNum >= 1 && billingDayNum <= 31 ? nextBillingDate(billingDayNum) : null

  async function handleSubmit() {
    if (!form.vendor.trim() && !form.product.trim()) { setError('Vendor 또는 Product를 입력하세요.'); return }
    setSaving(true)

    const payload = {
      sub_id: form.sub_id || null,
      company: form.company || null,
      vendor: form.vendor || null,
      product: form.product || null,
      plan_name: form.plan_name || null,
      billing_cycle: form.billing_cycle || null,
      cost_cad: cost,
      billing_day: billingDayNum >= 1 && billingDayNum <= 31 ? billingDayNum : null,
      renewal_date: !form.billing_day && form.renewal_date ? form.renewal_date : null,
      owner: form.owner || null,
      status: form.status,
      notes: form.notes || null,
    }

    let subId: string
    if (initial) {
      const { error: err } = await supabase.from('subscriptions').update(payload).eq('id', initial.id)
      if (err) { setSaving(false); setError(err.message); return }
      subId = initial.id
    } else {
      const { data, error: err } = await supabase.from('subscriptions').insert(payload).select('id').single()
      if (err || !data) { setSaving(false); setError(err?.message ?? 'insert 실패'); return }
      subId = data.id
    }

    // 조인 테이블 갱신
    await supabase.from('subscription_employees').delete().eq('subscription_id', subId)
    if (form.employee_ids.length > 0) {
      await supabase.from('subscription_employees').insert(
        form.employee_ids.map(eid => ({ subscription_id: subId, employee_id: eid }))
      )
    }

    setSaving(false)
    onSave()
  }

  return (
    <Modal title={initial ? '구독 편집' : clone ? '구독 복제' : '구독 추가'} onClose={onClose}>
      {error && <p className="text-red-500 text-xs mb-3 bg-red-50 p-2 rounded">{error}</p>}
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Vendor *"><input className={inputCls} value={form.vendor} onChange={set('vendor')} placeholder="Adobe, Loadlink…" /></Field>
        <Field label="Product *"><input className={inputCls} value={form.product} onChange={set('product')} placeholder="Acrobat Reader…" /></Field>
        <Field label="Plan Name"><input className={inputCls} value={form.plan_name} onChange={set('plan_name')} /></Field>
        <Field label="Company">
          <select className={selectCls} value={form.company} onChange={set('company')}>
            <option value="">선택</option>
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Billing Cycle">
          <select className={selectCls} value={form.billing_cycle} onChange={set('billing_cycle')}>
            {BILLING_CYCLES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Cost (CAD)"><input className={inputCls} type="number" min="0" step="0.01" value={form.cost_cad} onChange={set('cost_cad')} /></Field>

        {/* 결제일 */}
        <div className="col-span-2 grid grid-cols-2 gap-x-3">
          <Field label="매월 결제일 (1~31)">
            <input
              className={inputCls}
              type="number" min="1" max="31"
              placeholder="예: 23 → 매월 23일"
              value={form.billing_day}
              onChange={set('billing_day')}
            />
            {nextDate && (
              <p className="text-xs text-blue-600 mt-1">다음 결제일: {nextDate}</p>
            )}
          </Field>
          <Field label="수동 갱신일 (결제일 없을 때)">
            <input
              className={`${inputCls} ${form.billing_day ? 'opacity-40' : ''}`}
              type="date"
              value={form.billing_day ? '' : form.renewal_date}
              onChange={set('renewal_date')}
              disabled={!!form.billing_day}
            />
          </Field>
        </div>

        <Field label="Owner (담당자)"><input className={inputCls} value={form.owner} onChange={set('owner')} /></Field>
        <Field label="Status">
          <select className={selectCls} value={form.status} onChange={set('status')}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Sub ID (선택)"><input className={inputCls} value={form.sub_id} onChange={set('sub_id')} placeholder="자동 생성 가능" /></Field>
      </div>

      {/* 다중 직원 연결 */}
      <Field label="Linked Employees (비용 분할)">
        <div className="border rounded-lg p-2 max-h-36 overflow-y-auto space-y-0.5 bg-gray-50">
          {employees.map(e => (
            <label key={e.id} className="flex items-center gap-2 cursor-pointer hover:bg-white px-2 py-1 rounded transition-colors">
              <input
                type="checkbox"
                className="rounded"
                checked={form.employee_ids.includes(e.id)}
                onChange={() => toggleEmployee(e.id)}
              />
              <span className="text-sm text-gray-700">{e.name}</span>
            </label>
          ))}
        </div>
        {perPerson !== null && (
          <p className="text-xs text-violet-600 mt-1.5 font-medium">
            {form.employee_ids.length}명 공유 → 인당 ${perPerson.toFixed(2)} CAD
          </p>
        )}
      </Field>

      <Field label="Notes"><textarea className={inputCls} rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">취소</button>
        <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? '저장 중…' : '저장'}
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
      {items.length === 0 && <p className="text-gray-400 text-sm">데이터 없음</p>}
    </div>
  )
}

function Dashboard({ licenses, subscriptions, company }: {
  licenses: License[]; subscriptions: Subscription[]; company: string
}) {
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
        <StatCard label="M365 활성 계정" value={String(activeLic.length)} sub={`전체 ${filtLic.length}개`} colorClass="border-blue-500" />
        <StatCard label="M365 월 비용" value={`$${licCost.toFixed(0)}`} sub="CAD · Individual 합계" colorClass="border-indigo-500" />
        <StatCard label="기타 구독" value={String(activeSub.length)} sub={`전체 ${filtSub.length}개`} colorClass="border-violet-500" />
        <StatCard label="기타 구독 월 환산" value={`$${subCostMonthly.toFixed(0)}`} sub="CAD / 월" colorClass="border-purple-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">M365 플랜별 활성 계정 수</h3>
          <BarList barColor="bg-blue-400" items={Object.entries(byPlan).sort((a,b)=>b[1]-a[1]).map(([label, value]) => ({ label, value, display: `${value}개` }))} />
        </div>
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">구독 서비스별 월 비용</h3>
          <BarList barColor="bg-violet-400" items={Object.entries(byVendor).sort((a,b)=>b[1]-a[1]).map(([label, value]) => ({ label, value, display: `$${value.toFixed(0)}` }))} />
        </div>
      </div>

      {soon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-semibold text-amber-800 text-sm mb-2">⚠ 30일 내 갱신 예정</h3>
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
        <span className="text-sm font-semibold text-gray-700">전체 월 구독 비용 합계 (M365 + 기타)</span>
        <span className="text-2xl font-bold text-gray-900">
          ${(licCost + subCostMonthly).toFixed(2)} <span className="text-sm font-normal text-gray-400">CAD / 월</span>
        </span>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ViewTab = 'dashboard' | 'licenses' | 'subscriptions'

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState('')
  const [view, setView] = useState<ViewTab>('dashboard')
  const [licSearch, setLicSearch] = useState('')
  const [subSearch, setSubSearch] = useState('')
  const [licModal, setLicModal] = useState<{ open: boolean; item?: License; clone?: License }>({ open: false })
  const [subModal, setSubModal] = useState<{ open: boolean; item?: Subscription; clone?: Subscription }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'license' | 'subscription'; id: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [
      { data: lic, error: licErr },
      { data: sub, error: subErr },
      { data: emp },
      { data: seRows },
    ] = await Promise.all([
      supabase.from('licenses')
        .select('id,account_id,display_name,email_address,alias,account_type,license_plan,monthly_cost_cad,status,company,employee_id,created_date,notes,employees(name)')
        .order('company'),
      // subscription_employees는 별도 쿼리로 분리 (중첩 employees join 충돌 방지)
      supabase.from('subscriptions')
        .select('id,sub_id,company,vendor,product,plan_name,billing_cycle,cost_cad,renewal_date,billing_day,employee_id,owner,status,notes,employees(name)')
        .order('vendor'),
      supabase.from('employees').select('id,name').order('name'),
      supabase.from('subscription_employees')
        .select('subscription_id,employee_id,employees(name)'),
    ])

    if (licErr) console.error('licenses query error:', licErr)
    if (subErr) console.error('subscriptions query error:', subErr)

    // subscription_employees를 각 구독에 병합
    const seMap: Record<string, SubEmployee[]> = {}
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
    return matchCo && (!q || [l.display_name, l.email_address, l.account_id, l.employees?.name].some(v => v?.toLowerCase().includes(q)))
  })

  const filtSub = subscriptions.filter(s => {
    const matchCo = !company || s.company === company
    const q = subSearch.toLowerCase()
    return matchCo && (!q || [s.vendor, s.product, s.plan_name, s.owner].some(v => v?.toLowerCase().includes(q)))
  })

  const companyTabs = [{ label: '전체', value: '' }, ...COMPANIES.map(c => ({ label: c, value: c }))]
  const viewTabs: { label: string; value: ViewTab }[] = [
    { label: '대시보드', value: 'dashboard' },
    { label: 'M365 계정', value: 'licenses' },
    { label: '기타 구독', value: 'subscriptions' },
  ]

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">구독 통합 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">M365 계정 및 기타 구독 서비스 관리</p>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {companyTabs.map(tab => (
          <button key={tab.value} onClick={() => setCompany(tab.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              company === tab.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex border-b border-gray-200 mb-5">
        {viewTabs.map(tab => (
          <button key={tab.value} onClick={() => setView(tab.value)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              view === tab.value ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab.label}
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
                  placeholder="이름 / 이메일 검색…" value={licSearch} onChange={e => setLicSearch(e.target.value)} />
                <button onClick={() => setLicModal({ open: true })}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                  + 계정 추가
                </button>
              </div>
              <div className="bg-white rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm min-w-max">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Account ID</th>
                      <th className="px-4 py-3 text-left">Display Name</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Plan</th>
                      <th className="px-4 py-3 text-left">Company</th>
                      <th className="px-4 py-3 text-left">담당자</th>
                      <th className="px-4 py-3 text-right">월 비용</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtLic.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.account_id}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{r.display_name ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{r.email_address ?? '—'}</td>
                        <td className="px-4 py-2"><Badge label={r.account_type} color={accountTypeColor(r.account_type)} /></td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{r.license_plan ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{r.company ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{r.employees?.name ?? <span className="text-gray-300">미연결</span>}</td>
                        <td className="px-4 py-2 text-right font-medium">
                          {r.account_type === 'Individual' ? `$${r.monthly_cost_cad.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-2"><Badge label={r.status} color={statusColor(r.status)} /></td>
                        <td className="px-4 py-2">
                          <div className="flex gap-2">
                            <button onClick={() => setLicModal({ open: true, item: r })} className="text-xs text-blue-500 hover:underline">편집</button>
                            <button onClick={() => setLicModal({ open: true, clone: r })} className="text-xs text-gray-400 hover:underline">복제</button>
                            <button onClick={() => setDeleteTarget({ type: 'license', id: r.id })} className="text-xs text-red-400 hover:underline">삭제</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtLic.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">결과 없음</p>}
              </div>
            </div>
          )}

          {view === 'subscriptions' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <input className="border rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Vendor / Product 검색…" value={subSearch} onChange={e => setSubSearch(e.target.value)} />
                <button onClick={() => setSubModal({ open: true })}
                  className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">
                  + 구독 추가
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
                      <th className="px-4 py-3 text-left">결제일</th>
                      <th className="px-4 py-3 text-right">비용 (CAD)</th>
                      <th className="px-4 py-3 text-left">Company</th>
                      <th className="px-4 py-3 text-left">Owner</th>
                      <th className="px-4 py-3 text-left">사용자</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtSub.map(r => {
                      const soon = isRenewingSoon(r)
                      const linked = r.subscription_employees ?? []
                      const count = linked.length
                      const dateStr = r.billing_day
                        ? `매월 ${r.billing_day}일`
                        : (r.renewal_date ?? '—')
                      const nextDate = r.billing_day ? nextBillingDate(r.billing_day) : null
                      return (
                        <tr key={r.id} className={`hover:bg-gray-50 ${soon ? 'bg-amber-50' : ''}`}>
                          <td className="px-4 py-2 font-medium text-gray-800">{r.vendor ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-700">{r.product ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{r.plan_name ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{r.billing_cycle ?? '—'}</td>
                          <td className="px-4 py-2 text-xs">
                            <span className={soon ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                              {dateStr}{soon && ' ⚠'}
                            </span>
                            {nextDate && <span className="block text-gray-400 text-xs">다음: {nextDate}</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className="font-medium">${(r.cost_cad ?? 0).toFixed(2)}</span>
                            {count > 1 && (
                              <span className="block text-xs text-violet-500">인당 ${costPerPerson(r).toFixed(2)}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{r.company ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{r.owner ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">
                            {count === 0
                              ? <span className="text-gray-300">없음</span>
                              : count === 1
                                ? linked[0].employees?.name ?? '—'
                                : (
                                  <span title={linked.map(se => se.employees?.name ?? '?').join(', ')}>
                                    {linked[0].employees?.name} 외 {count - 1}명
                                  </span>
                                )
                            }
                          </td>
                          <td className="px-4 py-2"><Badge label={r.status} color={statusColor(r.status)} /></td>
                          <td className="px-4 py-2">
                            <div className="flex gap-2">
                              <button onClick={() => setSubModal({ open: true, item: r })} className="text-xs text-blue-500 hover:underline">편집</button>
                              <button onClick={() => setSubModal({ open: true, clone: r })} className="text-xs text-gray-400 hover:underline">복제</button>
                              <button onClick={() => setDeleteTarget({ type: 'subscription', id: r.id })} className="text-xs text-red-400 hover:underline">삭제</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filtSub.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">결과 없음</p>}
              </div>
            </div>
          )}
        </>
      )}

      {licModal.open && (
        <LicenseModal initial={licModal.item} clone={licModal.clone} employees={employees}
          onClose={() => setLicModal({ open: false })}
          onSave={() => { setLicModal({ open: false }); load() }} />
      )}
      {subModal.open && (
        <SubModal initial={subModal.item} clone={subModal.clone} employees={employees}
          onClose={() => setSubModal({ open: false })}
          onSave={() => { setSubModal({ open: false }); load() }} />
      )}
      {deleteTarget && (
        <DeleteDialog onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      )}
    </div>
  )
}
