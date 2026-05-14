#!/usr/bin/env python3
"""
Run in Codespaces terminal: python fix-date-offset.py

Fixes timezone-caused date shift:
  new Date("2026-05-06").getDate()  →  returns 5 in UTC-7/8 timezones
  Fix: parse date string directly instead of via Date object
"""
import re, os

def patch(path, replacements):
    if not os.path.exists(path):
        print(f'  SKIP (not found): {path}')
        return
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    for old, new in replacements:
        content = content.replace(old, new)
    if content == original:
        print(f'  no changes: {path}')
    else:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'  patched:    {path}')

# ─── AttendanceGrid.tsx ───────────────────────────────────────────────────────
# Bug: new Date(e.date).getDate() returns wrong day in UTC-offset timezones
# Fix: parse the day directly from the ISO string "YYYY-MM-DD"
patch('app/hr/components/AttendanceGrid.tsx', [
    (
        # monthly leave map: "2026-05-06" → getDate() → 5 in UTC-7
        'lm[`${e.employee_id}_${new Date(e.date).getDate()}`]',
        'lm[`${e.employee_id}_${parseInt(e.date.split(\'-\')[2], 10)}`]',
    ),
])

# ─── EmployeeSearch.tsx ───────────────────────────────────────────────────────
# Bug: new Date(e.date).getMonth() + 1 returns wrong month at month boundaries
# Fix: parse month directly from ISO string
patch('app/hr/components/EmployeeSearch.tsx', [
    (
        'const mo = new Date(e.date).getMonth() + 1',
        'const mo = parseInt(e.date.split(\'-\')[1], 10)',
    ),
])

print('\nDone. Refresh the browser to verify.')
