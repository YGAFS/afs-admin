"""Grandbridge Energy (TNT — Electricity).

Real bills come in at least two layouts: an older one with explicit
"Current Charges" / "Total Amount Due" labels, and a newer OEB-style one
that only shows "Amount Due" with a per-charge breakdown (Electricity,
Delivery, ...) instead of a single "Current Charges" line. Both are handled
here; `current_charges` falls back to `total - previous` when there's no
single labeled line item for it.
"""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import find_money_after, parse_date_long, parse_money, search


class GrandbridgeExtractor:
    vendor_key = "grandbridge"

    def can_handle(self, text: str) -> float:
        low = text.lower()
        return 0.9 if ("grandbridge" in low or "grand bridge" in low) else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        # Labels and values are sometimes on separate lines in the extracted
        # text (table-cell layouts) — always allow whitespace/newlines after
        # the colon, never assume same-line.
        account = search(r"Account Number:\s*([0-9-]+)", text).group(1)
        bill_date_raw = search(r"issued on:\s*([A-Za-z]{3} \d{2}, \d{4})", text).group(1)
        due_date_raw = search(r"Due Date:\s*([A-Za-z]{3} \d{2}, \d{4})", text).group(1)
        previous = find_money_after(r"Balance Forward", text)

        total_match = re.search(r"Total Amount Due[\s.:]*\$?\s*(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
        if not total_match:
            total_match = re.search(r"Amount Due[\s.:]*\$?\s*(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
        if not total_match:
            raise ValueError("Could not find a total/amount-due line on Grandbridge bill")
        total = parse_money(total_match.group(1))

        current_match = re.search(r"Current Charges[\s.:]*\$?\s*(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
        if current_match:
            current = parse_money(current_match.group(1))
        else:
            current = total - previous
            warnings.append("current_charges derived as total - previous (no 'Current Charges' line found)")

        issue_date = parse_date_long(bill_date_raw)
        due_date = parse_date_long(due_date_raw)

        if previous + current != total:
            warnings.append(f"previous({previous}) + current({current}) != total({total})")

        return ParsedBill(
            vendor_name="Grandbridge",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="CAD",
            confidence=0.9 if current_match else 0.7,
            warnings=warnings,
        )
