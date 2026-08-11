"""Burrtec Waste Industries (ZFS — Garbage).

Real bills of this layout print labels and values in separate blocks (a
table-cell layout artifact) rather than "Label: value" on one line, and
payment terms are "Due Upon Receipt" — there is no separate due date to
find. The one usable date in the body is the statement/service date,
which always appears as the first `MM/DD/YY` pattern in the document
(a later "Last Payment Received on MM/DD/YY" date is not it — this only
works because that mention always comes later in the text).
"""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import parse_date_numeric, parse_money, search


class BurrtecExtractor:
    vendor_key = "burrtec"

    def can_handle(self, text: str) -> float:
        return 0.9 if "burrtec" in text.lower() else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []
        account = search(r"(\d{9})", text).group(1)

        date_match = re.search(r"\b(\d{2}/\d{2}/\d{2})\b", text)
        issue_date = parse_date_numeric(date_match.group(1)) if date_match else None
        if not issue_date:
            warnings.append("issue_date not found in body")

        # "Due By" is printed as the text "Due Upon Receipt", not a date —
        # payment is due immediately, so due_date is the statement date.
        due_date = issue_date

        # "Total Amount Due" is sometimes followed by extra words before the
        # number, e.g. "Total Amount Due On Receipt" — allow (and ignore)
        # any non-digit text in between rather than requiring it adjacent.
        total_match = re.search(r"Total Amount Due[^\d\n]*\n?\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
        total = parse_money(total_match.group(1)) if total_match else None
        if not total_match:
            warnings.append("total_due not found in body")

        # The "Total Previous Balance" printed on the bill is only the
        # *starting* balance, before an "Other Charges and Payments" block
        # that mixes in more charges, credits, *and* payments (in no fixed
        # order) — not reliably parseable into a clean previous/current
        # split. What's reliable: the "Current Charges" section immediately
        # before "Total Amount Due" always lists exactly this period's new
        # line items (confirmed against real ZFS Burrtec bills for account
        # 136689184, incl. ones with mid-statement credits/payments), so sum
        # that block directly and back out previous_balance from the total
        # instead of trying to replay the whole ledger. This guarantees
        # previous+current==total by construction (can go negative when a
        # payment/credit more than covered the old balance — a real signal,
        # not an error, so it's left as-is rather than floored at zero).
        # Each line item in that block linearizes as 4 separate lines — date,
        # quantity, description, amount, in that order — so anchor on that
        # shape rather than just summing every 2-decimal number in the block:
        # a quantity can itself have 2 decimals (e.g. "2.38" tons on a dump-
        # fee line) and would otherwise get miscounted as a dollar amount.
        current_block_match = re.search(r"Current Charges\s*(.*?)Total Amount Due", text, re.DOTALL)
        current = None
        if current_block_match:
            amounts = re.findall(
                r"\d{2}/\d{2}/\d{2}\s*\n[\d.,]+\s*\n[^\n]+\n([\d,]+\.\d{2})",
                current_block_match.group(1),
            )
            if amounts:
                current = sum((parse_money(a) for a in amounts[1:]), parse_money(amounts[0]))
        if current is None:
            warnings.append("Current Charges section not found — falling back to Total Previous Balance for the split")
            previous_match = re.search(r"Total Previous Balance\s+([\d,]+\.\d{2})", text)
            previous = parse_money(previous_match.group(1)) if previous_match else parse_money("0.00")
            current = (total - previous) if total is not None else None
        else:
            previous = (total - current) if total is not None else None

        return ParsedBill(
            vendor_name="Burrtec",
            account_number=account,
            issue_date=issue_date,
            due_date=due_date,
            billing_month=issue_date.month if issue_date else None,
            billing_year=issue_date.year if issue_date else None,
            previous_balance=previous,
            current_charges=current,
            total_due=total,
            currency="USD",
            confidence=0.8 if issue_date and total is not None else 0.4,
            warnings=warnings,
        )
