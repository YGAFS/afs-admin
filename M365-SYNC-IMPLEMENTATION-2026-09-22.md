# Microsoft 365 Subscription Sync — Implementation Status

Updated: 2026-09-22  
Production: https://hr.afstransco.com

## Scope completed

- Added a separate Microsoft Graph app configuration using `M365_GRAPH_*` environment variables.
- Kept the existing Microsoft Graph configuration used by the utility email service separate.
- Added an admin-only, read-only M365 comparison endpoint:
  - `GET /api/admin/m365-dry-run?days=30`
- Added the `M365 Comparison & History` view under `/licenses`.
- Limited the comparison to the AFS tenant and AFS email identities.
- Excluded `Unlicensed` users from subscription comparison counts.
- Added SKU-to-friendly-name mapping for common plans:
  - Microsoft 365 Business Premium
  - Microsoft 365 Business Standard
  - Microsoft 365 Business Basic
  - Exchange Online (Plan 1)
  - Microsoft Power Automate Free
- Added matching through `mail`, `userPrincipalName`, `proxyAddresses`, and `otherMails`.
- Added current account comparison results:
  - Match
  - Microsoft only
  - Register only
  - Duplicate email
  - Status mismatch
  - Plan mismatch
  - Plan needs review
- Added Entra audit history for relevant account events:
  - Account created
  - License changes
  - Account deleted/deactivated
  - Email address changes
- Removed duplicate audit events using timestamp, operation, target, and initiator.
- Added audit history filtering and sorting in the UI.
- Added `Created` date to the regular M365 Accounts table.
- Added a sync icon tab for the comparison/history section.
- Added right-click registration for Microsoft-only AFS accounts.
- Added an admin server API for registration:
  - `POST /api/admin/m365-register`
- Account IDs are generated in `A001` format and checked against all companies because `licenses.account_id` is globally unique.
- Registration success and failure messages are shown in the UI.

## Microsoft Graph permissions used

The M365 app was configured with application permissions for:

- `User.Read.All`
- `LicenseAssignment.Read.All`
- `MailboxSettings.Read`
- `AuditLog.Read.All`

Admin consent was completed for the AFS tenant.

## Important retention limitation

The UI offers 7, 30, and 90-day history choices. Microsoft Entra audit logs for the current tenant are only available through the tenant's actual retention window, currently up to 30 days. A 90-day request is therefore safely limited to the available period and displays a notice instead of failing.

True 90-day or longer history requires exporting Entra audit logs to Azure Monitor, a Storage Account, Event Hubs, or Microsoft Purview retention.

## Current safety behavior

- The comparison endpoint does not modify Microsoft 365.
- The comparison endpoint does not write to the database.
- Manual registration is the only current import path.
- Unlicensed accounts are not counted as active subscriptions.
- Accounts are not automatically deleted or deactivated.
- TNT and ZFS are excluded from the AFS comparison and must use separate tenant connections.

## Not implemented yet

- Scheduled automatic synchronization.
- Automatic database registration of newly licensed accounts.
- Automatic notification email after a new account is registered.
- Persistent local audit-history storage beyond Microsoft Entra's retention period.
- TNT and ZFS tenant connections.

## Main implementation files

- `lib/server/m365Graph.ts` — Graph authentication, users, SKUs, and audit retrieval.
- `app/api/admin/m365-dry-run/route.ts` — AFS comparison and audit filtering endpoint.
- `app/api/admin/m365-register/route.ts` — Admin-only manual registration endpoint.
- `app/licenses/page.tsx` — M365 comparison UI, history filters, account table, and registration action.
- `supabase/normalize_license_account_ids.sql` — A001 account ID normalization migration.

## Verification and deployment

- Production build passed with `npm run build`.
- Changes were pushed to `main`.
- Production deployment is performed with `npx vercel deploy --prod`.
- Latest documentation commit is created after the implementation commits.

