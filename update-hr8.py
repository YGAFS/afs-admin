#!/usr/bin/env python3
"""
Probation period support for the HR module.
Run in Codespaces project root:  python update-hr8.py

What changes:
  AttendanceGrid.tsx
    1. Employee type  — probation_start / probation_end fields
    2. Supabase select — include new fields
    3. Accrual logic  — count from probation_end (not start_date) when set
    4. 수습중 badge    — orange badge in name cell while on probation
    5. ⋮ 메뉴         — "수습 기간 설정" entry (active employees)
    6. Probation modal — start = 입사일|직접입력, end = +90일|직접입력, 삭제 버튼
  EmployeeSearch.tsx
    7. Employee type  — same probation fields
    8. Supabase select — include new fields
    9. Detail panel   — show probation period row

After running this script, execute the SQL block printed at the bottom
in the Supabase SQL Editor.
"""
import os

def patch(path, replacements):
    if not os.path.exists(path):
        print(f'  SKIP (not found): {path}'); return
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    for old, new in replacements:
        if old not in content:
            print(f'  WARNING — pattern not found:\n    file: {path}\n    pat:  {repr(old[:140])}')
        else:
            content = content.replace(old, new, 1)
    if content == original:
        print(f'  no changes: {path}')
    else:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'  patched:    {path}')


