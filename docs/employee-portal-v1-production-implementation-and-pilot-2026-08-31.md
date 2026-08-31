# Employee Portal v1 Production Implementation and Pilot Record

Date: 2026-08-31  
Production: https://hr.afstransco.com  
Pilot account: `yungyeong.j@afstransco.com`

## Scope and safety baseline

Employee Portal v1 is read-only. Browser clients do not query HR tables directly. Requests resolve the authenticated session through the active `user_profiles` row and `employee_user_links`, then perform the HR lookup server-side with the Supabase service role.

The existing security baseline was preserved. No RLS, table privileges, Auth users, roles, section access, company roles, HR data, or PTO policy semantics were changed by the Portal implementation. No Portal UI was implemented.

## Implemented backend

- `lib/hr/pto.ts` — reusable pure PTO calculation module using the canonical EmployeeSearch semantics.
- `lib/server/employeePortalAuthorization.ts` — fail-closed self-service authorization from authenticated UUID to one linked employee.
- `app/api/employee-portal/me/hr/route.ts` — read-only `GET /api/employee-portal/me/hr?year=YYYY` endpoint.
- `scripts/test-employee-portal-pto.ts` — test-only PTO fixture script; not required by Production runtime.
- `app/components/Sidebar.tsx` — Utilities sidebar logout button using the existing Supabase sign-out flow and redirect to `/login`.

The endpoint accepts only the `year` query parameter. It does not accept or trust employee, company, or user identity parameters supplied by the client.

## PTO semantics used

- Vacation entitlement: `vacation_allowance`.
- Accrual: elapsed days / 365 × allowance, anniversary-period based, floored to two decimals.
- Carryover limit: 5 days.
- `is_exempt`: no PTO balance returned for exempt employees.
- Vacation codes: `L` = 1 day, `L1`/`L2` = 0.5 day, `L3` = 1 day under current legacy weighting.
- Sick codes: `S` = 1 day, `S1`/`S2` = 0.5 day, `S3` = 1 day under current legacy weighting.
- Paid sick allowance: 5 days; alert threshold remains greater than 8 days.
- Future leave rows appear in requested-year history but do not reduce the current as-of balance.

## Pilot mapping

The pilot Auth UUID was verified against the Production email before assignment:

- Auth UUID: `766bd724-c766-4257-8312-e48623a535f3`
- Employee ID: `f92744b5-d28a-476c-b34e-198ced787983`
- Employee: Yungyeong Jang
- Company: AFS / AFS Trans Co.
- Start date: `2025-10-01`
- Vacation allowance: `10`
- Uses accrual: `true`
- Exempt: `false`
- Probation end: `2026-01-01`

The active profile existed before linking. No user or employee link existed before insertion. One and only one link was inserted in Production, and the returned row matched both specified IDs exactly. The pilot retains only its pre-existing Utilities section access; no global, company, HR, or Admin role was added.

## Verification results

Pre-link:

- Normal endpoint request without a link returned `403 Employee portal access denied`.
- Identity scope parameters and invalid years were rejected with HTTP 400.
- Pilot `/hr` and `/admin` access remained unavailable.
- Existing Cris HR/Admin and Utilities screens remained functional.

Post-link:

- Authenticated `GET /api/employee-portal/me/hr?year=2026`: HTTP 200.
- Identity: Yungyeong Jang, AFS, expected employee ID.
- Vacation: entitlement 10, accrued 9.15, used 1, remaining 8.15.
- Sick: paid allowance 5, used 5, unpaid sick 0, remaining 0, alert false.
- 2026 leave history returned correctly.
- Future 2026 vacation rows were present in history and excluded from current balance usage.
- `employeeId`, `employee_id`, `companyId`, `company_id`, `userId`, and `user_id` scope attempts were rejected with HTTP 400.
- Pilot did not gain HR Admin, `/admin`, attendance notes, or attendance flags access.
- Utilities access and the Utilities logout button worked normally.

Known minor issue: scope abuse requests return the generic body `{"error":"Invalid year"}`. The requests are blocked correctly, but the message does not describe the actual cause. This was intentionally not changed or redeployed during the pilot rollout.

## Deployment record

Production was deployed through Vercel CLI from a clean package based on the known-good baseline. Unrelated dirty working-tree files were excluded.

- Initial Portal deployment: `dpl_8BpvZ2Fq8xV6onvHC8UZ8it9nAMc`
- Logout-button deployment: `dpl_44Le1KpxLG4DpYjkrhvMp2GAkkyu`
- Both deployments completed with a successful Next.js build and the Production alias `https://hr.afstransco.com`.

Final status at the end of the pilot verification:

`Employee Portal v1 backend + pilot identity mapping: Production PASS`
