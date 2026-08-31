# Utility Bill Ingestor

Watches a folder for newly-downloaded utility bill PDFs (arbitrary filenames,
no manual renaming needed) and automatically:

1. Detects new PDFs and waits until the file has fully finished copying/downloading
2. Hashes the file (SHA-256) and skips exact duplicates
3. Extracts text (PyMuPDF), with an optional OCR fallback for scanned PDFs
4. Identifies the vendor, company (AFS/TNT/ZFS), site, account number, dates and amounts
5. Validates the result conservatively — anything even slightly uncertain goes to
   a `review` folder instead of being silently registered
6. Upserts clean bills into the same Supabase `utility_bills` table the
   [afs-admin](../../README.md) web app already uses
7. Renames the file to a standard `SITE_Vendor_Date_BillNumber.pdf` form and
   files it into the existing `{COMPANY}\{VENDOR}\...` archive structure
8. Logs everything (console + rotating file + a `utility_bill_imports` audit
   table in Supabase)

This is a **separate local Python worker**, not part of the Next.js app. It
talks to the same Supabase project directly using a service_role key.

## Installation

### 1. Python virtualenv

```powershell
cd tools\utility_bill_ingestor
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

**On Windows ARM64** (this machine): PyMuPDF ships wheels for ARM64, but some
transitive dependencies (e.g. `cryptography`, pulled in by the Supabase
client) do not, and pip will otherwise try to build them from source with
Rust/OpenSSL, which fails. Force wheel-only installs instead:

```powershell
pip install --only-binary=:all: -r requirements.txt
```

### 3. Configure environment

```powershell
copy .env.example .env
notepad .env
```

Fill in `SUPABASE_SERVICE_ROLE_KEY` (Supabase Dashboard → Settings → API →
`service_role`, **not** the anon key — this key bypasses Row Level Security,
so treat it like a password: never commit `.env`, never put this key in the
Next.js app's `.env.local`, never share it).

The defaults in `.env.example` point:
- **Inbox** → `...\0. DB\_inbox`, a new subfolder inside the same OneDrive
  folder where every bill already lives, so "drop the PDF where I already
  keep bills" is the entire workflow.
- **Archive root** → the existing `...\0. DB` folder itself, so processed
  bills land back in the `{COMPANY}\{VENDOR}\...` structure already in use
  (see `config/vendors.yaml`'s `archive_folder` overrides for the couple of
  vendors whose folder name on disk doesn't exactly match their Supabase
  `utility_vendors.name`, e.g. `Grand Bridge` vs `Grandbridge`).
- **Local working data** (`processing/`, `review/`, `failed/`, `logs/`) →
  `./data`, deliberately **not** inside OneDrive, so in-progress file moves
  never race with cloud sync.

Override any of these in `.env` if you'd rather keep everything local.

### 4. Apply the database migration

Run `supabase/add_utility_bill_imports.sql` (in the **main afs-admin repo
root**, not this folder) in the Supabase SQL Editor. It only adds a new
`utility_bill_imports` table — it does not touch any existing table's data,
and the ingestor's core logic (vendor/site resolution, `utility_bills`
writes) works against tables that already exist. See that repo's
`CLAUDE.md` for the exact command.

### 5. (Optional) OCR for scanned PDFs

Only needed if some bills are scanned images rather than real PDF text
(most utility bills are not). Everything else works without this.

1. Install [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) for
   Windows and note its install path (e.g. `C:\Program Files\Tesseract-OCR`).
2. Add that folder to your `PATH`, or set `pytesseract.pytesseract.tesseract_cmd`
   — simplest is adding to PATH.
3. Install [poppler for Windows](https://github.com/oschwartz10612/poppler-windows/releases)
   and add its `bin\` folder to `PATH` too (needed by `pdf2image`).
4. Set `ENABLE_OCR=true` in `.env`.

If OCR is needed for a given file but not installed/enabled, that file is
**not** treated as a failure — it's routed to `review` with a warning
explaining OCR was needed.

## Folder structure

```text
utility_bill_ingestor/
├── app/                    # all the code (see below)
├── config/
│   ├── vendors.yaml        # known vendors: DB name, company, site, aliases, known accounts
│   └── sites.yaml          # known sites/locations per company
├── data/
│   ├── inbox/              # only used if UTILITY_BILL_INBOX isn't overridden
│   ├── processing/         # files currently being worked on (crash-safe staging)
│   ├── review/             # needs a human look — nothing was written to the DB
│   ├── failed/             # unreadable/corrupt/encrypted PDFs — original file preserved
│   └── logs/                # ingestor.log (rotating)
├── scripts/
│   ├── graph_discover_drive.py     # one-off: find GRAPH_DRIVE_ID / GRAPH_DRIVE_ROOT_*
│   └── backfill_onedrive_links.py  # one-off: link bills registered before Graph was set up
├── tests/
├── requirements.txt
├── .env.example
├── run_watch.bat            # double-click launcher for Task Scheduler
└── register_watch_task.ps1  # registers the watcher as a logon scheduled task
```

`app/` layout:

| File | Responsibility |
|---|---|
| `main.py` | CLI (`watch`, `process-all`, `process-file`, `dry-run`) |
| `watcher.py` | Polling inbox watcher: stability check, atomic move to `processing/`, crash recovery |
| `pipeline.py` | Orchestrates one file: hash → extract → classify → validate → upsert → rename → archive → log |
| `config.py` | `.env` + `config/*.yaml` loading |
| `pdf_reader.py` | PyMuPDF text extraction, encrypted/corrupt detection |
| `ocr.py` | Optional Tesseract fallback |
| `classifier.py` | Resolves a parsed bill to a specific vendor/company/site |
| `normalizer.py` | Shared money/date/account parsing helpers |
| `validator.py` | Conservative completed/needs_review/failed/duplicate decision |
| `filename_builder.py` | Standardized filename generation, collision-safe |
| `repository.py` | All Supabase reads/writes, UUID resolution — nothing else talks to Supabase |
| `graph_client.py` | Optional: Microsoft Graph app-only client, creates OneDrive sharing links (see "OneDrive file links" below) |
| `logging_config.py` | Console + rotating file logging, account-number masking |
| `extractors/` | One module per vendor + a generic fallback |

## Running it

```powershell
# Watch the inbox forever (this is what Task Scheduler runs)
python -m app.main watch

# Process everything currently sitting in the inbox once, then exit
python -m app.main process-all

# Process one specific file (doesn't need to be in the inbox)
python -m app.main process-file "C:\path\to\some_bill.pdf"

# Same as process-all, but guaranteed not to touch Supabase or move files for real
python -m app.main dry-run
```

Any command also accepts `--dry-run` to force dry-run mode regardless of the
`.env` `DRY_RUN` setting — useful for testing changes to `config/vendors.yaml`
against real bills without risking a bad write.

**Always dry-run first** after changing `config/vendors.yaml` or `sites.yaml`,
or after adding a new extractor, and check the logs before trusting it with
`watch`.

## What happens to each file

| Outcome | Where it ends up | DB write |
|---|---|---|
| `completed` | `{ARCHIVE_ROOT}\{COMPANY}\{VENDOR}\[{SITE}\]{standard_name}.pdf` | New row in `utility_bills` |
| `needs_review` | `data\review\{standard_name_or_REVIEW_prefix}.pdf` | None — nothing registered until a human fixes it |
| `duplicate` | `data\review\duplicates\{original_name}.pdf` | None |
| `failed` | `data\failed\{timestamp}_{original_name}.pdf` | None |

Every outcome, regardless of the above, gets one row in the
`utility_bill_imports` audit table (status, detected vendor/site, parsed
data, warnings, error message, link to the created `utility_bills` row if
any). Query that table in Supabase to see everything the worker has ever
touched.

**The registration bar is intentionally conservative**: a bill only reaches
`completed` (and only then is it written to `utility_bills`) when the vendor,
company and site are unambiguous, all required fields (issue date, total
amount) are present, and every sanity/balance check passes with zero
warnings. Anything else — including every bill handled only by the generic
fallback extractor — goes to `review` instead of guessing.

## Handling `review` and `failed` files

- **`data/review/`**: open the PDF, figure out the missing/ambiguous piece
  (usually: a brand-new vendor/account not yet in `config/vendors.yaml`, or a
  vendor bill layout the extractor doesn't handle), fix the config or add an
  extractor (see below), then drop the file back in the inbox. It reprocesses
  through the classifier fresh every time — a file only short-circuits as a
  duplicate if the *exact same bytes* were already recorded with an outcome,
  so fixing the config and retrying the same file works as expected.
- **`data/failed/`**: the PDF itself couldn't be read (encrypted, corrupted,
  not actually a PDF). Check `data/logs/ingestor.log` or the
  `utility_bill_imports.error_message` column for the reason. Original file
  is always preserved, never deleted.

## Adding a new vendor extractor

1. Look at an example, e.g. `app/extractors/telus.py` — it just needs
   `vendor_key`, `can_handle(text) -> float` (0.0–1.0 confidence), and
   `extract(text) -> ParsedBill`.
2. Create `app/extractors/<vendor>.py` implementing that interface. Use
   `app/normalizer.py`'s `search`, `find_money_after`, `parse_money`,
   `parse_date_long`/`parse_date_numeric` helpers — don't re-invent parsing.
3. Register it in `app/extractors/__init__.py`'s `KNOWN_EXTRACTORS` list.
4. Add the vendor to `config/vendors.yaml` (must match its
   `utility_vendors.name` in Supabase for that `company_id` exactly, plus
   any known account numbers and text aliases).
5. Add tests in `tests/test_extractors.py` (or a dedicated
   `tests/test_extractors_<vendor>.py`).
6. `python -m app.main dry-run` against a few real bills before trusting it
   with `watch`.

New sites/locations (e.g. once TNT's Biscayne/Pickering utility accounts are
set up) work the same way: add them to `config/sites.yaml`, and add their
account numbers to the relevant vendor entries in `vendors.yaml` once known.

## Windows autostart

Two options, from simplest to most "always on":

**A. Just run it manually** — double-click `run_watch.bat` whenever you want
it watching. Closing the console window stops it.

**B. Start at login via Task Scheduler**:

```powershell
.\register_watch_task.ps1
```

This registers a scheduled task that starts `run_watch.bat` whenever you log
in, and won't start a second copy if one's already running
(`-MultipleInstances IgnoreNew`). To start it immediately without logging
out, stop it, or remove it again, see the commands the script prints after
registering.

A full Windows service is not set up here — not necessary for this workload,
and the logon-task approach above needs no elevated install.

## OneDrive file links (Microsoft Graph)

Optional. When configured, every bill the ingestor registers also gets an
**"organization"-scoped OneDrive sharing link** saved to
`utility_bills.onedrive_file_url` — the web app already renders this as a
📎 "Open file" link on every bill row, no site code changes needed. Anyone
signed into the afstrans.co tenant can open the link; no one else can.

This is entirely separate from the HR app's mail-send Graph integration
(`lib/msal.ts` — a delegated, user-interactive SPA flow). File links use an
**app-only client-credentials** flow instead, since the ingestor runs
unattended with no one signed in.

### One-time setup

1. **Azure AD app registration** (needs a Global Admin or Application
   Administrator on the afstrans.co tenant):
   - [portal.azure.com](https://portal.azure.com/) → **Microsoft Entra ID** →
     **App registrations** → **New registration**. Single-tenant, no
     redirect URI needed.
   - **Certificates & secrets** → **New client secret** → copy the *Value*
     immediately (shown once).
   - **API permissions** → **+ Add a permission** → Microsoft Graph →
     **Application permissions** (not Delegated) → add **Files.ReadWrite.All**
     (read-only `Files.Read.All` is *not* enough — creating a sharing link is
     a write operation on the item's permissions, even for a view-only link).
     Then **Grant admin consent for afstrans.co**.
2. Put the 3 values in `.env`: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
   `GRAPH_CLIENT_SECRET`.
3. Find the target drive: `python -m scripts.graph_discover_drive` (add
   `--site-path <name>` once you know the SharePoint site — see the script's
   own output for how to find that from a folder's "View online" URL). Set
   `GRAPH_DRIVE_ID` from its output.
4. Work out `GRAPH_DRIVE_ROOT_LOCAL` / `GRAPH_DRIVE_ROOT_REMOTE_PREFIX` — a
   local folder and its exact path *inside the drive*. These are often
   **not** the same string: OneDrive's sync client can rename a shortcut
   folder locally (e.g. this tenant's `UTILITY_BILL_ARCHIVE_ROOT` sits under
   a local folder named `afstrans.co - AFS_2023`, but the same folder is
   just `AFS_2023` on the actual drive). `graph_discover_drive`'s output
   explains how to read the real remote path off a "View online" URL.
5. **Verify against one real archived file before trusting it** — a wrong
   `GRAPH_DRIVE_ROOT_REMOTE_PREFIX` fails as a 404 (`itemNotFound`), not
   silently:
   ```powershell
   python -c "from pathlib import Path; from app.config import load_settings; from app.graph_client import GraphClient; s = load_settings(); print(GraphClient(s).create_sharing_link(Path(r'C:\path\to\a\real\archived\bill.pdf')))"
   ```
6. Backfill bills that were registered before this was set up:
   ```powershell
   python -m scripts.backfill_onedrive_links --dry-run   # preview
   python -m scripts.backfill_onedrive_links              # for real
   ```

Once all 5 `GRAPH_*` values are set, new bills get a link automatically
(`Pipeline._attach_onedrive_link`, called right after a bill is archived) —
this is entirely best-effort: if Graph is unreachable or misconfigured, the
bill still registers normally, just without a link, and a warning is logged.

## OneDrive sync folder caveats

The inbox (and by default, the archive) live inside a OneDrive-synced
folder, on purpose — that's where you already work with bills. A few things
to know:

- **Never trust a file the instant it appears.** OneDrive can create the
  filename before the bytes are fully synced. The watcher waits for the
  file's size *and* modified-time to stay unchanged for
  `STABILITY_WINDOW_SECONDS` (default 5s) before touching it — bump this up
  in `.env` if you're on a slow connection and see partial-file errors.
- **Placeholder/"Files On-Demand" files**: if a file shows as available
  online-only (cloud icon, not downloaded), reading it will trigger a
  download; the stability check's repeated stat() calls handle this
  naturally (size stays 0 or partial until the download completes), but a
  very slow initial download could exceed the stability window and get
  picked up prematurely. If that ever happens in practice, either increase
  `STABILITY_WINDOW_SECONDS` or set the `_inbox` folder to "Always keep on
  this device" in OneDrive settings.
- **Conflict copies** (`filename-PCNAME.pdf` from a sync conflict) are not
  specially filtered — if you see these, resolve the conflict in OneDrive
  first so only one copy lands in `_inbox`.
- **Antivirus real-time scanning** can occasionally hold a brief lock on a
  freshly-written file; file moves retry with backoff (up to ~7s total) to
  ride this out.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Everything goes to `review` with "vendor not recognized" | New vendor, or vendor's text doesn't match any `aliases` in `vendors.yaml` — open the PDF and check its exact wording |
| A known vendor's bills go to `review` with a "matched multiple configs" warning | Same vendor name used by 2+ companies (e.g. Rogers AFS/TNT) and neither the account number nor site text disambiguated it — add the account number to the right vendor's `accounts:` list in `vendors.yaml` once you know it |
| `SUPABASE_SERVICE_ROLE_KEY missing` error on startup | `.env` not filled in, or you're running from the wrong directory (paths in `.env` are relative to `tools/utility_bill_ingestor/` unless absolute) |
| A file sits in `data/processing/` after a crash | Fine — the next `watch`/`process-all` run automatically picks it back up (idempotent via the file-hash check) |
| PDF looks scanned, routed to review with an OCR warning | Either `ENABLE_OCR=false`, or Tesseract/poppler aren't installed — see the OCR section above |
| Move fails with a Windows file-in-use error | Usually transient (AV scan, OneDrive); the built-in retry (~7s) should clear it — if it persists, check nothing else has the file open |

## Tests

```powershell
pip install -r requirements.txt   # includes pytest
pytest -q
```

Tests never touch a live Supabase project or commit real bill PDFs to the
repo — they use an in-memory fake repository (`tests/fixtures/fake_repository.py`)
and generate small synthetic PDFs on the fly with PyMuPDF.

## What's not automated yet

- Vendor extractors exist for the 8 vendors with real historical bills in
  the archive (Telus, Rogers, Enbridge, Grandbridge, Cambridge Water,
  Fontana Water, Burrtec, Orkin) plus a generic fallback. **US Bank** (ZFS,
  Printer) has no dedicated extractor yet — its bills will go to `review`
  until one is written (see "Adding a new vendor extractor" above).
- TNT's Pickering location has one utility account registered (Rogers 5G
  router/WiFi, account `5-0882-6140` — originally misfiled as "Biscayne",
  corrected 2026-08-14). Biscayne itself still has no utility accounts
  registered, so bills for that site will resolve to `needs_review` (site
  can't be confirmed) until the corresponding `utility_service_accounts`
  rows and `config/vendors.yaml` account numbers exist.
- No AI/LLM fallback extractor — by design, per the brief. The `BillExtractor`
  interface is generic enough to add one later without touching the pipeline.
