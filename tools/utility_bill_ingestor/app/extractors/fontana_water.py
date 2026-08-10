"""Fontana Water Company (ZFS — Water). Bills embed machine-readable
[Key=Value] tags, which is by far the most reliable signal."""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import find_money_after, parse_date_numeric, parse_money, search


class FontanaWaterExtractor:
    vendor_key = "fontana_water"

    def can_handle(self, text: str) -> float:
        if "[Sys_Acct_ID=" in text or "[CustNum=" in text:
            return 0.95
        return 0.6 if "fontana" in text.lower() and "water" in text.lower() else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        cust = search(r"\[CustNum=(\d+)\]", text).group(1)
        acct = search(r"\[Sys_Acct_ID=(\d+)\]", text).group(1)
        account = f"{cust}-{acct}"

        bill_date_raw = search(r"\[Sys_DocDate=(\d{1,2}/\d{1,2}/\d{4})\]", text).group(1)
        due_date_raw = search(r"\[Sys_DueDate=(\d{1,2}/\d{1,2}/\d{4})\]", text).group(1)
        previous = parse_money(search(r"\[PrevBal=([-\d.]+)\]", text).group(1))
        current = find_money_after(r"Total Current Charges", text)
        total = parse_money(search(r"\[Sys_Balance=([-\d.]+)\]", text).group(1))

        # When the previous balance was already settled before this statement was
        # generated, the bill shows a "<date> Payment, Thank you  $-X.XX" line and
        # Sys_Balance (total) legitimately excludes that previous balance. Without
        # capturing it as payments_received, the balance-sum check (previous +
        # current - payments == total) fails and every such bill needlessly lands
        # in needs_review even though the numbers genuinely reconcile.
        payment_match = re.search(r"Payment,\s*Thank you\s*\$?(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
        payments_received = abs(parse_money(payment_match.group(1))) if payment_match else None

        issue_date = parse_date_numeric(bill_date_raw)
        due_date = parse_date_numeric(due_date_raw)

        reconciled = previous + current - (payments_received or 0)
        if reconciled != total:
            warnings.append(f"previous({previous}) + current({current}) - payments({payments_received or 0}) != total({total})")

        return ParsedBill(
            vendor_name="Fontana Water",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            payments_received=payments_received,
            total_due=total,
            currency="USD",
            confidence=0.9,
            warnings=warnings,
        )
