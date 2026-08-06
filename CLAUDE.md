# AFS Admin — Claude Context

## Project Overview

HR attendance management system for AFS / TNT / ZFS companies.
Built with Next.js 16 (App Router), Supabase, Tailwind CSS v4, TypeScript.
Production URL: **https://hr.afstrans.co**

---

## Deployment — CRITICAL

**Always deploy via Vercel CLI, NOT just `git push`.**

```powershell
git add <files>
git commit -m "message"
git push origin main
npx vercel deploy --prod
```

Vercel is wired to CLI (`npx vercel deploy --prod`), not GitHub auto-deploy.
Pushing to GitHub alone does NOT update the live site.

---

## Shell — PowerShell

This project runs on Windows / PowerShell. Use PowerShell heredoc for multiline git commit messages:

```powershell
# CORRECT — PowerShell here-string
git commit -m "Single line message"

# For multiline, use backtick newlines:
git commit -m "Title`n`nBody line 1`nBody line 2"
```

Do NOT use bash `cat <<'EOF'` — it causes parser errors in PowerShell.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/hr/[company]/page.tsx` | Main attendance page — contains email report modal, date picker, ContactMgr, `buildEmailBody`, `openMailto` |
| `app/hr/components/AttendanceGrid.tsx` | Attendance grid — leave codes, cell editing, upsert to Supabase |
| `app/hr/components/EmployeeSearch.tsx` | Employee panel — vacation accrual calc (daily basis: elapsed days / 365 × allowance) |
| `app/hr/page.tsx` | Company tab switcher (AFS / TNT / ZFS) |
| `lib/i18n.ts` | `t(key, locale)` — supports `'en'` and `'ko'` |
| `supabase/add_overtime_leave_code.sql` | SQL to add `'O'` to `leave_entries_leave_code_check` constraint — must be run manually in Supabase SQL Editor |

---

## Leave Codes

| Code | Description | Hours input |
|------|-------------|-------------|
| L | Paid Leave (연차) | No |
| L1 | Paid Leave AM Half | No |
| L2 | Paid Leave PM Half | No |
| L3 | Paid Leave Hourly | Yes |
| S | Sick Leave (병가) | No |
| S1–S3 | Sick variants | same pattern |
| W | WFH (재택) | No |
| W1–W3 | WFH variants | same pattern |
| T | Unpaid Leave | No |
| T1–T3 | Unpaid variants | same pattern |
| B | Holiday (공휴일) | No |
| O | Overtime (초과근무) | Yes — requires hours |
| C | Special Leave (특별휴가, company-granted e.g. 위문 휴가) — does NOT deduct from annual leave | No |

**O code**: Added in commit `eec61d1`. Supabase CHECK constraint must be updated via `supabase/add_overtime_leave_code.sql` before OT saves will work.

**C code + multi-status days**: A single day can now hold more than one leave code (e.g. AM Paid Leave + PM WFH) — `leave_entries` uniqueness is per `(employee_id, date, leave_code)` instead of `(employee_id, date)`. Requires `supabase/allow_multi_leave_per_day.sql` and `supabase/add_special_leave_code.sql` to be run manually before these saves will work.

---

## Supabase Tables

- **employees** — `id, company_id, name, start_date, end_date`
- **leave_entries** — `employee_id, date, leave_code, hours` — upserted on cell change; unique on `(employee_id, date, leave_code)`, so multiple codes per day are allowed
- **attendance_flags** — `employee_id, date, flag_type ('late'|'early_leave'), time, reason` — set via right-click on a day cell, independent of leave codes/notes; unique on `(employee_id, date, flag_type)`

`company_id` values: `'afs'`, `'tnt'`, `'zfs'`

---

## Per-User Section Access (`user_access` table)

Restricts which top-level sidebar sections (`/hr`, `/utilities`, `/licenses`, `/assets`, `/supplies`, `/admin`) a logged-in user can see and reach.

- Table: `user_access(email, allowed_sections text[])`. A user with **no row** (or `allowed_sections = null`) has **full access** — this is the default, so existing users are unaffected.
- Enforced client-side: `app/providers.tsx` fetches the row for the logged-in user's email on login and exposes `allowedSections` via `useAuth()`. `app/components/Sidebar.tsx` filters the nav list; `app/components/ConditionalLayout.tsx` redirects (and blanks the page while redirecting) if the current route's top-level segment isn't in `allowedSections`.
- **This is client-side only** — there is no `middleware.ts` and Supabase RLS on most tables is currently wide-open (`using (true)`) to any authenticated user. A restricted user cannot *see* other sections in the UI, but if the underlying tables' RLS policies allow it, direct API calls could still read/write that data. Treat this as UI-level restriction for trusted internal staff, not a hard security boundary — tighten RLS per-table if that's needed later.
- To restrict a user: insert/update a row in `user_access`, e.g. `allowed_sections = '{utilities}'` for Utility Dashboard only.
- **Creating the actual login account (Supabase Auth user + password) must be done manually** in the Supabase Dashboard → Authentication → Users — Claude will not create accounts or set passwords.

---

## Email Report Feature (`app/hr/[company]/page.tsx`)

### How it works
- 📧 button opens modal → user picks dates from calendar → chooses From/To contacts → preview → "Open Email Client"
- Uses `mailto:` link (no backend). Opens Outlook with pre-filled Subject + Body.
- **Do NOT `encodeURIComponent` the To email address** — it encodes `@` → `%40` which breaks Outlook parsing. Only encode `subject` and `body` params.

### Contact storage
- localStorage keys: `afs_email_senders`, `afs_email_recipients`
- Contacts must have full email format `user@domain.com` — validated before save

### Email format (always English)
```
Subject: Employee Leave Notification - Jun 9, Jun 10

Hi [recipient name],

The following employee is scheduled to be on leave on Jun 9 (Mon).

  • Employee Name - Paid Leave
  • Employee Name - Sick Leave (AM Half)

Please update your records accordingly.

Thank you.
```

### Leave code → email display
- L / L1-L3 → "Paid Leave" / "Paid Leave (AM Half)" etc.
- S / S1-S3 → "Sick Leave" / "Sick Leave (AM Half)" etc.
- T / T1-T3 → "Unpaid Leave" / "Unpaid Leave (AM Half)" etc.
- C → "Special Leave"
- **W, B, O → excluded from email (not reported)**

---

## Pending (manual actions required)

- [ ] Run `supabase/add_overtime_leave_code.sql` in Supabase SQL Editor to enable OT saves
- [ ] Run `supabase/allow_multi_leave_per_day.sql` in Supabase SQL Editor to enable multiple leave codes per day
- [ ] Run `supabase/add_special_leave_code.sql` in Supabase SQL Editor to enable the 'C' Special Leave code
- [ ] Run `supabase/add_vendor_location.sql` in Supabase SQL Editor to enable setting a Location on Vendors (`app/utilities/vendors/page.tsx`)
- [ ] Run `supabase/add_location_sort_order.sql` in Supabase SQL Editor to enable custom (contract-order) sorting of Locations, e.g. TNT: Cambridge, Biscayne, Pickering
- [ ] Run `supabase/add_user_access.sql` in Supabase SQL Editor to enable per-user section restriction (creates `user_access` table, also inserts the YG → Utility-only row)
- [ ] Create the Supabase Auth login (email + password) for `yungyeong.j@afstransco.com` manually in Supabase Dashboard → Authentication → Users
- [ ] Add ZFS employee data to Supabase `employees` table
