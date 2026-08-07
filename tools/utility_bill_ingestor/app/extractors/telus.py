"""TELUS (AFS — Internet/Wifi, business phone variants)."""
from __future__ import annotations

from app.extractors.base import ParsedBill
from app.normalizer import (
    find_money_after,
    normalize_account_number,
    parse_date_long,
    search,
)


class TelusExtractor:
    vendor_key = "telus"

    def can_handle(self, text: str) -> float:
        return 0.9 if "telus" in text.lower() else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        account = normalize_account_number(
            search(r"Account number:\s*([\d ]+)", text).group(1)
        )
        bill_date_raw = search(r"Your TELUS bill\s+([A-Za-z]+\s+\d{2},\s+\d{4})", text).group(1)
        due_date_raw = search(r"Total if received by ([A-Za-z]+\s+\d{2},\s+\d{4})", text).group(1)
        previous = find_money_after(r"Balance forward from your last bill", text)
        current = find_money_after(r"Total new charges", text)
        total = find_money_after(r"Total due", text)

        issue_date = parse_date_long(bill_date_raw)
        due_date = parse_date_long(due_date_raw)

        if previous + current != total:
            warnings.append(
                f"previous({previous}) + current({current}) != total({total})"
            )

        return ParsedBill(
            vendor_name="TELUS",
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
            raw_fields={"bill_date_raw": bill_date_raw, "due_date_raw": due_date_raw},
        )
