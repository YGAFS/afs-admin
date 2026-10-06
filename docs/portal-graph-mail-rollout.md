# Employee Portal Auth mail via Microsoft Graph

Portal Auth mail can use app-only Graph `Mail.Send` from `admin@afstransco.com`.
The default remains Supabase Auth email delivery. Set the server-only
`PORTAL_AUTH_MAIL_PROVIDER=graph` only after the sender mailbox and Graph
permissions have been verified. No database migration is required.

The application uses dedicated server-only `PORTAL_GRAPH_TENANT_ID`,
`PORTAL_GRAPH_CLIENT_ID`, and `PORTAL_GRAPH_CLIENT_SECRET` credentials.
Do not set these as `NEXT_PUBLIC_*` and do not reuse the Utility application's
credentials. Register a dedicated single-tenant Entra application without
an Entra-wide `Mail.Send` grant. Assign **Application Mail.Send** using
Exchange Online RBAC with a resource scope matching only the
`admin@afstransco.com` mailbox. Verify `Test-ServicePrincipalAuthorization`
returns in-scope for admin and out-of-scope for another mailbox. Entra-wide
`Mail.Send` and Exchange-scoped RBAC are additive, so granting both would
defeat the one-mailbox restriction. A Graph 202 means accepted, not delivered.

Read-only check on 2026-10-06: the Production `MS_GRAPH_CLIENT_ID` matches
the existing **AFS Utility Bill Ingestor** Entra app. Its Graph application
`Mail.Send` permission is already granted tenant-wide. The current Utility
sender differs from `admin@afstransco.com`, so restricting this existing app
to the admin mailbox alone could break Utility mail. `admin@afstransco.com`
is an active Microsoft 365 user with a Business Premium license; actual
mailbox send capability and any Exchange app access policy remain untested.

With the provider enabled, Admin invitation and reset, and public Forgot
Password generate Supabase Auth invite/recovery links server-side, then send
them through Graph. The application never logs these links or tokens. The
public endpoint returns the same response for existing and nonexistent
accounts and limits requests per IP and account using the existing hashed
rate-limit table. Admin-managed accounts continue to have no email recovery.

Before enabling in Production: verify Graph mailbox authorization; test a
single controlled company mailbox with invitation and recovery; verify the
final redirect is `https://hr.afstransco.com/portal/update-password`;
check delivery and runtime errors. Keep the feature unset or turn it off if
Graph rejects sending. Do not provision users as part of configuration.
