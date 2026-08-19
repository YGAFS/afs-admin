# Outlook Mail Sorter

Local Python MVP for classifying Outlook mail with Microsoft Graph API.

## What It Does

- Reads mail from `Inbox` and `Archive/Done Inbox/Done`
- Adds one company category: `ZFS`, `TNT`, or `AFS`
- Preserves non-company categories such as `Urgent` and `From Accounting team`
- Keeps only one company category, using priority order from `config.json`
- Moves messages from the general Done folder into company/special Done folders
- Gives special vendors priority over normal company folders

## First-Time Setup

From this folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create a local config from the checked-in example:

```powershell
Copy-Item config.example.json config.json
```

For the shared Admin AFS mailbox profile:

```powershell
Copy-Item config.admin-afs.example.json config.admin-afs.json
```

The first run opens a Microsoft device-code login prompt in the terminal. After login, a local token cache is saved in `.token_cache.json`.

The Azure app must allow delegated Microsoft Graph permissions. This script uses direct Microsoft OAuth device-code endpoints, so it only needs `requests`:

- `User.Read`
- `Mail.ReadWrite`
- `Mail.ReadWrite.Shared` only if using a shared mailbox

For device-code login, the Azure app registration must support public client/native authentication.

## Commands

Check the target folder paths:

```powershell
python outlook_mail_sorter.py folders
```

Preview classification and Done moves without changing Outlook:

```powershell
python outlook_mail_sorter.py all --dry-run
```

Classify Inbox and Done messages:

```powershell
python outlook_mail_sorter.py classify
```

Move general Done messages into final folders:

```powershell
python outlook_mail_sorter.py sort-done
```

Run the full MVP:

```powershell
python outlook_mail_sorter.py all
```

## Windows Task Scheduler

Register the daily task at 7:30 AM:

```powershell
.\register_task.ps1
```

Or choose another time:

```powershell
.\register_task.ps1 -At "08:00"
```

The scheduled task runs `run_daily.ps1`, which calls:

```powershell
python outlook_mail_sorter.py all
```

Schedule it for the morning after mail has been placed into the general Done folder.

## Config

Edit `config.json` to add domains, exact sender addresses, subject keywords, or folder paths. No rule changes should require editing Python code.

Local config files, token caches, virtualenvs, generated reports, and one-off run logs are intentionally ignored by Git. Commit the Python scripts, rule documentation, scheduled-task launchers, and `*.example.json` files only.
## GUI

Launch the local control panel:

```powershell
.\run_gui.ps1
```

The GUI can run the sorter, run a dry run, check folder paths, create an Inbox briefing, edit folder paths in the JSON config, and register or run the Windows scheduled task for the selected profile.

