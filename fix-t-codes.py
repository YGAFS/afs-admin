#!/usr/bin/env python3
"""Run in Codespaces terminal: python fix-t-codes.py"""
import os

def patch(path, replacements):
    if not os.path.exists(path):
        print(f'  SKIP (not found): {path}'); return
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    for old, new in replacements:
        if old not in content:
            print(f'  WARNING: pattern not found in {path}:\n    {old[:80]}')
            continue
        content = content.replace(old, new)
    if content == original:
        print(f'  no changes: {path}')
    else:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'  patched:    {path}')

# ─── AttendanceGrid.tsx ───────────────────────────────────────────────────────
patch('app/hr/components/AttendanceGrid.tsx', [
    # 1. LeaveCode type
    (
        "type LeaveCode = 'L'|'L1'|'L2'|'L3'|'S'|'S1'|'S2'|'S3'|'W'|'T'|'B'",
        "type LeaveCode = 'L'|'L1'|'L2'|'L3'|'S'|'S1'|'S2'|'S3'|'W'|'T'|'T1'|'T2'|'T3'|'B'",
    ),
    # 2. CODE_COLOR — add T1/T2/T3
    (
        "  W:  'bg-blue-200  text-blue-800',   T:  'bg-gray-200  text-gray-700',\n  B:  'bg-gray-100  text-gray-500',",
        "  W:  'bg-blue-200  text-blue-800',   T:  'bg-gray-200  text-gray-700',\n  T1: 'bg-gray-100  text-gray-600',   T2: 'bg-gray-100  text-gray-600',\n  T3: 'bg-gray-50   text-gray-500',   B:  'bg-gray-100  text-gray-500',",
    ),
    # 3. CODE_OPTIONS — add T1/T2/T3 after T
    (
        "  { code: 'T',  label: 'T  — Unpaid Time Off'            },\n  { code: 'B',  label: 'B  — 공휴일'                     },",
        "  { code: 'T',  label: 'T  — Unpaid 전일'                },\n  { code: 'T1', label: 'T1 — Unpaid 오전 반일'           },\n  { code: 'T2', label: 'T2 — Unpaid 오후 반일'           },\n  { code: 'T3', label: 'T3 — Unpaid 시간', needsHours: true },\n  { code: 'B',  label: 'B  — 공휴일'                     },",
    ),
])

# ─── EmployeeSearch.tsx ───────────────────────────────────────────────────────
patch('app/hr/components/EmployeeSearch.tsx', [
    # Count T1/T2/T3 in toil (T1/T2 = 0.5, T/T3 = 1)
    (
        "else if (e.leave_code === 'T')                        { s.toil += 1; m[mo].toil += 1 }",
        "else if (['T','T1','T2','T3'].includes(e.leave_code)) { const td = ['T1','T2'].includes(e.leave_code) ? 0.5 : 1; s.toil += td; m[mo].toil += td }",
    ),
])

print('\nDone.')
print('  app/hr/components/AttendanceGrid.tsx')
print('  app/hr/components/EmployeeSearch.tsx')
print()
print('SQL to run in Supabase SQL Editor:')
print("""
-- Update CHECK constraint to allow T1/T2/T3
ALTER TABLE leave_entries DROP CONSTRAINT IF EXISTS leave_entries_leave_code_check;
ALTER TABLE leave_entries ADD CONSTRAINT leave_entries_leave_code_check
  CHECK (leave_code IN ('L','L1','L2','L3','S','S1','S2','S3','W','T','T1','T2','T3','B','P','C'));
""")
