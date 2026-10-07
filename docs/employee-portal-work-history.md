# Employee Portal Work History

Updated: 2026-10-07
Production URL: https://hr.afstransco.com

## Scope

This document records the Employee Portal v2 authentication, account-management, and Graph mail work completed in the repository and deployed to Production. It intentionally contains no passwords, client secrets, access tokens, recovery links, invite links, or mailbox credentials.

## Completed implementation

### Portal account lifecycle and security

- Preserved `employees.id` as the immutable employee identity.
- Added and verified the Portal account lifecycle model using `pending`, `active`, and `disabled` states.
- Kept password setup requirements separate from lifecycle status.
- Preserved employee self-access and super-admin read-only access through the existing RLS/RPC model.
- Kept terminated employees and historical PTO data intact; termination is deactivation rather than deletion.
- Preserved hard-delete protection for employees with PTO, Auth, or Portal linkage.
- Kept public signup disabled.
- Added/retained audit events for account creation, reset, enable, disable, and admin Portal viewing without recording secrets or tokens.

### Login modes

- Email-managed accounts use the employee's unique work email.
- Admin-managed accounts use an atomic Login ID allocator and one-time temporary passwords.
- Admin-managed temporary passwords are displayed once and are not stored in the application database or audit log.
- Password setup completion is performed only as part of the authenticated password-update flow.
- Login ID recovery does not send recovery email; HR/Admin reset is required.

### Existing Auth account linking

Commit: `22b765e` (`Allow linking existing Auth accounts`)

The Admin Employee Portal Accounts page now includes `Link existing Auth` for active, unprovisioned employees. The server-side action:

1. Resolves exactly one active Supabase Auth user by normalized email.
2. Rejects an Auth user already linked to another employee.
3. Reuses the existing `auth.users.id`.
4. Calls `portal_admin_provision_login_v2` to create the employee link.
5. Does not create a duplicate Auth user or send an invitation email.

The following existing accounts have not been automatically linked:

- `cris.b@afstransco.com`
- `timothy.z@afstransco.com`

They require an explicit Admin action after confirming the employee-to-Auth mapping.

### Graph Auth mail delivery

Commit: `6b2d611` (`Add Graph mail delivery for portal auth`)

- Registered a dedicated Microsoft Entra application for Portal Auth mail.
- Added Microsoft Graph application `Mail.Send` permission and tenant admin consent.
- Added server-only Graph configuration variables in Vercel Production:
  - `PORTAL_GRAPH_TENANT_ID`
  - `PORTAL_GRAPH_CLIENT_ID`
  - `PORTAL_GRAPH_CLIENT_SECRET`
  - `PORTAL_AUTH_MAIL_PROVIDER=graph`
- Secrets are not included in this document, repository, logs, or chat.
- Admin invitation, Admin reset, and Forgot Password can generate Supabase Auth links server-side and send them through Graph.
- Auth links are validated to use HTTPS and the configured Supabase origin.
- Generic Forgot Password responses and hashed rate-limit keys are preserved.

Graph `202 Accepted` confirms acceptance by Microsoft Graph, not final mailbox delivery. A Production invitation successfully created the Auth/link state, but mailbox delivery still requires mailbox spam/quarantine or Exchange message-trace confirmation.

## Verification completed

- Employee Portal lifecycle and stale-session authorization tests: PASS
- Employee Portal login-mode tests: PASS
- Employee Portal PTO tests: PASS
- Policy Markdown tests: PASS
- Graph mail unit tests: PASS
- TypeScript build check: PASS
- Next.js production build: PASS
- Vercel Production deployment: READY
- Production admin employee page: loads successfully
- Browser console errors during smoke checks: none observed

## Production deployments

- Graph mail deployment: `dpl_ESuVQNUjcYcC3iipUkHde9PrqoP3`
- Existing Auth link deployment: `dpl_2moTneYWdd5UnAU3mj4swpGva65C`
- Both deployments were aliased to `https://hr.afstransco.com`.

## Data and safety status

- No mass employee provisioning was performed.
- No mass email backfill was performed.
- No mass invitation was sent; only individual pilot invitations were attempted.
- No termination inconsistency was corrected automatically.
- Timothy's account was not automatically modified.
- No Production database migration was included in the Graph mail or existing-link deployments.
- No staging synthetic users, staging secrets, or test passwords were committed.
- Existing unrelated working-tree files were preserved and excluded from the commits:
  - `tsconfig.tsbuildinfo`
  - `AGENTS.md`
  - `CHANGES-2026-09-17-WAREHOUSING-DOMAIN.md`

## Remaining work

1. Confirm the exact Auth user mapping for Cris and Timothy, then use `Link existing Auth` individually.
2. Test each linked account's login, self Portal/PTO access, password reset, and Admin read-only view.
3. Confirm Graph delivery using Microsoft 365 mailbox spam/quarantine review or Exchange message trace.
4. Apply Exchange Online RBAC/Application Access Policy so the dedicated Graph application is scoped only to the intended sender mailbox. Graph `Mail.Send` application permission should not remain broader than necessary.
5. Continue pilot-only provisioning; do not bulk-provision employees without a separate approval.
