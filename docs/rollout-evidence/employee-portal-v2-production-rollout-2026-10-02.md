# Employee Portal v2 Production schema rollout — 2026-10-02

## Staging clean replay

- Project ref: `kiraqrdakzzdmgqkjbfy`
- Rollback: PASS
- Clean migration replay: PASS
- `employee_portal_accounts_v2_verify.sql`: PASS
- Synthetic Employee A/B links preserved and active
- Synthetic PTO/history rows preserved: 3
- Company and company-role RLS checks: PASS

## Production preflight

- Project ref: `gufzgemtfgrfcotlzmuq`
- Employees: 42
- Leave entries: 1,141
- Auth users: 5
- User profiles: 4
- Employee/Auth links: 1
- Termination inconsistencies: 7
- Timothy unprofiled Auth users: 1
- Timothy employee links: 0
- Existing link matched the documented Yungyeong Jang pilot Employee/Auth UUIDs

The pre-migration policy, constraint, trigger, and authorization-function
definitions are preserved in
`production-pre-employee-portal-v2-definitions-2026-10-02.csv`.

## Transactional Production rollout

The migration and `employee_portal_accounts_v2_production_assertions.sql`
were executed in one transaction. Any failed assertion would have aborted the
transaction before COMMIT.

Transaction result: PASS

- Employee self SELECT: PASS
- Cross-employee Employee/PTO SELECT denial: PASS
- super_admin Employee/PTO/link/company-role SELECT: PASS
- Existing HR/company-admin Employee/PTO scope: PASS
- Existing pilot defaults: `portal_status = active`,
  `password_setup_required = false`

## Production postflight

- Employees: 42 (unchanged)
- Leave entries: 1,141 (unchanged)
- Auth users: 5 (unchanged)
- User profiles: 4 (unchanged)
- Employee/Auth links: 1 (unchanged)
- Termination inconsistencies: 7 (unchanged)
- Timothy unprofiled Auth users: 1 (unchanged)
- Timothy employee links: 0 (unchanged)
- Populated `employees.work_email`: 0
- Portal audit rows: 0
- Required Portal RLS policies: 4
- Portal status constraint: present
- Hard-delete protection trigger: present

No Production Auth user, employee email, employee status, PTO row, feature
flag, or application deployment was changed during this rollout.