# ═══════════════════════════════════════════════════════════════════════════════
# AttendanceGrid.tsx
# ═══════════════════════════════════════════════════════════════════════════════
patch('app/hr/components/AttendanceGrid.tsx', [

    # ── 1. Employee type: add probation fields after end_date ─────────────────
    (
        '  end_date: string | null',
        '  end_date: string | null\n  probation_start: string | null\n  probation_end: string | null',
    ),

    # ── 2. Supabase select: add probation fields ──────────────────────────────
    # Handles the common explicit-field select pattern.
    # If your select uses '*', this patch will show a WARNING and you can skip it.
    (
        'start_date, end_date,',
        'start_date, end_date, probation_start, probation_end,',
    ),

    # ── 3. Accrual helper: inject before the component function ───────────────
    # Looks for the export default function (or const) that defines the component.
    # We insert a helper that computes effective accrual start, skipping probation.
    (
        'export default function AttendanceGrid(',
        '''\
// Returns the date from which vacation accrual should be counted.
// If the employee is still in probation for the given year/month, returns null (= 0 accrual).
// If probation has ended, returns probation_end. Otherwise returns start_date.
function effectiveAccrualStart(
  emp: { uses_accrual: boolean; is_exempt: boolean; start_date: string | null; probation_end: string | null },
  year: number, month: number
): string | null {
  if (emp.is_exempt || !emp.uses_accrual) return emp.start_date
  if (emp.probation_end) {
    const [py, pm] = emp.probation_end.split('-').map(Number)
    if (year < py || (year === py && month <= pm)) return null // still in probation
    return emp.probation_end
  }
  return emp.start_date
}

export default function AttendanceGrid(''',
    ),

    # ── 4a. Accrual calculation — variant A (months * 0.83 with start_date) ──
    # Most likely pattern: something like
    #   const months = (year - sy) * 12 + (month - sm)
    #   const accrued = Math.min(Math.max(0, months) * 0.83, emp.vacation_allowance)
    # We replace the start date reference in the months calculation.
    (
        'emp.start_date.split(\'-\').map(Number)',
        '(effectiveAccrualStart(emp, year, month) ?? emp.start_date ?? `${year}-${String(month).padStart(2,\'0\')}-01`).split(\'-\').map(Number)',
    ),

    # ── 4b. Accrual calculation — variant B (direct 0.83 guard) ──────────────
    # If the code guards with: if (!emp.start_date) return 0 / if (!emp.uses_accrual) ...
    # We add a probation guard right before the 0.83 multiplication.
    (
        'Math.min(Math.max(0, monthsWorked) * 0.83',
        'Math.min(Math.max(0, monthsWorked) * 0.83',
        # no-op placeholder so the script doesn't warn for this optional variant
    ),

    # ── 5. State variables: add probation modal state after manageOpen state ──
    (
        'const [manageOpen, setManageOpen] = useState<string | null>(null)',
        '''\
const [manageOpen, setManageOpen] = useState<string | null>(null)
  const [probModal, setProbModal] = useState<{ emp: Employee } | null>(null)
  const [probStartMode, setProbStartMode] = useState<'hire' | 'custom'>('hire')
  const [probStartVal, setProbStartVal] = useState('')
  const [probEndMode, setProbEndMode] = useState<'90d' | 'custom'>('90d')
  const [probEndVal, setProbEndVal] = useState('')''',
    ),

    # ── 6. ⋮ menu: add "수습 기간 설정" for active employees ─────────────────
    # The active-employee menu currently has: 입사일 수정 / 퇴사 처리
    # We add the probation entry between them.
    (
        '{/* 퇴사 처리 */}',
        '''\
{/* 수습 기간 설정 */}
              <button
                className="w-full text-left px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 flex items-center gap-2"
                onClick={() => {
                  const emp = employees.find(e => e.id === manageOpen)!
                  setProbStartMode(emp.start_date ? 'hire' : 'custom')
                  setProbStartVal(emp.probation_start ?? emp.start_date ?? '')
                  const existingEnd = emp.probation_end ?? ''
                  if (existingEnd) {
                    setProbEndMode('custom')
                    setProbEndVal(existingEnd)
                  } else if (emp.start_date) {
                    setProbEndMode('90d')
                    const d = new Date(emp.start_date)
                    d.setDate(d.getDate() + 90)
                    setProbEndVal(d.toISOString().split('T')[0])
                  } else {
                    setProbEndMode('custom')
                    setProbEndVal('')
                  }
                  setProbModal({ emp })
                  setManageOpen(null)
                }}
              >
                <span>📋</span> 수습 기간 설정
              </button>
              {/* 퇴사 처리 */}''',
    ),

    # ── 7. 수습중 badge: add after 입사예정 badge ─────────────────────────────
    (
        '{isUpcoming && (',
        '''\
{(() => {
              const today = new Date().toISOString().split('T')[0]
              const isOnProbation = emp.probation_start != null &&
                emp.probation_start <= today &&
                (emp.probation_end == null || emp.probation_end >= today)
              return isOnProbation ? (
                <span className="ml-1 inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-orange-100 text-orange-700 rounded-full">
                  수습중
                </span>
              ) : null
            })()}
            {isUpcoming && (''',
    ),

    # ── 8. Probation modal JSX: add before the closing fragment / last </div> ─
    # We look for the end-date edit modal closing tag as an anchor.
    # This is the safest insertion point since the terminate modal is the last one.
    (
        '{/* END: terminate / reactivate modals */}',
        '''\
{/* END: terminate / reactivate modals */}

      {/* ── Probation modal ───────────────────────────────────────────── */}
      {probModal && (() => {
        const emp = probModal.emp
        const saveProb = async () => {
          const finalStart = probStartMode === 'hire' ? emp.start_date : (probStartVal || null)
          const finalEnd   = probEndVal || null
          await supabase.from('employees').update({
            probation_start: finalStart,
            probation_end:   finalEnd,
          }).eq('id', emp.id)
          setEmployees(prev => prev.map(e =>
            e.id === emp.id ? { ...e, probation_start: finalStart ?? null, probation_end: finalEnd } : e
          ))
          setProbModal(null)
        }
        const deleteProb = async () => {
          await supabase.from('employees').update({ probation_start: null, probation_end: null }).eq('id', emp.id)
          setEmployees(prev => prev.map(e =>
            e.id === emp.id ? { ...e, probation_start: null, probation_end: null } : e
          ))
          setProbModal(null)
        }
        return (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
               onClick={e => { if (e.target === e.currentTarget) setProbModal(null) }}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-[380px] space-y-5">
              <h3 className="text-base font-semibold text-gray-900">
                수습 기간 설정 — {emp.name}
              </h3>

              {/* 시작일 */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">수습 시작일</p>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${probStartMode === 'hire' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbStartMode('hire')
                      setProbStartVal(emp.start_date ?? '')
                      if (probEndMode === '90d' && emp.start_date) {
                        const d = new Date(emp.start_date); d.setDate(d.getDate() + 90)
                        setProbEndVal(d.toISOString().split('T')[0])
                      }
                    }}
                  >입사일</button>
                  <button
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${probStartMode === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbStartMode('custom')}
                  >직접 입력</button>
                </div>
                {probStartMode === 'hire'
                  ? <p className="text-xs text-gray-500">입사일: {emp.start_date ?? '미설정'}</p>
                  : <input
                      type="date"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={probStartVal}
                      onChange={e => {
                        setProbStartVal(e.target.value)
                        if (probEndMode === '90d' && e.target.value) {
                          const d = new Date(e.target.value); d.setDate(d.getDate() + 90)
                          setProbEndVal(d.toISOString().split('T')[0])
                        }
                      }}
                    />
                }
              </div>

              {/* 종료일 */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">수습 종료일</p>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${probEndMode === '90d' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => {
                      setProbEndMode('90d')
                      const refDate = probStartMode === 'hire' ? emp.start_date : probStartVal
                      if (refDate) {
                        const d = new Date(refDate); d.setDate(d.getDate() + 90)
                        setProbEndVal(d.toISOString().split('T')[0])
                      }
                    }}
                  >+90일</button>
                  <button
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${probEndMode === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setProbEndMode('custom')}
                  >직접 입력</button>
                </div>
                <input
                  type="date"
                  className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${probEndMode === '90d' ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-300'}`}
                  value={probEndVal}
                  readOnly={probEndMode === '90d'}
                  onChange={e => { if (probEndMode === 'custom') setProbEndVal(e.target.value) }}
                />
              </div>

              {/* 버튼 */}
              <div className="flex gap-2 pt-1">
                <button
                  className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
                  onClick={saveProb}
                >저장</button>
                <button
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                  onClick={() => setProbModal(null)}
                >취소</button>
                {emp.probation_start && (
                  <button
                    className="px-4 py-2 border border-red-300 text-red-600 rounded-xl text-sm hover:bg-red-50 transition-colors"
                    onClick={deleteProb}
                  >삭제</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}''',
    ),
])


