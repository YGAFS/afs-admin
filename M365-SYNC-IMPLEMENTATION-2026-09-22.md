# Microsoft 365 Subscription Sync — Implementation Status

Updated: 2026-09-24  
Production: https://hr.afstransco.com

## Scope completed

- Added a separate Microsoft Graph app configuration using `M365_GRAPH_*` environment variables.
- Kept the existing Microsoft Graph configuration used by the utility email service separate.
- Added an admin-only, read-only M365 comparison endpoint:
  - `GET /api/admin/m365-dry-run?days=30`
- Added the `M365 Comparison & History` view under `/licenses`.
- Added company-selected tenant connections for AFS, TNT, and ZFS.
- The comparison now filters Graph users by the selected company's email domain.
- TNT connection uses tenant `cee030c8-828a-46d9-8ed2-428ef6a037db` and app `ea9be5a6-6a89-4512-8eac-3073696eb7fe`.
- ZFS connection uses tenant `d7e4f0f4-81e9-42ab-ad38-1235060dac9f` and app `c1edf185-b37c-4bad-8b20-100af1aac541`.
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
- Added right-click registration for Microsoft-only accounts using company-specific `A`, `T`, or `Z` account IDs.
- Added an admin server API for registration:
  - `POST /api/admin/m365-register`
- Account IDs are generated in `A001`, `T001`, or `Z001` format and checked against all companies because `licenses.account_id` is globally unique.
- Registration success and failure messages are shown in the UI.

## Microsoft Graph permissions used

The M365 app was configured with application permissions for:

- `User.Read.All`
- `LicenseAssignment.Read.All`
- `MailboxSettings.Read`
- `AuditLog.Read.All`

Admin consent was completed for the AFS tenant.

TNT app permissions and tenant-wide admin consent were completed on 2026-09-24.

ZFS app permissions and tenant-wide admin consent were completed on 2026-09-24.

## Important retention limitation

The UI offers 7, 30, and 90-day history choices. Microsoft Entra audit logs for the current tenant are only available through the tenant's actual retention window, currently up to 30 days. A 90-day request is therefore safely limited to the available period and displays a notice instead of failing.

True 90-day or longer history requires exporting Entra audit logs to Azure Monitor, a Storage Account, Event Hubs, or Microsoft Purview retention.

## Environment variables

- AFS: `M365_GRAPH_TENANT_ID`, `M365_GRAPH_CLIENT_ID`, `M365_GRAPH_CLIENT_SECRET`
- TNT: `M365_GRAPH_TNT_TENANT_ID`, `M365_GRAPH_TNT_CLIENT_ID`, `M365_GRAPH_TNT_CLIENT_SECRET`
- ZFS: `M365_GRAPH_ZFS_TENANT_ID`, `M365_GRAPH_ZFS_CLIENT_ID`, `M365_GRAPH_ZFS_CLIENT_SECRET`
- Client secrets must remain server-only and must not use `NEXT_PUBLIC_` names.

## Current safety behavior

- The comparison endpoint does not modify Microsoft 365.
- The comparison endpoint does not write to the database.
- Manual registration is the only current import path.
- Unlicensed accounts are not counted as active subscriptions.
- Accounts are not automatically deleted or deactivated.
- TNT and ZFS are isolated from other company comparisons and use separate tenant connections.

## TNT / ZFS manager accounts

- Added `tntadmin@tnt-expresslines.com` as a TNT-only HR company manager.
- Added `admin@zenithfortio.com` as a ZFS-only HR company manager.
- Added server-side company-scope checks so these identities cannot access another company's HR API by changing the URL or request parameters.
- Added `supabase/add_company_manager_accounts.sql`; run it after the two Auth users exist. It creates the active profile, company role, and HR section grant and includes verification output.
- The HR landing page shows only the assigned company tab for these two identities.

## Not implemented yet

- Scheduled automatic synchronization.
- Automatic database registration of newly licensed accounts.
- Automatic notification email after a new account is registered.
- Persistent local audit-history storage beyond Microsoft Entra's retention period.
- ZFS tenant credentials and connection are configured in Vercel Production; the client secret is intentionally not documented.

## Main implementation files

- `lib/server/m365Graph.ts` — Graph authentication, users, SKUs, and audit retrieval.
- `app/api/admin/m365-dry-run/route.ts` — company-selected comparison and audit filtering endpoint.
- `app/api/admin/m365-register/route.ts` — company-aware admin-only manual registration endpoint.
- `app/licenses/page.tsx` — M365 comparison UI, history filters, account table, and registration action.
- `supabase/normalize_license_account_ids.sql` — A001 account ID normalization migration.

## Verification and deployment

- Production build passed with `npm run build`.
- Changes were pushed to `main`.
- Production deployment is performed with `npx vercel deploy --prod`.
- Latest documentation commit is created after the implementation commits.

