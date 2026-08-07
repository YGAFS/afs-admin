"""Rogers — used by both AFS (Business Phone) and TNT (Internet). Company
is disambiguated later by the classifier from the account number, not here.

Two known bill layouts (ported from scripts/extract_utility_bills.py, which
was validated against real Rogers bills in the master OneDrive archive):
  1. "Bill number" layout — itemized business invoice.
  2. Simpler "Amount Due" layout.
"""
from __future__ import annotations

import re
from datetime import timedelta

from datetime import date as _date

from app.extractors.base import ParsedBill
from app.normalizer import (
    ParseError,
    find_money_after,
    normalize_account_number,
    parse_date_day_month_year,
    parse_date_long,
    parse_money,
    search,
)


class RogersExtractor:
    vendor_key = "rogers"

    def can_handle(self, text: str) -> float:
        return 0.9 if "rogers" in text.lower() else 0.0

    def extract(self, text: str) -> ParsedBill:
        if "Bill number" in text:
            return self._extract_business_layout(text)
        return self._extract_simple_layout(text)

    def _extract_business_layout(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        account = normalize_account_number(
            search(r"Account number\s+([\d-]+)", text).group(1)
        )
        bill_date_raw = search(r"Bill date\s+([A-Za-z]{3}\s+\d{2},\s+\d{4})", text).group(1)
        due_date_raw = search(
            r"Required Payment Date:\s*([A-Za-z]{3}\s+\d{2},\s+\d{4})", text
        ).group(1)
        previous_match = re.search(r"Balance brought forward\s+([\d,]+\.\d{2})", text)
        previous = parse_money(previous_match.group(1)) if previous_match else parse_money("0.00")
        current = find_money_after(r"Total \(Includes taxes\)", text)
        total = find_money_after(r"Total Due", text)

        issue_date = parse_date_long(bill_date_raw)
        due_date = parse_date_long(due_date_raw)

        if previous + current != total:
            warnings.append(f"previous({previous}) + current({current}) != total({total})")

        return ParsedBill(
            vendor_name="Rogers",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="CAD",
            confidence=0.9,
            warnings=warnings,
        )

    def _extract_simple_layout(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        account = normalize_account_number(search(r"Account\s+(\d+)", text).group(1))
        current = find_money_after(r"Total charges this month", text)
        total_match = re.search(r"Amount Due\s*\$?\s*(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
        total = parse_money(total_match.group(1)) if total_match else find_money_after(r"Total Amount", text)
        previous = total - current

        # e.g. "31 March 2026" — a bare 3-numbers-in-a-row regex (as the
        # script this was ported from used) also matches invoice numbers,
        # account numbers and tax registration numbers elsewhere on the
        # page; anchoring on a real month name avoids that.
        try:
            issue_date = parse_date_day_month_year(text)
        except ParseError:
            # A minority of bills render the month as a number instead of a
            # name (e.g. "31 1 2026" for 31 Jan 2026) — likely a font/PDF
            # export quirk. Only accept this on its own line (surrounded by
            # newlines) so it can't match digit runs inside longer numbers
            # like tax registration IDs, unlike the bare regex this was
            # originally ported with.
            fallback = re.search(r"\n(\d{1,2})\s+(\d{1,2})\s+(\d{4})\n", text)
            if not fallback:
                raise
            day, month, year = int(fallback.group(1)), int(fallback.group(2)), int(fallback.group(3))
            issue_date = _date(year, month, day)
            warnings.append("issue_date read from a numeric-month fallback (month not printed as text on this bill)")

        # This layout never prints an explicit due date, only payment terms
        # like "due within 30 days of the invoice date" — use that instead
        # of silently defaulting to the issue date itself (which would make
        # every bill look due/overdue immediately).
        terms_match = re.search(r"due within\s+(\d{1,3})\s+days? of the invoice date", text, re.IGNORECASE)
        if terms_match:
            due_date = issue_date + timedelta(days=int(terms_match.group(1)))
        else:
            due_date = issue_date
            warnings.append("due_date defaulted to issue_date (no payment-terms line found in this layout)")

        return ParsedBill(
            vendor_name="Rogers",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="CAD",
            confidence=0.85 if terms_match else 0.75,
            warnings=warnings,
        )