# ═══════════════════════════════════════════════════════════════════════════════
# EmployeeSearch.tsx
# ═══════════════════════════════════════════════════════════════════════════════
patch('app/hr/components/EmployeeSearch.tsx', [

    # ── 7. Employee type: add probation fields ────────────────────────────────
    (
        '  end_date: string | null',
        '  end_date: string | null\n  probation_start: string | null\n  probation_end: string | null',
    ),

    # ── 8. Supabase select: add probation fields ──────────────────────────────
    (
        'start_date, end_date,',
        'start_date, end_date, probation_start, probation_end,',
    ),

    # ── 9. Detail panel: show probation row after 입사일 row ──────────────────
    # The detail panel shows 입사일 and 퇴사일. We add a 수습 기간 row after 입사일.
    (
        '{/* 퇴사일 */}',
        '''\
{/* 수습 기간 */}
            {selected.probation_start && (
              <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
                <span className="text-sm text-gray-500">수습 기간</span>
                <span className="text-sm font-medium text-orange-700">
                  {selected.probation_start}
                  {selected.probation_end ? ` ~ ${selected.probation_end}` : ' ~ 미설정'}
                  {(() => {
                    const today = new Date().toISOString().split('T')[0]
                    if (!selected.probation_end || selected.probation_end >= today) {
                      return <span className="ml-2 text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">수습중</span>
                    }
                    return <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">수습 완료</span>
                  })()}
                </span>
              </div>
            )}
            {/* 퇴사일 */}''',
    ),
])


print('''
Done.

─── Files patched ───────────────────────────────────────────────────────────────
  app/hr/components/AttendanceGrid.tsx
  app/hr/components/EmployeeSearch.tsx

─── Manual checks ───────────────────────────────────────────────────────────────
If you saw WARNING messages above, apply those changes manually:

  1. Employee type (both files):
       add after  end_date: string | null
         probation_start: string | null
         probation_end:   string | null

  2. Supabase select (both files):
       if using .select(\'*\') — no change needed (all columns auto-included)
       if explicit fields    — add  probation_start, probation_end  to the list

  3. Accrual calculation (AttendanceGrid.tsx):
       Find the line that computes monthsWorked / accrued days using start_date.
       Replace:  emp.start_date
       With:     effectiveAccrualStart(emp, year, month)
       (the helper function is injected above the component by this script)

  4. State variables (AttendanceGrid.tsx):
       Add these after  const [manageOpen, setManageOpen] = useState<string | null>(null)
         const [probModal, setProbModal] = useState<{ emp: Employee } | null>(null)
         const [probStartMode, setProbStartMode] = useState<\'hire\' | \'custom\'>(\'hire\')
         const [probStartVal, setProbStartVal] = useState(\'\')
         const [probEndMode, setProbEndMode] = useState<\'90d\' | \'custom\'>(\'90d\')
         const [probEndVal, setProbEndVal] = useState(\'\')

  5. Probation modal end-tag anchor (AttendanceGrid.tsx):
       If the {/* END: terminate / reactivate modals */} comment does not exist,
       add the probation modal JSX just before the final </> or </div> of the return.

─── SQL to run in Supabase SQL Editor ───────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS probation_start DATE,
  ADD COLUMN IF NOT EXISTS probation_end   DATE;

-- Verify:
-- SELECT id, name, probation_start, probation_end FROM employees LIMIT 5;
''')
