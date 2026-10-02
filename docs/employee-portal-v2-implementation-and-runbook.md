# Employee Portal v2 implementation and release runbook

Prepared: 2026-09-29
Canonical Production origin: `https://hr.afstransco.com`
Production status: **not applied and not deployed**

## Safety boundary

This release is implemented in the repository but remains off unless the
additive v2 schema has been applied and both server-side environment variables
below are exactly `true`:

```text
EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED=true
EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED=true
```

Both default/absent values are false. The schema flag keeps the existing Portal
read path compatible before migration. The account flag additionally hides
account-management routes and the read-only Admin View. Account management
cannot be enabled unless the schema flag is also enabled.

This work does not bulk provision employees, backfill `employees.work_email`,
repair the seven known `is_active=true`/past-`end_date` rows, link Timothy's
Auth user, or mutate any existing Auth user. Those items require individual HR
review.

## Schema and access model

- `employees.id` remains the immutable employee UUID and all existing PK/FK
  relationships remain in place.
- `employees.work_email` is nullable. It is populated only when an individual
  employee login is provisioned and is not a migration prerequisite.
- `employee_user_links.portal_status` is `pending`, `active`, or `disabled`.
  `password_setup_required` is a separate boolean.
- Supabase's native invite/recovery flows set the employee's password. The
  application never generates, receives, stores, logs, or displays it.
- Employee requests use the employee JWT and RLS. Employees can read only the
  employee UUID linked to their own Auth UUID.
- Admin View uses the authenticated super-admin JWT. Explicit RLS policies
  grant `super_admin` SELECT on `employees` and `leave_entries`; no employee
  Auth session is created and no Admin View mutation endpoint exists.
- Service-role access is limited to Auth administration and account lifecycle
  RPCs. It is not used to load normal Employee Portal or Admin View data.
- `employees.is_active=false` denies Portal access immediately, regardless of
  `end_date`.
- `end_date` is an additional inclusive boundary in `America/Vancouver`: an
  otherwise active employee may access through the calendar date in
  `end_date`, and is denied beginning at 00:00 on the following Vancouver
  calendar date.
- Reset Login sets `password_setup_required=true` and deletes refresh sessions.
  Disable Account also sets the profile/link inactive and deletes refresh
  sessions. Existing stateless access tokens are denied on their next request
  because current database state is re-evaluated by server authorization and
  RLS; a browser redirect is not the security control.
- Hard delete is blocked when an employee has PTO history or an Auth link.
  Termination uses deactivation.
- Login archive preserves the employee/Auth identity and changes the Auth login
  email to `archived+<auth-user-uuid>@afstransco.invalid`, allowing a reusable
  company address to be assigned later to a new Auth user. Archive is an
  explicit per-account action and requires `employees.is_active=false`.
- Audit events are limited to admin Portal viewed, login created, login reset,
  account disabled, and account enabled. Passwords and all token/link values
  are prohibited from audit metadata.
- Approved policy documents are Git-tracked Markdown under `content/policies`.
  Production currently has no policy document to migrate.

## Migration order — local or staging first

1. Take a schema/data snapshot of the non-production Supabase project.
2. Confirm the Stage 2B/2C authorization schema is already present.
3. Select or create only the approved pilot/test Auth and employee records.
4. Apply `supabase/employee_portal_accounts_v2.sql`.
5. Run `supabase/employee_portal_accounts_v2_verify.sql`. It requires one active
   linked pilot and one active super admin, runs inside a transaction, and
   always rolls back its lifecycle-state changes.
6. Run application tests and build:

   ```powershell
   npm run test:employee-portal
   npx tsc -p tsconfig.build.json --noEmit
   npm run build
   ```

7. Set `EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED=true` only in the migrated
   non-production environment. Keep
   `EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED=false` during its first deploy.
8. Configure the non-production Supabase Site URL and allow-list its exact
   `/portal/update-password` redirect, then verify SMTP invite/recovery delivery.
9. Enable the flag only in non-production and complete the manual pilot cases
   below.
10. If rollback is required, first disable the flag, then apply
    `supabase/employee_portal_accounts_v2_rollback.sql`. The rollback deletes v2
    audit rows and lifecycle/email columns, so take a snapshot first.

## Automated verification coverage

- `scripts/test-employee-portal-access.ts`: lifecycle decisions, primary
  `is_active` switch, inclusive date boundary, and same-session denial after
  Reset Login and Disable Account at server authorization.
- `supabase/employee_portal_accounts_v2_verify.sql`: employee self-only RLS,
  super-admin Employee/PTO read through the admin's JWT context, and stale JWT
  denial on both Employee and PTO rows after reset/disable state changes.
- `scripts/test-employee-portal-pto.ts`: current PTO parity behavior.
- `scripts/test-policy-markdown.ts`: required policy metadata parsing.
- TypeScript no-emit check and full Next.js production build.

The SQL/RLS verification must be executed against local/staging Postgres before
Production. It must not be substituted with a Production test.

### Repository verification completed on 2026-09-29

