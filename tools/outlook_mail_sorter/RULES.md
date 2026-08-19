# Outlook Mail Sorter Rules

Last updated: 2026-07-16

This file is the human-readable operating guide for `config.json` and `outlook_mail_sorter.py`.
When rules change, update this file together with `config.json`.

## Daily Operating Model

1. New mail arrives in `Inbox`.
2. The script adds one company category to Inbox mail when it can identify the company from From/To/CC.
3. User handles the email manually.
4. User moves completed mail into `Archive/Done Inbox/Done`.
5. The script moves mail from the general Done folder into company or special destination folders.
6. Messages that do not match any destination are left in the general Done folder and logged as `SKIP`.
7. Ambiguous HR body-preview matches get `Review Needed` and are left in general Done for manual movement.

## Commands

Dry run, no Outlook changes:

```powershell
.\.venv\Scripts\python.exe outlook_mail_sorter.py all --dry-run 2>&1 | Tee-Object -FilePath dryrun-final.txt
```

Real run:

```powershell
.\.venv\Scripts\python.exe outlook_mail_sorter.py all
```

Folder check:

```powershell
.\.venv\Scripts\python.exe outlook_mail_sorter.py folders
```

## Current Runtime Scope

`classify_inbox`: true

- Inbox messages are tagged.

`classify_done`: false

- General Done messages are not re-tagged during normal operation.
- This avoids reprocessing old Done mail every day.

`move_done`: true

- Messages in `Archive/Done Inbox/Done` are moved to destination folders.

## Company Tag Rules

The script checks all available addresses in:

- From
- To
- CC

Blank To/CC fields are treated as empty lists, not errors.

Priority:

1. `zenithfortio.com` or `deel.com` -> `ZFS`
2. `tnt-expresslines.com` -> `TNT`
3. `afstransco.com` -> `AFS`

If no company domain is found, no company category is added by default.

Only one company category is kept from:

- `ZFS`
- `TNT`
- `AFS`

Other categories are preserved, including:

- `Urgent`
- `From Accounting team`
- `ZFS Vendor`
- `Review Needed`

## Special Done Move Rules

Special rules run before company Done-folder routing.

### Hydrofarm Jessica Admin

Destination: `Archive/Admin`

Matches exact email addresses in From/To/CC:

- `JessicaP@hydrofarm.com`
- `JessicaP@hydrofarm.ca`

### HelloFresh

Destination: `Archive/Inactive/Hello Fresh`

Matches domains `hellofresh.com`, `hellofresh.ca`, or subject containing `hello fresh` / `hellofresh`.

### Data Dock / Rose Rocket Tender

Destination: `Archive/Inactive/ETC/Rose rocket tender`

Matches domains `roserocket.com`, `datadocks.com`, or tender/Rose Rocket/Data Dock subject keywords.

### Fuel Surcharge

Destination: `Archive/Inactive/ETC`

Matches subject containing `fuel surcharge`.

### HR Keywords - Subject

Destination: `HR`

Moves Done messages to HR when the message includes domain `crspcpa.ca` in From/To/CC, or when the subject contains one of:

- `vacation`
- `sick leave`
- `PTO` as an uppercase standalone word
- `paid time off`
- `Time-Off`
- `Work from Home`
- `WFH`
- `wft`
- `time card`
- `payroll`
- `overtime`

### HR Keywords - Body Review

Destination: no automatic move.

Adds category: `Review Needed`

If the body preview contains HR keywords, the message is left in the general Done folder for manual review. This prevents ambiguous body-preview matches from being moved automatically. `PTO` is case-sensitive and must appear as an uppercase standalone word, so it will not match words like `Brampton`.

### Jan-Pro

Destination: `Jan Pro (Janitorial Service)`

Matches domains `jan-pro.com`, `jan-pro.ca`, sender `jayraiza1607@yahoo.com`, or subject containing `jan-pro`, `jan pro`, or `janpro`.

### Deel / ZFS Payroll

Destination: `ZFS Payroll Setup`

Matches domain `deel.com` or subject containing `deel`.

Category behavior:

- Force company category: `ZFS`
- Add extra category: `ZFS Vendor`

### DocuSign

Destination: `Archive/Admin/Contract`

Matches domains `docusign.com`, `docusign.net`, or DocuSign/completed/signed-document subject keywords.

## Company Done Destinations

After special rules, tagged Done messages move by company category:

- `AFS` -> `Archive/Done Inbox/Done - AFS`
- `TNT` -> `Archive/Done Inbox/Done - TNT`
- `ZFS` -> `Archive/Done Inbox/Done - ZFS`

## Company Done Rebalance

Use this when messages already in `Done - AFS`, `Done - TNT`, or `Done - ZFS` need to be rechecked with the current rules.

Dry run:

```powershell
.\.venv\Scripts\python.exe outlook_mail_sorter.py rebalance-done --dry-run 2>&1 | Tee-Object -FilePath rebalance-dryrun.txt
```

Real run:

```powershell
.\.venv\Scripts\python.exe outlook_mail_sorter.py rebalance-done
```

Behavior:

- Reapplies current tag rules to company Done folders.
- Reapplies special destinations such as HR, vendors, DocuSign, Jan-Pro, HelloFresh, and Fuel Surcharge.
- Moves messages to the correct company Done folder if they are in the wrong one.
- Leaves messages in their current company Done folder if no destination can be decided.

## Skip Behavior

If a Done message matches no special rule and has no usable company category, the script does not move it.
It logs:

```text
SKIP sender@example.com | Subject -> no destination; left in general Done
```

Skipped messages remain in `Archive/Done Inbox/Done`.

## Power Automate

Do not run Power Automate mail classification/move flows at the same time as this script.
Recommended transition:

1. Turn off old Power Automate flows.
2. Run this script manually for several days.
3. Confirm results.
4. Then delete or archive the old flows.