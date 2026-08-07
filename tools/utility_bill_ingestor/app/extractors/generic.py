"""Fallback extractor for any vendor without a dedicated parser above.

Never raises — best-effort only. Confidence is always low and the pipeline
always routes generic-extractor output to needs_review, regardless of how
many fields it managed to find (per spec: unrecognized vendors are never
auto-registered).
"""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import ParseError, parse_date_any, parse_money

TOTAL_PATTERNS = [
    r"Total\s+(?:Amount\s+)?Due\s*[:\s]\s*\$?\s*(-?[\d,]+\.\d{2})",
    r"Amount\s+Due\s*[:\s]\s*\$?\s*(-?[\d,]+\.\d{2})",
    r"Total\s*[:\s]\s*\$?\s*(-?[\d,]+\.\d{2})",
]
DUE_DATE_PATTERNS = [
    r"Due\s+Date\s*[:\s]\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})",
    r"Payment\s+Due\s*[:\s]\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})",
]
ISSUE_DATE_PATTERNS = [
    r"(?:Bill|Invoice|Statement)\s+Date\s*[:\s]\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})",
]
ACCOUNT_PATTERNS = [
    r"Account\s+(?:Number|No\.?|#)\s*[:\s]\s*([\w-]{4,})",
]


def _first_match(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


class GenericExtractor:
    vendor_key = "generic"

    def can_handle(self, text: str) -> float:
        return 0.1  # always a last-resort match

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = ["parsed by generic extractor — always needs_review"]

        total = None
        total_raw = _first_match(TOTAL_PATTERNS, text)
        if total_raw:
            try:
                total = parse_money(total_raw)
            except ParseError:
                warnings.append(f"could not parse total amount from {total_raw!r}")
        else:
            warnings.append("no total/amount-due found")

        due_date = None
        due_raw = _first_match(DUE_DATE_PATTERNS, text)
        if due_raw:
            try:
                due_date = parse_date_any(due_raw)
            except ParseError:
                warnings.append(f"could not parse due date from {due_raw!r}")

        issue_date = None
        issue_raw = _first_match(ISSUE_DATE_PATTERNS, text)
        if issue_raw:
            try:
                issue_date = parse_date_any(issue_raw)
            except ParseError:
                warnings.append(f"could not parse issue date from {issue_raw!r}")
        else:
            warnings.append("no bill/invoice/statement date found")

        account = _first_match(ACCOUNT_PATTERNS, text)
        if not account:
            warnings.append("no account number found")

        return ParsedBill(
            vendor_name=None,
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month if issue_date else None,
            billing_year=issue_date.year if issue_date else None,
            current_charges=total,
            total_due=total,
            currency="CAD",
            confidence=0.1,
            warnings=warnings,
            raw_fields={"total_raw": total_raw, "due_raw": due_raw, "issue_raw": issue_raw},
        )
