"""Orkin (ZFS — Pest Control)."""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import find_money_after, parse_date_numeric, parse_money, search


class OrkinExtractor:
    vendor_key = "orkin"

    def can_handle(self, text: str) -> float:
        return 0.9 if "orkin" in text.lower() else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        account = search(r"Account Number\s+(\d+)", text).group(1)
        due_raw = search(r"\n(\d{1,2}/\d{1,2}/\d{4})\nCUSTOMER INFORMATION", text).group(1)
        service_raw = search(
            r"SERVICE ADDRESS .*?\n(\d{2}/\d{2}/\d{4})", text, re.DOTALL
        ).group(1)

        row = search(
            r"PC Standard - Semi-Monthly - PC\s+\S.*?"
            r"\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+"
            r"\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})",
            text,
            re.DOTALL,
        )
        current = parse_money(row.group(1))
        total = find_money_after(r"TOTAL AMOUNT DUE", text)
        previous = parse_money("0.00")

        issue_date = parse_date_numeric(service_raw)
        due_date = parse_date_numeric(due_raw)

        return ParsedBill(
            vendor_name="Orkin",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="USD",
            confidence=0.75,
            warnings=warnings,
        )
