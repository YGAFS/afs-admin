"""Build the standardized archive filename for a processed bill.

Priority (extends the 2-case spec with a 3rd case, since our real
extractors produce issue_date+account_number far more often than a
billing_period_start/end pair):
  1. bill_number known      -> {SITE}_{VENDOR}_{ISSUE_DATE}_{BILL_NUMBER}.pdf
  2. billing period known   -> {SITE}_{VENDOR}_{PERIOD_START}_to_{PERIOD_END}_{ACCT_LAST4}.pdf
  3. issue_date + account   -> {SITE}_{VENDOR}_{ISSUE_DATE}_{ACCT_LAST4}.pdf
  4. otherwise              -> REVIEW_{TIMESTAMP}_{ORIGINAL_SAFE_NAME}.pdf
"""
from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

ILLEGAL_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
MAX_COMPONENT_LEN = 150


def _clean_component(value: str) -> str:
    value = ILLEGAL_CHARS.sub("", value)
    value = value.replace(" ", "")
    value = value.strip("._ ")
    return value or "unknown"


def _account_last4(account_number: str | None) -> str:
    if not account_number:
        return "0000"
    digits = re.sub(r"\D", "", account_number)
    return digits[-4:] if len(digits) >= 4 else (digits or "0000")


def safe_original_name(original_filename: str) -> str:
    stem = Path(original_filename).stem
    stem = ILLEGAL_CHARS.sub("", stem)
    stem = re.sub(r"\s+", "-", stem.strip())
    return stem or "file"


def cap_length(name: str, max_len: int = MAX_COMPONENT_LEN) -> str:
    if len(name) <= max_len:
        return name
    stem, _, ext = name.rpartition(".")
    ext = f".{ext}" if ext else ""
    keep = max_len - len(ext)
    return (stem[:keep] if keep > 0 else name[:max_len]) + ext


def build_filename(
    *,
    site_code: str | None,
    company_id: str | None,
    vendor_db_name: str | None,
    issue_date: date | None,
    bill_number: str | None,
    billing_period_start: date | None,
    billing_period_end: date | None,
    account_number: str | None,
    original_filename: str,
) -> str:
    site = _clean_component(site_code or (company_id or "").upper())
    vendor = _clean_component(vendor_db_name) if vendor_db_name else None

    if site and vendor and issue_date and bill_number:
        name = f"{site}_{vendor}_{issue_date.isoformat()}_{_clean_component(bill_number)}.pdf"
    elif site and vendor and billing_period_start and billing_period_end:
        name = (
            f"{site}_{vendor}_{billing_period_start.isoformat()}_to_"
            f"{billing_period_end.isoformat()}_{_account_last4(account_number)}.pdf"
        )
    elif site and vendor and issue_date:
        name = f"{site}_{vendor}_{issue_date.isoformat()}_{_account_last4(account_number)}.pdf"
    else:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        name = f"REVIEW_{ts}_{safe_original_name(original_filename)}.pdf"

    return cap_length(name)


def resolve_collision(directory: Path, filename: str) -> str:
    """If `filename` already exists in `directory`, append _2, _3, ... before
    the extension until it's unique."""
    candidate = directory / filename
    if not candidate.exists():
        return filename
    stem, _, ext = filename.rpartition(".")
    ext = f".{ext}" if ext else ""
    n = 2
    while True:
        candidate_name = cap_length(f"{stem}_{n}{ext}")
        if not (directory / candidate_name).exists():
            return candidate_name
        n += 1