- PASS — `npm run test:employee-portal`
- PASS — `npx tsc -p tsconfig.build.json --noEmit`
- PASS — full `npm run build` with Next.js 16.2.6
- PASS — built local server returned HTTP 404 from
  `/api/admin/employee-accounts` with the feature flag absent
- PASS — `git diff --check` (line-ending conversion warnings only)
- NOT RUN — migration and `employee_portal_accounts_v2_verify.sql` against an
  actual non-production Supabase/Postgres instance. No staging project is
  configured in this checkout, and the local Docker/WSL engine could not start
  in the available Windows environment. Production was intentionally not used
  as a substitute. This remains a mandatory release gate.

## Manual pilot QA checklist

### Feature flag and roles

- [ ] With the flag absent/false, `/admin/employees`, its APIs, and Admin View
      return unavailable/not found.
- [ ] A non-super-admin cannot list accounts, operate an account, or open Admin
      View.
- [ ] Existing HR Admin editing continues to work separately.
- [ ] Admin View shows `ADMIN VIEW — READ ONLY`, keeps the admin identity, and
      exposes no edit controls or mutation requests.

### Invite and password ownership

- [ ] Provision exactly one approved active pilot using their company email.
- [ ] The invite is sent by Supabase; no initial/random password appears in UI,
      logs, database rows, or audit events.
- [ ] Invite redirect lands on the canonical environment's
      `/portal/update-password` page.
- [ ] After setting a 12+ character password, setup completes and the employee
      can read only their own Portal data.
- [ ] Another employee UUID cannot be supplied to obtain data.
- [ ] Forgot Password returns a generic response for both known and unknown
      emails.

### Immediate stale-token revocation

- [ ] Log the pilot in and preserve the current access token/session.
- [ ] From the super-admin account, perform Reset Login.
- [ ] Without signing out or refreshing the employee client, send another
      authenticated Portal API request with that same access token.
- [ ] Confirm the server returns 403 and a direct JWT/RLS query cannot read the
      linked `employees` or `leave_entries` rows.
- [ ] Complete recovery and confirm access returns only after password setup is
      completed.
- [ ] Repeat the same-token API and direct RLS checks after Disable Account;
      both must be denied immediately.
- [ ] Confirm client-side redirect behavior separately, but do not count it as
      revocation proof.

### Employment boundary and archive

- [ ] `is_active=false` denies access even when `end_date` is in the future.
- [ ] `is_active=true` with `end_date` equal to the Vancouver business date is
      allowed through that date.
- [ ] The same account is denied on the following Vancouver date.
- [ ] Enabling an account fails when the employee is inactive or past the
      inclusive end-date boundary.
- [ ] Hard delete fails for an employee with PTO history or Auth linkage.
- [ ] On a disposable test identity, archive only after employee deactivation;
      confirm the old Auth identity/history remains and the company email can
      be assigned to a brand-new Auth user.

### Audit and policies

- [ ] Each Admin View creates `admin_portal_viewed` with actor and target UUIDs.
- [ ] Create/reset/disable/enable each creates only its approved audit event.
- [ ] No audit record contains a password, access token, recovery token, invite
      token, or one-time action link.
- [ ] With no approved Markdown policy file, the Portal reports no published
      policy; no Production policy data is fabricated or migrated.

## Production steps requiring explicit execution

None of the following steps are authorized or performed by this implementation.
Execute them only after staging and pilot sign-off:

1. Take a Production database/Auth backup and record row counts.
2. Re-run the read-only preflight report. Manually review the seven
   termination-status inconsistencies and the unprofiled Timothy Auth user.
   Do not auto-fix or link them.
3. Review all existing employee links/Auth users for collisions; select only
   explicitly approved pilot accounts. Do not bulk provision.
4. Apply `supabase/employee_portal_accounts_v2.sql` in Production during an
   approved maintenance window. Do not run the state-mutating verification
   fixture against Production.
5. Keep public signup disabled.
6. Set Supabase Site URL to `https://hr.afstransco.com` and allow only the
   required canonical redirect, including
   `https://hr.afstransco.com/portal/update-password`. Verify SMTP settings.
7. Add the Production feature flag with value `false` and verify fail-closed
   behavior. Keep `EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED=false` until the migration
   is confirmed, then enable the schema flag while keeping account management
   false.
8. Commit only the reviewed release files, push `main`, and deploy with the
   required Vercel CLI command `npx vercel deploy --prod`.
9. Provision only approved pilot accounts through the account-management UI.
10. After pilot security/QA sign-off, set the Production feature flag to true
    and perform a new Vercel Production deployment.
11. Monitor audit events and Auth failures during the pilot; expand enrollment
    only through individual approval.

## Rollback decision

Application rollback is to set the feature flag false first. Prefer leaving the
additive schema in place while investigating. Apply the rollback SQL only when
the schema itself must be removed and after backing up audit/lifecycle data.
Disabling the UI alone does not reverse Auth invitations or archived emails;
those identities require explicit account-by-account review.
