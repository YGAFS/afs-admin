"""Fontana Water Company (ZFS — Water). Bills embed machine-readable
[Key=Value] tags, which is by far the most reliable signal."""
from __future__ import annotations

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

        issue_date = parse_date_numeric(bill_date_raw)
        due_date = parse_date_numeric(due_date_raw)

        if previous + current != total:
            warnings.append(f"previous({previous}) + current({current}) != total({total})")

        return ParsedBill(
            vendor_name="Fontana Water",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="USD",
            confidence=0.9,
            warnings=warnings,
        )
