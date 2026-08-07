"""City of Cambridge Water (TNT — Water)."""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import (
    find_money_after,
    parse_date_long,
    parse_date_numeric,
    parse_money,
    search,
)


class CambridgeWaterExtractor:
    vendor_key = "cambridge_water"

    def can_handle(self, text: str) -> float:
        low = text.lower()
        return 0.9 if "cambridge" in low and "water" in low else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        account = search(r"Account Number:\s*(\d+)", text).group(1)
        # Colon after the label is inconsistent across real bills — some have
        # "Bill Issue Date: 2026/06/03", others "Bill Issue Date\n2026/06/03".
        bill_date_raw = search(r"Bill Issue Date:?\s*(\d{4}/\d{2}/\d{2})", text).group(1)
        due_date_raw = search(r"Due Date:\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})", text).group(1)

        block = search(
            r"Previous Balance\s+Payment Received\s+Adjustments/Other Charges\s+Balance Forward"
            r".*?\$([\d,. ]+)\s+\$([\d,. -]+)\s+\$([\d,. -]+)\s+\$([\d,. -]+)\s+"
            r"Current Water/Wastewater Charges",
            text,
            re.DOTALL,
        )
        previous = parse_money(block.group(4).replace(" ", ""))
        current = find_money_after(r"Current Water/Wastewater Charges", text)

        # The account-number row (e.g. "69661\n$453.92\nJun 26, 2026") carries
        # the total for *this* account — use the account we actually parsed,
        # not a hardcoded one (a real bug in the script this was ported from,
        # which only ever saw one account number).
        total_match = re.search(rf"\n{re.escape(account)}\s+\$([\d,]+\.\d{{2}})\s+[A-Za-z]{{3}}", text)
        total = parse_money(total_match.group(1)) if total_match else (previous + current)
        if not total_match:
            warnings.append("total_due fell back to previous+current (account-row pattern not found)")

        issue_date = parse_date_numeric(bill_date_raw.replace("/", "-"))
        due_date = parse_date_long(due_date_raw)

        if previous + current != total:
            warnings.append(f"previous({previous}) + current({current}) != total({total})")

        return ParsedBill(
            vendor_name="Cambridge Water",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month,
            billing_year=issue_date.year,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="CAD",
            confidence=0.8 if total_match else 0.5,
            warnings=warnings,
        )
