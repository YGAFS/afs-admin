"""US Bank / Ray Morgan copier lease bills (ZFS - Fontana)."""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import normalize_account_number, parse_date_numeric, parse_money, search


class USBankExtractor:
    """Parse the recurring Ray Morgan Co statement issued for US Bank."""

    vendor_key = "us_bank"

    def can_handle(self, text: str) -> float:
        text_low = text.lower()
        return 0.95 if "ray morgan co" in text_low and "customer credit account number" in text_low else 0.0

    def extract(self, text: str) -> ParsedBill:
        account = normalize_account_number(
            search(r"Customer Credit Account Number\s*([\d-]+)", text, re.IGNORECASE).group(1)
        )
        invoice = search(r"INVOICE NUMBER\s+(\d+)", text, re.IGNORECASE).group(1)
        issue_raw = search(r"DATE OF INVOICE\s+(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE).group(1)
        issue_date = parse_date_numeric(issue_raw)

        # In the extracted Ray Morgan layout, the due date and total appear
        # immediately after the statement header and before the item rows.
        # Select the first date after the invoice date; later dates belong to
        # the individual copier pools/service periods.
        after_issue = text[text.lower().find("date of invoice") + len("date of invoice"):]
        due_match = re.search(r"\n(\d{2}/\d{2}/\d{4})\n\$([\d,]+\.\d{2})", after_issue)
        if not due_match:
            raise ValueError("US Bank due date/total due header not found")
        due_date = parse_date_numeric(due_match.group(1))
        total = parse_money(due_match.group(2))

        # Ray Morgan statements show the total amount due, not a separate
        # balance-forward/current-charge summary. The recurring bill format
        # is a single monthly lease charge, so keeping previous at zero makes
        # the validator's balance check explicit and stable.
        previous = parse_money("0.00")

        return ParsedBill(
            vendor_name="US Bank",
            account_number=account,
            bill_number=invoice,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=total,
            total_due=total,
            currency="USD",
            confidence=0.95,
        )
