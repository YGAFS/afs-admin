"""Enbridge (TNT — Gas)."""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import find_money_after, parse_date_long, parse_money, search


class EnbridgeExtractor:
    vendor_key = "enbridge"

    def can_handle(self, text: str) -> float:
        return 0.9 if "enbridge" in text.lower() else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        account_match = search(
            r"(\d{2}\s+\d{2}\s+\d{2}\s+\d{5}\s+\d)\s+([A-Z][a-z]{2}\s+\d{2},\s+\d{4})", text
        )
        account = re.sub(r"\s+", "", account_match.group(1))
        bill_date_raw = account_match.group(2)

        # The billing-period end date appears before the actual due date on
        # current Enbridge layouts.  Anchor this to the Due Date label instead
        # of relying on the position of a date in the PDF text stream.
        due_date_raw = search(
            r"Due Date\s+([A-Z][a-z]{2}\s+\d{2},\s+\d{4})", text
        ).group(1)

        previous_match = re.search(r"Balance Forward\s+\$?(-?[\d,]+\.\d{2})", text)
        previous = (
            parse_money(previous_match.group(1))
            if previous_match
            else find_money_after(r"Balance from Previous Bill", text)
        )
        current = find_money_after(r"Charges for Natural Gas", text)
        # Enbridge separates gas charges from other charges (rate adjustment,
        # HST, etc.).  Both are part of the amount due and must be included in
        # current_charges for the balance check to reconcile.
        other_match = re.search(
            r"Other Enbridge Charges\s+\$?(-?[\d,]+\.\d{2})", text,
            re.IGNORECASE,
        )
        if other_match:
            current += parse_money(other_match.group(1))
        total = find_money_after(r"Total Amount Due", text)

        issue_date = parse_date_long(bill_date_raw)
        due_date = parse_date_long(due_date_raw)

        if previous + current != total:
            warnings.append(f"previous({previous}) + current({current}) != total({total})")

        return ParsedBill(
            vendor_name="Enbridge",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="CAD",
            confidence=0.85,
            warnings=warnings,
        )
